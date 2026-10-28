"""Real H.264/AAC decoding with mocked ILIAS and range-enabled local media."""
import json
import os
import re
from pathlib import Path
from urllib.parse import urlparse

import pytest
from tests.test_localisation_browser import local_site, ROOT
from tests.test_mobile_refinement_browser import mock_api, assert_no_overflow

pytestmark = pytest.mark.skipif(os.environ.get('BETTERILIAS_BROWSER_TESTS') != '1', reason='Opt-in Chromium media tests')
URL = 'https://ilias.unibe.ch/ilias.php?cmdClass=xoctPlayerGUI&cmd=streamVideo&ref_id=60&eid=episode-one'
MEDIA = (Path(__file__).parent / 'fixtures/player-test.mp4').read_bytes()


def player_api(route, single=False, failure=False, embedded=False):
    path = urlparse(route.request.url).path
    if path.endswith('/video-stream-info'):
        base = route.request.url.split('/api/')[0]
        streams = [dict(content=kind, main_audio=kind == 'presenter', renditions=[
            dict(url=f'{base}/media/{kind}-{height}.mp4', width=320, height=height, mimetype='video/mp4') for height in [480, 720, 1080]])
            for kind in ['presenter', 'presentation']]
        data = dict(streams=streams[:1] if single else streams, chapters=[] if single else [dict(time=0, image=base+'/media/slide.svg', text=''), dict(time=6, image=base+'/media/slide.svg', text='')],
                    duration=12, title='Recording one', preview_url=None, fallback_url=URL)
        route.fulfill(status=401 if failure else 200, content_type='application/json', body=json.dumps(data))
    elif path == '/api/podcasts/60':
        data = dict(ref_id='60', title='Lecture recordings', total_episodes=1, recorded_count=1, scheduled_count=0, pages_available=[],
                    episodes=[dict(id='episode-one', title='Recording one', status='available', stream_url=URL)])
        route.fulfill(status=200, content_type='application/json', body=json.dumps(data))
    elif path == '/api/courses/42/materials':
        item = dict(ref_id='60', title='Lecture recordings', item_type='mcst', url='', properties={})
        data = dict(container_ref_id='42', title='Test course', items=[item], blocks=[dict(id='recordings', block_type='items', items=[item])], sections=[], sessions=[], logs=[], rich_text_blocks=[], breadcrumbs=[])
        if embedded:
            data['blocks'] = [dict(id='video', block_type='text', html_content=f'<div class="ocpc-container"><iframe src="{URL}"></iframe></div>')]
        route.fulfill(status=200, content_type='application/json', body=json.dumps(data))
    else:
        mock_api(route)


def media_route(route):
    if route.request.url.endswith('.svg'):
        route.fulfill(content_type='image/svg+xml', body='<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#0AACA5"/><text x="20" y="90" fill="white">Test slide</text></svg>')
        return
    match = re.match(r'bytes=(\d+)-(\d*)', route.request.headers.get('range', ''))
    start, end = (int(match[1]), int(match[2]) if match[2] else len(MEDIA)-1) if match else (0, len(MEDIA)-1)
    headers = {'Accept-Ranges': 'bytes', 'Content-Length': str(end-start+1)}
    if match:
        headers['Content-Range'] = f'bytes {start}-{end}/{len(MEDIA)}'
    route.fulfill(status=206 if match else 200, content_type='video/mp4', headers=headers, body=MEDIA[start:end+1])


