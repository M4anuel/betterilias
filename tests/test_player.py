import json
from pathlib import Path
from unittest.mock import MagicMock

import httpx
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from backend.api.deps import get_ilias_client
from backend.main import app

from backend.scrapers.player import parse_player
from backend.scrapers.dumper import ScrapingParsingError
from backend.services.ilias_client import IliasClient, SessionExpiredError

FIXTURE = Path(__file__).parent / 'fixtures/unibe/unibe_paella_player.html'
URL = 'https://ilias.unibe.ch/ilias.php?cmdClass=xoctPlayerGUI&cmd=streamVideo&ref_id=3753762&eid=test-episode'


def test_saved_player_roles_renditions_duration_and_chapter_units():
    result = parse_player(FIXTURE.read_text(encoding='utf-8'), URL)
    assert [stream.content for stream in result.streams] == ['presenter', 'presentation']
    assert [stream.main_audio for stream in result.streams] == [True, False]
    assert [[source.height for source in stream.renditions] for stream in result.streams] == [[480, 720, 1080], [480, 720, 1080]]
    assert result.duration == 5022.72
    assert len(result.chapters) == 42
    assert result.chapters[1].time == 119
    assert result.mp4_url.startswith('https://dist.opencast.unibe.ch/')


def config_html(config):
    return '<script>il.Opencast.Paella.player.init( \n' + json.dumps(config, indent=2) + ', {});</script>'


def single_config():
    return dict(streams=[dict(content='presentation', sources=dict(mp4=[dict(src='https://media.example/video.mp4?token=signed&expires=123', res=dict(w=1280, h=720))]))],
                metadata=dict(duration=12000), frameList=[dict(time=4, url='https://media.example/4.jpg'),
                dict(time=-1, url='https://media.example/invalid.jpg'), dict(time=50, url='https://media.example/past-end.jpg'),
                dict(time=1, url='javascript:alert(1)')])


def test_single_stream_signed_urls_and_invalid_chapters():
    result = parse_player(config_html(single_config()), URL)
    assert result.streams[0].main_audio
    assert result.streams[0].renditions[0].url.endswith('?token=signed&expires=123')
    assert [chapter.time for chapter in result.chapters] == [4]
    assert result.duration == 12


def test_caption_metadata_supports_native_language_objects_and_filters_formats():
    config = single_config()
    config['captions'] = [
        dict(url='https://dist.opencast.unibe.ch/subtitles.vtt?token=signed', format='vtt', lang=dict(code='de', txt='Deutsch')),
        dict(src='https://dist.opencast.unibe.ch/subtitles.srt', format='srt', language='en', label='English'),
        dict(url='javascript:alert(1)', format='vtt'),
        dict(url='https://dist.opencast.unibe.ch/subtitles.xml', format='dfxp'),
    ]
    result = parse_player(config_html(config), URL)
    assert [(caption.language, caption.label, caption.format) for caption in result.captions] == [('de', 'Deutsch', 'vtt'), ('en', 'English', 'srt')]
    assert result.captions[0].url.endswith('?token=signed')


@pytest.mark.asyncio
@pytest.mark.parametrize('format', ['vtt', 'srt'])
async def test_caption_delivery_resolves_the_native_manifest_and_normalizes_srt(format):
    config = single_config()
    config['captions'] = [dict(url=f'https://dist.opencast.unibe.ch/captions.{format}', format=format, lang='en')]
    requests = []
    def respond(request):
        requests.append(request)
        if request.url.host == 'ilias.unibe.ch':
            return httpx.Response(200, text=config_html(config))
        text = 'WEBVTT\n\n00:00:00.000 --> 00:00:06.000\nHello\n' if format == 'vtt' else '1\n00:00:00,000 --> 00:00:06,000\nHello\n'
        return httpx.Response(200, text=text)
    manager = MagicMock()
    manager.has_cookies.return_value = True
    manager.get_http_client.side_effect = lambda: httpx.AsyncClient(transport=httpx.MockTransport(respond))
    text = await IliasClient(manager).get_video_captions(URL, 0)
    assert text.startswith('WEBVTT') and '00:00:00.000 --> 00:00:06.000' in text
    assert len(requests) == 2


