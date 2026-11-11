import asyncio
import socket
import ssl
from unittest.mock import AsyncMock, MagicMock

import httpcore
import httpx
import pytest
from fastapi.testclient import TestClient

from backend.api.deps import get_ilias_client
from backend.auth.session import SessionManager
from backend.config import settings
from backend.main import app
from backend.outbound_budget import OutboundBudget, BudgetPolicy
from backend.outbound_http import BudgetTransport
from backend.outbound_network import EgressTransport, PinnedHTTPTransport, PublicNetworkBackend
from backend.outbound_targets import OutboundTargetRejected, TargetPolicy, public_address, RESOURCE_READ
from backend.services.ilias_client import IliasClient

NATIVE = 'https://ilias.unibe.ch'
MEDIA = 'https://dist.opencast.unibe.ch'


@pytest.fixture
def policy():
    return TargetPolicy()


@pytest.mark.parametrize('url', [
    'http://ilias.unibe.ch/file.pdf', 'https://ilias.unibe.ch:444/file.pdf', 'https://ilias.unibe.ch:0/file.pdf',
    'https://ilias.unibe.ch.attacker.example/file.pdf', 'https://attacker.example/ilias.unibe.ch/file.pdf',
    'https://user:password@ilias.unibe.ch/file.pdf', 'https://ilias.unibe.ch./file.pdf',
    'https://127.0.0.1/file.pdf', 'https://169.254.169.254/latest/meta-data',
    'https://[::1]/file.pdf', 'file:///etc/passwd', 'gopher://ilias.unibe.ch/',
    'https://ilias.unibe.ch\\@attacker.example/file.pdf', 'https://ilias.unibe.ch/\nfile.pdf',
    'https://new.dist.opencast.unibe.ch/file.pdf', 'https://dist.opencast.unibe.ch:444/file.pdf',
])
def test_exact_origin_policy_rejects_ambiguous_or_untrusted_targets(policy, url):
    with pytest.raises(OutboundTargetRejected) as error:
        policy.validate_url(url)
    assert url not in str(error.value)


@pytest.mark.parametrize('url', [
    '/ilias.php?cmd=delete&ref_id=123', '/ilias.php?cmd=doLogout',
    '/ilias.php?cmd=download&CMD=delete', '/ilias.php?cmd=download&fallbackCmd=delete', '/ilias.php?cmd[delete]=Delete',
    '/ilias.php?baseClass=ilRepositoryGUI&ref_id=123&fallbackCmd=delete',
    '/ilias.php?baseClass=ilRepositoryGUI&ref_id=123&new_type=fold',
    '/api/delete.pdf?cmd=remove', '/fake.php/file.pdf', '/fake%2ephp/file.pdf',
    '/unknown-controller',
])
def test_resource_proxy_is_not_a_generic_native_command_runner(policy, url):
    with pytest.raises(OutboundTargetRejected):
        policy.resource_url(url)


@pytest.mark.parametrize('url', [
    'ilias.php?cmd=sendfile&ref_id=123', '/ilias.php?cmd=downloadReturned&member_id=101&ass_id=20',
    '/ilias.php?cmdClass=ilResourceCollectionGUI&cmd=download&rid=resource',
    '/ilias.php?baseClass=ilRepositoryGUI&ref_id=123', '/go/file/123', '/goto.php?target=file_123',
    '/test.pdf#page=2', 'https://dist.opencast.unibe.ch/file.pdf?token=signed%2Bvalue&expires=123',
])
def test_known_resource_links_and_signed_media_are_supported(policy, url):
    assert policy.resource_url(url).startswith((NATIVE, MEDIA))


def test_forum_resource_download_is_limited_to_exact_post_attachment_selectors(policy):
    attachment='/ilias.php?cmdClass=ilObjForumGUI&cmd=viewThread&ref_id=42&pos_pk=100&file='+'a'*32
    assert policy.resource_url(attachment).startswith(NATIVE)
    for extra in ['&action=showedit','&mark_read=1','&fallbackCmd=delete','&draft_id=1','&cmd=delete']:
        with pytest.raises(OutboundTargetRejected):policy.resource_url(attachment+extra)
    with pytest.raises(OutboundTargetRejected):policy.resource_url(attachment.replace('a'*32,'not-a-file-id'))