@pytest.mark.parametrize('width,height', [(320,740), (390,800), (430,800), (768,850), (1280,900), (740,360)])
@pytest.mark.parametrize('language,scheme', [('de','dark'), ('de','light'), ('en','dark'), ('en','light')])
def test_dual_stream_playback_quality_layouts_and_chapters(local_site, width, height, language, scheme):
    pw = pytest.importorskip('playwright.sync_api')
    tr = json.loads((ROOT/'locales'/f'{language}.json').read_text(encoding='utf-8')).__getitem__
    with pw.sync_playwright() as p:
        browser = p.chromium.launch(headless=True, channel=os.environ.get('BETTERILIAS_BROWSER_CHANNEL'))
        page = browser.new_page(viewport=dict(width=width, height=height), color_scheme=scheme, has_touch=width < 768)
        page.set_default_timeout(10000)
        page.add_init_script(f"localStorage.setItem('betterilias_language', '{language}');localStorage.setItem('betterilias_theme_mode', '{scheme}');")
        requests, errors = [], []
        def respond(route):
            if '/video-stream-info' in route.request.url:
                requests.append(route.request)
            player_api(route)
        page.route('**/api/**', respond)
        page.route('**/media/**', media_route)
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(local_site+'/?course=42')
        page.get_by_text('Lecture recordings', exact=True).click()
        stream_button = page.get_by_role('button', name=tr('Streamen'), exact=True)
        pw.expect(stream_button).to_be_visible()
        assert not requests
        stream_button.click()
        dialog = page.locator('dialog.podcast-player-dialog')
        audio = dialog.locator('video[data-stream="audio"]')
        slides = dialog.locator('video[data-stream="slides"]')
        pw.expect(audio).to_have_count(1)
        page.wait_for_function("Array.from(document.querySelectorAll('dialog video')).every(v => v.readyState >= 3)")
        assert len(requests) == 1
        assert requests[0].headers['accept-language'] == language
        dialog.get_by_role('button', name=tr('player.play'), exact=True).click()
        page.wait_for_function("document.querySelector('[data-stream=audio]').currentTime > .4")
        dialog.get_by_role('button', name=tr('player.pause'), exact=True).click()
        assert audio.evaluate('v => v.paused && !v.muted')
        assert slides.evaluate('v => v.paused && v.muted')
        assert abs(audio.evaluate('v => v.currentTime') - slides.evaluate('v => v.currentTime')) < .35
        dialog.get_by_role('combobox', name=tr('player.speed'), exact=True).select_option('1.5')
        assert audio.evaluate('v => v.playbackRate') == 1.5
        assert slides.evaluate('v => v.playbackRate') == 1.5
        dialog.locator('summary').click()
        dialog.get_by_role('button', name=tr('player.chapter').replace('{number}', '2').replace('{time}', '00:06'), exact=True).click()
        page.wait_for_function("Array.from(document.querySelectorAll('dialog video')).every(v => Math.abs(v.currentTime-6) < .2 && !v.seeking)")
        assert audio.evaluate('v => v.paused')
        layout = dialog.get_by_role('combobox', name=tr('player.layout'), exact=True)
        layout.select_option('split')
        before = audio.evaluate('v => v.parentElement.style.order')
        dialog.get_by_role('button', name=tr('player.swap'), exact=True).click()
        assert audio.evaluate('v => v.parentElement.style.order') != before
        dialog.get_by_role('button', name=tr('player.saver'), exact=True).click()
        page.wait_for_function("document.querySelector('[data-stream=audio]').readyState>=3 && !document.querySelector('[data-stream=audio]').seeking")
        assert audio.evaluate('v => v.currentSrc').endswith('presenter-480.mp4')
        assert slides.evaluate('v => v.currentSrc').endswith('presentation-1080.mp4')
        assert audio.evaluate('v => v.paused && !v.muted && Math.abs(v.currentTime-6)<.2')
        pw.expect(layout).to_have_value('slides')
        dialog.get_by_role('button', name=tr('player.play'), exact=True).click()
        page.wait_for_function("document.querySelector('[data-stream=audio]').currentTime > 6.4")
        # A rendition change while playing restores the clock, speed and intent.
        dialog.get_by_role('combobox', name=tr('player.camera_quality'), exact=True).select_option('1')
        page.wait_for_function("document.querySelector('[data-stream=audio]').currentSrc.endsWith('presenter-720.mp4') && !document.querySelector('[data-stream=audio]').paused && document.querySelector('[data-stream=audio]').currentTime>6")
        dialog.get_by_role('button', name=tr('player.pause'), exact=True).click()
        assert audio.evaluate('v => v.playbackRate') == 1.5
        layout.select_option('inset')
        assert_no_overflow(page)
        assert dialog.evaluate('e => e.scrollWidth <= e.clientWidth+1')
        dialog.locator('summary').click()
        dialog.evaluate('e => e.scrollTop=0')
        page.screenshot(path=f'.pytest_cache/player-{width}-{height}-{language}-{scheme}.png', animations='disabled')
        page.keyboard.press('Escape')
        pw.expect(dialog).to_have_count(0)
        pw.expect(stream_button).to_be_focused()
        assert not errors
        browser.close()