def test_caption_endpoint_is_private_and_requires_the_resolved_session():
    config = single_config()
    config['captions'] = [dict(url='https://dist.opencast.unibe.ch/captions.vtt', format='vtt', lang='en')]
    def respond(request):
        return httpx.Response(200, text=config_html(config) if request.url.host == 'ilias.unibe.ch' else 'WEBVTT\n\n00:00.000 --> 00:01.000\nHello\n')
    manager = MagicMock()
    manager.has_cookies.return_value = True
    manager.get_http_client.side_effect = lambda: httpx.AsyncClient(transport=httpx.MockTransport(respond))
    app.dependency_overrides[get_ilias_client] = lambda: IliasClient(manager)
    try:
        with TestClient(app) as client:
            response = client.get('/api/courses/video-captions', params=dict(url=URL, track=0))
            assert response.status_code == 200
            assert response.headers['cache-control'] == 'private, no-store'
            assert response.headers['content-type'].startswith('text/vtt')
            manager.has_cookies.return_value = False
            assert client.get('/api/courses/video-captions', params=dict(url=URL, track=0)).status_code == 401
    finally:
        app.dependency_overrides.pop(get_ilias_client, None)


@pytest.mark.asyncio
@pytest.mark.parametrize('url,status,body', [
    ('https://127.0.0.1/private.vtt', 200, 'WEBVTT'),
    ('https://dist.opencast.unibe.ch/captions.vtt', 302, ''),
    ('https://dist.opencast.unibe.ch/captions.vtt', 200, '<html>Login</html>'),
    ('https://dist.opencast.unibe.ch/captions.vtt', 200, 'WEBVTT' + 'x' * (2 * 1024 * 1024)),
], ids=['untrusted-host', 'redirect', 'invalid-vtt', 'oversized-vtt'])
async def test_caption_proxy_rejects_untrusted_redirected_invalid_or_oversized_content(url, status, body):
    config = single_config()
    config['captions'] = [dict(url=url, format='vtt')]
    requests = []
    def respond(request):
        requests.append(request)
        return httpx.Response(200, text=config_html(config)) if request.url.host == 'ilias.unibe.ch' else httpx.Response(status, text=body, headers={'Location':'https://127.0.0.1/private'})
    manager = MagicMock()
    manager.has_cookies.return_value = True
    manager.get_http_client.side_effect = lambda: httpx.AsyncClient(transport=httpx.MockTransport(respond))
    with pytest.raises(HTTPException):
        await IliasClient(manager).get_video_captions(URL, 0)
    assert all(request.url.host != '127.0.0.1' for request in requests)


@pytest.mark.parametrize('html', ['<main>Not a player</main>', config_html(dict(streams=[])),
    config_html(dict(streams=single_config()['streams'] * 2))])
def test_unsupported_shapes_are_reported_and_dumped(html, tmp_path, monkeypatch):
    monkeypatch.setattr('backend.scrapers.dumper.settings.logs_dir', str(tmp_path))
    with pytest.raises(ScrapingParsingError):
        parse_player(html, URL)


@pytest.mark.asyncio
async def test_authenticated_resolver_validates_target_and_propagates_expiry():
    requests = []
    expired = [False]
    def respond(request):
        requests.append(request)
        return httpx.Response(200, text='<input name="username"><input name="password">' if expired[0] else FIXTURE.read_text(encoding='utf-8'))
    manager = MagicMock()
    manager.has_cookies.return_value = True
    manager.get_http_client.side_effect = lambda: httpx.AsyncClient(transport=httpx.MockTransport(respond))
    service = IliasClient(manager)
    result = await service.resolve_video_stream(URL)
    assert len(result['streams']) == 2
    assert len(requests) == 1  # No episode listing or media bytes are prefetched.
    for invalid in ['https://example.org/player', URL.replace('xoctPlayerGUI', 'ilRepositoryGUI'), '/ilias.php?cmd=delete']:
        with pytest.raises(HTTPException) as error:
            await service.resolve_video_stream(invalid)
        assert error.value.status_code == 400
    assert len(requests) == 1
    expired[0] = True
    with pytest.raises(SessionExpiredError):
        await service.resolve_video_stream(URL)
