import json
from pathlib import Path
from unittest.mock import MagicMock

import httpx
import pytest
from fastapi import HTTPException

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