def test_embedded_player_drift_buffering_rejected_play_and_retry(local_site):
    pw = pytest.importorskip('playwright.sync_api')
    with pw.sync_playwright() as p:
        browser=p.chromium.launch(headless=True, channel=os.environ.get('BETTERILIAS_BROWSER_CHANNEL'))
        page=browser.new_page(viewport=dict(width=390,height=800))
        page.set_default_timeout(10000)
        page.add_init_script("localStorage.setItem('betterilias_language','en')")
        requests=[]
        def respond(route):
            if '/video-stream-info' in route.request.url:
                requests.append(route.request)
            player_api(route,embedded=True)
        page.route('**/api/**',respond)
        page.route('**/media/**',media_route)
        page.goto(local_site+'/?course=42')
        trigger=page.locator('.betterilias-video-play-btn')
        pw.expect(trigger).to_be_visible()
        assert not requests
        trigger.focus()
        page.keyboard.press('Enter')
        dialog=page.locator('dialog.podcast-player-dialog')
        page.wait_for_function("document.querySelectorAll('dialog video').length===2 && Array.from(document.querySelectorAll('dialog video')).every(v => v.readyState>=3)")
        audio=dialog.locator('[data-stream=audio]')
        slides=dialog.locator('[data-stream=slides]')
        # Rejection is handled locally; retry remains available without an
        # unhandled promise or a silently muted recording.
        audio.evaluate("v => {v.play=()=>Promise.reject(new DOMException('blocked','NotAllowedError'))}")
        dialog.get_by_role('button',name='Play',exact=True).click()
        pw.expect(dialog.get_by_role('alert')).to_contain_text('Playback could not start')
        audio.evaluate('v => delete v.play')
        dialog.get_by_role('button',name='Play',exact=True).click()
        page.wait_for_function("document.querySelector('[data-stream=audio]').currentTime>.3")
        slides.evaluate('v => {v.currentTime+=1}')
        page.wait_for_function("Math.abs(document.querySelector('[data-stream=audio]').currentTime-document.querySelector('[data-stream=slides]').currentTime)<.3")
        slides.evaluate("v => v.dispatchEvent(new Event('waiting'))")
        assert audio.evaluate('v => v.paused') and slides.evaluate('v => v.paused')
        pw.expect(dialog.get_by_role('status')).to_contain_text('Waiting for both streams')
        slides.evaluate("v => v.dispatchEvent(new Event('canplay'))")
        page.wait_for_function("Array.from(document.querySelectorAll('dialog video')).every(v => !v.paused)")
        dialog.get_by_role('button',name='Pause',exact=True).click()
        if dialog.get_by_role('button',name='Full screen',exact=True).count():
            dialog.get_by_role('button',name='Full screen',exact=True).click()
            page.wait_for_function('Boolean(document.fullscreenElement)')
            dialog.get_by_role('button',name='Exit full screen',exact=True).click()
            page.wait_for_function('!document.fullscreenElement')
        slides.evaluate("v => v.dispatchEvent(new Event('error'))")
        pw.expect(dialog.get_by_role('alert')).to_contain_text('A stream could not be played')
        dialog.get_by_role('button',name='Reload recording',exact=True).click()
        pw.expect(dialog.get_by_role('alert')).to_have_count(0)
        pw.expect(dialog.locator('video')).to_have_count(2)
        assert len(requests)==2
        dialog.get_by_role('button',name='Close',exact=True).click()
        pw.expect(trigger).to_be_focused()
        browser.close()


@pytest.mark.parametrize('single,failure', [(True,False), (False,True)])
def test_single_stream_and_resolution_failure(local_site, single, failure):
    pw = pytest.importorskip('playwright.sync_api')
    with pw.sync_playwright() as p:
        browser=p.chromium.launch(headless=True, channel=os.environ.get('BETTERILIAS_BROWSER_CHANNEL'))
        page=browser.new_page()
        page.add_init_script("localStorage.setItem('betterilias_language','en')")
        page.route('**/api/**', lambda route: player_api(route, single=single, failure=failure))
        page.route('**/media/**',media_route)
        page.goto(local_site+'/?course=42')
        page.get_by_text('Lecture recordings',exact=True).click()
        page.get_by_role('button', name='Stream', exact=True).click()
        dialog=page.locator('dialog.podcast-player-dialog')
        if failure:
            pw.expect(dialog.get_by_role('alert')).to_be_visible()
            pw.expect(dialog.get_by_role('link')).to_have_attribute('href',URL)
        else:
            pw.expect(dialog.locator('video')).to_have_count(1)
            pw.expect(dialog.get_by_role('combobox',name='Layout')).to_have_count(0)
            dialog.get_by_role('button',name='Play',exact=True).click()
            page.wait_for_function("document.querySelector('dialog video').currentTime>.3")
        browser.close()
