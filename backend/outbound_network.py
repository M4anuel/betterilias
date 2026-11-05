"""Public-only TCP resolution with the original host retained for TLS and pooling."""
import asyncio
from contextlib import contextmanager
import socket
import time

import httpcore
import httpx

from backend.outbound_targets import OutboundTargetRejected, TargetPolicy, public_address


class PublicNetworkBackend(httpcore.AsyncNetworkBackend):
    def __init__(self, policy, *, delegate=None, resolver=None):
        self.policy = policy
        self.delegate = delegate or httpcore.AnyIOBackend()
        self.resolver = resolver

    async def connect_tcp(self, host, port, timeout=None, local_address=None, socket_options=None):
        if isinstance(host, bytes):
            host = host.decode('ascii')
        if (host.lower(), port) not in self.policy.host_ports:
            raise OutboundTargetRejected()
        deadline = time.monotonic() + (timeout if timeout is not None else 30)
        resolver = self.resolver or asyncio.get_running_loop().getaddrinfo
        try:
            answers = await asyncio.wait_for(resolver(host, port, type=socket.SOCK_STREAM), max(0, deadline - time.monotonic()))
        except TimeoutError as exc:
            raise httpcore.ConnectTimeout('DNS resolution timed out') from exc
        except OSError as exc:
            raise httpcore.ConnectError('DNS resolution failed') from exc
        addresses = list(dict.fromkeys(answer[4][0] for answer in answers))
        if not addresses:
            raise httpcore.ConnectError('DNS returned no addresses')
        local_native = self.policy.allow_local and (host.lower(), port) == self.policy.native[1:]
        if not local_native and not all(public_address(address) for address in addresses):
            raise OutboundTargetRejected("private_address")
        last_error = None
        for address in addresses:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise httpcore.ConnectTimeout('Connection timed out')
            try:
                # Numeric IP only: the delegate never resolves the hostname a
                # second time. HTTPCore still uses the original host for SNI,
                # certificate verification, Host headers and pool isolation.
                return await self.delegate.connect_tcp(address, port, timeout=remaining,
                    local_address=local_address, socket_options=socket_options)
            except (httpcore.ConnectError, httpcore.ConnectTimeout) as exc:
                last_error = exc
        raise last_error

    async def connect_unix_socket(self, *args, **kwargs):
        raise OutboundTargetRejected()

    async def sleep(self, seconds):
        await asyncio.sleep(seconds)


_ERRORS = [(getattr(httpcore, name), getattr(httpx, name)) for name in (
    'ConnectTimeout', 'ReadTimeout', 'WriteTimeout', 'PoolTimeout', 'ConnectError', 'ReadError',
    'WriteError', 'ProxyError', 'UnsupportedProtocol', 'LocalProtocolError', 'RemoteProtocolError')]


@contextmanager
def mapped_errors(request=None):
    try:
        yield
    except tuple(item[0] for item in _ERRORS) as exc:
        for source, target in _ERRORS:
            if isinstance(exc, source):
                raise target('Upstream connection failed', request=request) from exc
        raise


class CoreStream(httpx.AsyncByteStream):
    def __init__(self, stream, request):
        self.stream, self.request = stream, request

    async def __aiter__(self):
        with mapped_errors(self.request):
            async for chunk in self.stream:
                yield chunk

    async def aclose(self):
        with mapped_errors(self.request):
            await self.stream.aclose()


class PinnedHTTPTransport(httpx.AsyncBaseTransport):
    def __init__(self, policy, *, network_backend=None):
        self.pool = httpcore.AsyncConnectionPool(ssl_context=httpcore.default_ssl_context(), retries=0,
            network_backend=network_backend or PublicNetworkBackend(policy))

    async def handle_async_request(self, request):
        # Do not accept extensions capable of overriding SNI or the HTTP target.
        extensions = {key: value for key, value in request.extensions.items() if key in ('timeout', 'trace')}
        native = httpcore.Request(method=request.method, url=httpcore.URL(scheme=request.url.raw_scheme,
            host=request.url.raw_host, port=request.url.port, target=request.url.raw_path),
            headers=request.headers.raw, content=request.stream, extensions=extensions)
        with mapped_errors(request):
            response = await self.pool.handle_async_request(native)
        return httpx.Response(response.status, headers=response.headers,
            stream=CoreStream(response.stream, request), extensions=response.extensions)

    async def aclose(self):
        await self.pool.aclose()


class EgressTransport(httpx.AsyncBaseTransport):
    def __init__(self, *, policy=None, inner=None):
        self.policy = policy or TargetPolicy()
        self.inner = inner or PinnedHTTPTransport(self.policy)

    def prepare_request(self, request):
        return self.policy.prepare(request)

    async def handle_async_request(self, request):
        native = self.prepare_request(request)
        response = await self.inner.handle_async_request(request)
        if not native:
            # An external host must not poison the native session cookie jar.
            response.headers.pop('set-cookie', None)
            response.headers.pop('set-cookie2', None)
        return response

    async def aclose(self):
        await self.inner.aclose()