@pytest.mark.parametrize('address', ['127.0.0.1', '10.0.0.1', '172.16.0.1', '192.168.1.1', '169.254.169.254',
    '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255', '::1', '::', 'fc00::1', 'fe80::1',
    '::ffff:127.0.0.1', '64:ff9b::7f00:1', '64:ff9b:1::1', '2002:7f00:1::', 'invalid'])
def test_special_private_and_translation_addresses_are_denied(address):
    assert not public_address(address)


def answers(*addresses):
    return [(socket.AF_INET6 if ':' in value else socket.AF_INET, socket.SOCK_STREAM, 6, '', (value, 443)) for value in addresses]


@pytest.mark.asyncio
async def test_mixed_public_private_dns_is_rejected_before_any_tcp_connect(policy):
    delegate = MagicMock()
    delegate.connect_tcp = AsyncMock()
    resolver = AsyncMock(return_value=answers('93.184.216.34', '127.0.0.1'))
    backend = PublicNetworkBackend(policy, delegate=delegate, resolver=resolver)
    with pytest.raises(OutboundTargetRejected):
        await backend.connect_tcp('ilias.unibe.ch', 443)
    delegate.connect_tcp.assert_not_awaited()


@pytest.mark.asyncio
async def test_dns_result_is_pinned_and_rebinding_is_blocked_on_new_connection(policy):
    delegate = MagicMock()
    delegate.connect_tcp = AsyncMock(return_value='stream')
    resolver = AsyncMock(side_effect=[answers('93.184.216.34'), answers('10.0.0.1')])
    backend = PublicNetworkBackend(policy, delegate=delegate, resolver=resolver)
    assert await backend.connect_tcp('ilias.unibe.ch', 443) == 'stream'
    assert resolver.await_count == 1
    assert delegate.connect_tcp.await_args.args == ('93.184.216.34', 443)
    with pytest.raises(OutboundTargetRejected):
        await backend.connect_tcp('ilias.unibe.ch', 443)
    assert delegate.connect_tcp.await_count == 1


@pytest.mark.asyncio
async def test_original_tls_host_and_host_header_survive_numeric_ip_pinning(policy):
    connections, tls, payloads = [], [], []
    class Stream(httpcore.AsyncMockStream):
        async def start_tls(self, ssl_context, server_hostname=None, timeout=None):
            tls.append(server_hostname)
            assert ssl_context.verify_mode == ssl.CERT_REQUIRED
            assert ssl_context.check_hostname
            return self
        async def write(self, buffer, timeout=None):
            payloads.append(buffer)
            await super().write(buffer, timeout)
    class Delegate(httpcore.AsyncNetworkBackend):
        async def connect_tcp(self, host, port, **kwargs):
            connections.append((host, port))
            return Stream([b'HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok'])
    backend = PublicNetworkBackend(policy, delegate=Delegate(), resolver=AsyncMock(return_value=answers('93.184.216.34')))
    transport = EgressTransport(policy=policy, inner=PinnedHTTPTransport(policy, network_backend=backend))
    async with httpx.AsyncClient(transport=transport) as client:
        response = await client.get(NATIVE + '/test.pdf', headers={'Host':'attacker.example'},
                                    extensions={'sni_hostname':'attacker.example', 'target':b'/delete'})
    assert response.content == b'ok'
    assert connections == [('93.184.216.34',443)]
    assert tls == ['ilias.unibe.ch'] or tls == [b'ilias.unibe.ch']
    assert b'Host: ilias.unibe.ch' in b''.join(payloads)
    assert b'attacker.example' not in b''.join(payloads)
    assert b'GET /test.pdf HTTP/1.1' in b''.join(payloads)


