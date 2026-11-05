"""Exact outbound origins and resource-only URL validation.

Do not expand this into a suffix/domain wildcard allowlist. External media gets
no ILIAS cookies or native request headers, including on redirect hops.
"""
import html
import ipaddress
from pathlib import PurePosixPath
import re
from urllib.parse import parse_qsl, unquote, urljoin, urlsplit

import httpx

from backend.config import settings
from backend.i18n import t
from backend.observability import emit

RESOURCE_READ = 'betterilias.resource_read'


class OutboundTargetRejected(Exception):
    def __init__(self, reason="malformed_url"):
        emit("outbound." + reason)
        # Never include attacker-supplied URLs, signed query strings or IPs.
        super().__init__(t('outbound.target_blocked'))


def public_address(value):
    try:
        address = ipaddress.ip_address(value)
    except ValueError:
        return False
    translated = (isinstance(address, ipaddress.IPv6Address) and
                  (address in ipaddress.ip_network('64:ff9b::/96') or address in ipaddress.ip_network('64:ff9b:1::/48')))
    return (not translated and address.is_global and not address.is_multicast and not address.is_reserved
            and not address.is_unspecified and not address.is_loopback
            and not getattr(address, 'ipv4_mapped', None)
            and not getattr(address, 'sixtofour', None)
            and not getattr(address, 'teredo', None))


def origin(url):
    return (url.scheme.lower(), url.host.lower(), url.port if url.port is not None else (443 if url.scheme == 'https' else 80))


class TargetPolicy:
    def __init__(self, native_url=None, media_origins=None, *, allow_local=None):
        self.native_url = native_url or settings.ilias_base_url
        self.allow_local = settings.outbound_allow_local_ilias if allow_local is None else allow_local
        if self.allow_local and settings.app_env != 'development':
            raise ValueError('Local ILIAS connections are development-only')
        native = self._parse(self.native_url)
        if native.query or native.fragment or (native.scheme != 'https' and not self.allow_local):
            raise ValueError('ILIAS_BASE_URL must use HTTPS without query or fragment')
        self.native = origin(native)
        self.media = set()
        for raw in settings.outbound_media_origins if media_origins is None else media_origins:
            parsed = self._parse(raw)
            if parsed.scheme != 'https' or parsed.port not in (None, 443) or parsed.path not in ('', '/') or parsed.query or parsed.fragment:
                raise ValueError('Outbound media origins must be exact HTTPS origins on port 443')
            self.media.add(origin(parsed))
        self.host_ports = {(host, port) for _, host, port in {self.native, *self.media}}

    @staticmethod
    def _parse(value):
        if not isinstance(value, str) or not value or re.search(r'[\x00-\x20\x7f\\]', value):
            raise OutboundTargetRejected()
        try:
            parsed = httpx.URL(value)
            if (parsed.scheme not in ('https', 'http') or not parsed.host or parsed.username or parsed.password
                    or '@' in urlsplit(value).netloc or '%' in parsed.host or parsed.host.endswith('.')):
                raise OutboundTargetRejected()
            if parsed.port is not None and not 1 <= parsed.port <= 65535:
                raise OutboundTargetRejected()
            # Accessing/normalizing the port also validates malformed ports.
            origin(parsed)
            return parsed
        except (httpx.InvalidURL, ValueError, UnicodeError) as exc:
            raise OutboundTargetRejected() from exc

    def validate_url(self, value):
        parsed = self._parse(str(value))
        target = origin(parsed)
        if target != self.native and target not in self.media:
            raise OutboundTargetRejected("origin_not_allowed")
        return parsed

    def resource_url(self, raw):
        if not isinstance(raw, str) or re.search(r'[\x00-\x20\x7f\\]', raw):
            raise OutboundTargetRejected()
        url = urljoin(self.native_url.rstrip('/') + '/', html.unescape(raw))
        parsed = self.validate_url(url)
        if origin(parsed) != self.native:
            return str(parsed.copy_with(fragment=None))
        path = unquote(parsed.path)
        query = parse_qsl(parsed.query.decode('ascii'), keep_blank_values=True)
        lowered = [(key.lower(), value.lower()) for key, value in query]
        keys = [key for key, _ in lowered]
        if len(set(keys)) != len(keys) or any(key.startswith('cmd[') for key in keys):
            raise OutboundTargetRejected('ambiguous_command')
        values = dict(lowered)
        command = values.get('cmd', '')
        reads = {'sendfile', 'download', 'downloadfile', 'downloadall', 'downloadreturned', 'sendassignedfile', 'downloadfeedbackfile'}
        if ((command and command not in reads) or
                any(key.startswith('fallbackcmd') and value not in reads for key, value in lowered)):
            raise OutboundTargetRejected("unsafe_command")
        if path.endswith('/ilias.php') and command in reads:
            return str(parsed.copy_with(fragment=None))
        if (not command and path.endswith('/ilias.php') and values.get('ref_id', '').isdecimal()
                and (values.get('cmdclass') or values.get('baseclass')) in ('ilrepositorygui', 'ilobjfilegui')
                and set(values) <= {'baseclass', 'cmdclass', 'cmdnode', 'ref_id', 'client_id'}):
            return str(parsed.copy_with(fragment=None))
        if not command and (re.search(r'/go/file/\d+/?$', path) or re.search(r'/file/\d+/?$', path)
                            or (path.endswith('/goto.php') and re.fullmatch(r'file_\d+', values.get('target', '')))):
            return str(parsed.copy_with(fragment=None))
        # Static resources may have signed queries but must not disguise a
        # server-side script behind an extension or additional path segment.
        if (not command and not re.search(r'\.(?:php\d*|phtml|asp|aspx|jsp|cgi)(?:/|\.|$)', path, re.I)
                and PurePosixPath(path).suffix.lower() in {
                    '.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.mp4', '.mp3', '.webm',
                    '.ogg', '.vtt', '.srt', '.zip', '.txt', '.csv', '.docx', '.xlsx', '.pptx', '.py', '.ipynb', '.tar', '.gz'}):
            return str(parsed.copy_with(fragment=None))
        raise OutboundTargetRejected("unsupported_resource")

    def prepare(self, request):
        parsed = self.validate_url(str(request.url))
        if request.extensions.get(RESOURCE_READ):
            self.resource_url(str(request.url))
        native = origin(parsed) == self.native
        if not native:
            if (request.method not in ('GET', 'HEAD') or request.headers.get('transfer-encoding')
                    or request.headers.get('content-length', '0') != '0'):
                raise OutboundTargetRejected('external_write')
            # HTTPX carries extensions through redirects. An external media
            # response may only lead back to a native resource read, never a
            # grade/editor command with the authenticated native cookie jar.
            request.extensions[RESOURCE_READ] = True
            allowed = {'accept', 'accept-encoding', 'user-agent', 'range', 'if-range', 'if-none-match', 'if-modified-since', 'cache-control', 'host'}
            for name in list(request.headers):
                if name.lower() not in allowed:
                    del request.headers[name]
        else:
            # BetterIlias credentials have no purpose on the upstream server.
            request.headers.pop('X-Session-Id', None)
            request.headers.pop('Proxy-Authorization', None)
        request.headers['Host'] = parsed.netloc.decode('ascii')
        return native