@pytest.mark.asyncio
async def test_media_gets_no_credentials_and_cannot_poison_native_cookies(policy):
    seen = []
    def respond(request):
        seen.append(request)
        if request.url.host == 'ilias.unibe.ch' and request.url.path == '/file.pdf':
            return httpx.Response(302, headers={'Location':MEDIA + '/signed.pdf?token=keep%2Bme'})
        if request.url.host == 'dist.opencast.unibe.ch':
            return httpx.Response(200, content=b'PDF', headers={'Set-Cookie':'PHPSESSID=evil; Domain=.unibe.ch; Path=/'})
        return httpx.Response(200, text='native')
    async with httpx.AsyncClient(transport=EgressTransport(policy=policy, inner=httpx.MockTransport(respond)),
                                 cookies={'PHPSESSID':'private'}, follow_redirects=True) as client:
        response = await client.get(NATIVE + '/file.pdf', headers={'Authorization':'secret', 'X-Session-Id':'betterilias-secret',
            'X-CSRF-Token':'csrf-secret', 'Referer':NATIVE + '/ilias.php?rtoken=private', 'Range':'bytes=0-20'})
        assert response.content == b'PDF'
        assert seen[0].headers['cookie'] == 'PHPSESSID=private'
        assert seen[0].headers.get('x-session-id') is None
        media = seen[1]
        assert all(media.headers.get(name) is None for name in ('cookie','authorization','x-session-id','x-csrf-token','referer'))
        assert media.headers['range'] == 'bytes=0-20'
        assert str(media.url).endswith('?token=keep%2Bme')
        assert client.cookies.get('PHPSESSID') == 'private'
        await client.get(NATIVE + '/after.pdf')
        assert seen[-1].headers['cookie'] == 'PHPSESSID=private'


@pytest.mark.asyncio
@pytest.mark.parametrize('location', ['https://127.0.0.1/private.pdf', 'https://attacker.example/file.pdf',
                                    'http://ilias.unibe.ch/file.pdf', NATIVE + '/ilias.php?cmd=delete'])
async def test_resource_redirect_is_checked_before_second_request(policy, location):
    calls = []
    def respond(request):
        calls.append(request)
        return httpx.Response(302, headers={'Location':location})
    async with httpx.AsyncClient(transport=EgressTransport(policy=policy, inner=httpx.MockTransport(respond)), follow_redirects=True) as client:
        with pytest.raises(OutboundTargetRejected):
            await client.get(NATIVE + '/test.pdf', extensions={RESOURCE_READ:True})
    assert len(calls) == 1


@pytest.mark.asyncio
async def test_native_post_cannot_redirect_body_to_external_media(policy):
    calls = []
    def respond(request):
        calls.append(request)
        return httpx.Response(307, headers={'Location':MEDIA + '/collect'})
    async with httpx.AsyncClient(transport=EgressTransport(policy=policy, inner=httpx.MockTransport(respond)), follow_redirects=True) as client:
        with pytest.raises(OutboundTargetRejected):
            await client.post(NATIVE + '/ilias.php?cmd=saveStatusAll', content=b'private student notes')
    assert len(calls) == 1


@pytest.mark.asyncio
async def test_external_media_cannot_redirect_back_to_a_native_write(policy):
    calls = []
    def respond(request):
        calls.append(request)
        return httpx.Response(302, headers={'Location':NATIVE + '/ilias.php?cmd=delete&ref_id=123'})
    async with httpx.AsyncClient(transport=EgressTransport(policy=policy, inner=httpx.MockTransport(respond)),
                                cookies={'PHPSESSID':'private'}, follow_redirects=True) as client:
        with pytest.raises(OutboundTargetRejected):
            await client.get(MEDIA + '/file.pdf')
    assert len(calls) == 1 and calls[0].headers.get('cookie') is None


def test_development_local_exception_is_explicit_and_production_cannot_use_it(monkeypatch):
    with pytest.raises(ValueError):
        TargetPolicy('http://127.0.0.1:8000', [], allow_local=True)
    monkeypatch.setattr(settings, 'app_env', 'development')
    local = TargetPolicy('http://127.0.0.1:8000', [], allow_local=True)
    assert local.validate_url('http://127.0.0.1:8000/file.pdf')
    with pytest.raises(OutboundTargetRejected):
        local.validate_url('http://127.0.0.1:8001/file.pdf')
    with pytest.raises(ValueError):
        TargetPolicy('http://127.0.0.1:8000', [], allow_local=False)


@pytest.mark.parametrize('language', ['de','en'])
@pytest.mark.parametrize('kind', ['pdf','download'])
def test_proxy_api_rejects_invalid_targets_without_a_native_request(tmp_path, monkeypatch, language, kind):
    from backend.i18n import translate
    fake = IliasClient(manager=MagicMock())
    app.dependency_overrides[get_ilias_client] = lambda: fake
    try:
        api = TestClient(app)
        path = '/api/pdf/info' if kind == 'pdf' else '/api/materials/42/download'
        parameter = 'url' if kind == 'pdf' else 'custom_url'
        response = api.get(path, params={parameter:'https://127.0.0.1/private.pdf'}, headers={'Accept-Language':language})
    finally:
        app.dependency_overrides.pop(get_ilias_client, None)
    assert response.status_code == 400
    assert response.json() == {'detail':translate('outbound.target_blocked',language),'code':'OUTBOUND_TARGET_BLOCKED'}
    fake.session_manager.get_http_client.assert_not_called()


@pytest.mark.asyncio
async def test_bounded_pdf_probe_closes_large_response(monkeypatch):
    from backend.api.routes.materials import get_pdf_info
    delivered, closed = [], []
    class Body(httpx.AsyncByteStream):
        async def __aiter__(self):
            for _ in range(1000):
                delivered.append(32768)
                yield b'x' * 32768
        async def aclose(self):
            closed.append(True)
    def respond(request):
        return httpx.Response(200, stream=Body())  # Deliberately ignores Range.
    manager = MagicMock()
    manager.get_http_client.side_effect = lambda: httpx.AsyncClient(transport=httpx.MockTransport(respond))
    result = await get_pdf_info(NATIVE + '/test.pdf', IliasClient(manager=manager))
    assert result.aspect_ratio == 2.16
    assert sum(delivered) == 262144 and closed


@pytest.mark.asyncio
async def test_session_verification_does_not_accept_cookies_when_redirect_is_blocked(tmp_path, monkeypatch, policy):
    manager = SessionManager('alice', cookie_file=tmp_path/'cookies.json')
    monkeypatch.setattr(manager, 'load_cookies', lambda: {'PHPSESSID':'unverified','_shibsession_test':'present'})
    monkeypatch.setattr(manager, 'get_http_client', lambda: httpx.AsyncClient(follow_redirects=True,
        transport=EgressTransport(policy=policy, inner=httpx.MockTransport(lambda request:
            httpx.Response(302, headers={'Location':'https://127.0.0.1/private'})))))
    with pytest.raises(OutboundTargetRejected):
        await manager.verify_session()


@pytest.mark.parametrize('path,query', [
    ('/api/exercises/100&cmd=delete/submissions', {}),
    ('/api/exercises/100/submissions', {'ass_id':'20&cmd=delete'}),
    ('/api/exercises/100/submissions', [('ass_id','20'),('ass_id','21')]),
    ('/api/courses/42&cmd=doLogout/materials', {}),
])
def test_public_native_ids_cannot_inject_query_commands(tmp_path, monkeypatch, path, query):
    monkeypatch.setattr(settings, 'sessions_dir', str(tmp_path / 'sessions'))
    monkeypatch.setattr(settings, 'coordination_dir', str(tmp_path / 'coordination'))
    SessionManager('alice').save_cookies({'PHPSESSID':'private'})
    calls = AsyncMock()
    monkeypatch.setattr(IliasClient, 'get_exercise_submissions', calls)
    monkeypatch.setattr(IliasClient, 'get_course_materials', calls)
    response = TestClient(app).get(path, params=query, headers={'X-Session-Id':'alice'})
    assert response.status_code == 400
    calls.assert_not_awaited()


@pytest.mark.parametrize('kind,status', [('network',502),('timeout',504)])
def test_failed_cookie_verification_preserves_existing_tenant(tmp_path, monkeypatch, kind, status):
    monkeypatch.setattr(settings, 'sessions_dir', str(tmp_path/'sessions'))
    monkeypatch.setattr(settings, 'coordination_dir', str(tmp_path/'coordination'))
    manager=SessionManager('alice')
    manager.save_cookies({'PHPSESSID':'working'},{'user_name':'Alice'})
    def failed(request):
        if kind=='timeout':
            raise httpx.ConnectTimeout('simulated timeout',request=request)
        raise httpx.ConnectError('simulated offline',request=request)
    monkeypatch.setattr(SessionManager,'get_http_client',lambda self:
        httpx.AsyncClient(transport=httpx.MockTransport(failed)))
    response=TestClient(app).post('/api/auth/sync',json=dict(session_id='alice',
        cookies={'PHPSESSID':'unverified','_shibsession_test':'not-proof'}))
    assert response.status_code==status
    assert manager.load_cookies()=={'PHPSESSID':'working'}
    assert manager.load_metadata()['user_name']=='Alice'
    check=TestClient(app).get('/api/auth/status',headers={'X-Session-Id':'alice'})
    assert check.status_code==status  # Network trouble must not become a 401/logout.
