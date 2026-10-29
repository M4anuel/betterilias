"""Real H.264/AAC decoding with mocked ILIAS and range-enabled local media."""
import json
import os
import re
from pathlib import Path
from urllib.parse import urlparse, parse_qs

import pytest
from tests.test_localisation_browser import local_site, ROOT
from tests.test_mobile_refinement_browser import mock_api, assert_no_overflow

pytestmark = pytest.mark.skipif(os.environ.get('BETTERILIAS_BROWSER_TESTS') != '1', reason='Opt-in Chromium media tests')
URL = 'https://ilias.unibe.ch/ilias.php?cmdClass=xoctPlayerGUI&cmd=streamVideo&ref_id=60&eid=episode-one'
MEDIA = (Path(__file__).parent / 'fixtures/player-test.mp4').read_bytes()


@pytest.mark.parametrize('width,height,language,scheme', [(320,740,'de','dark'),(390,800,'en','light'),(430,800,'de','light'),(768,850,'en','dark'),(1280,900,'de','dark'),(740,360,'en','light')])
def test_preferences_and_recording_sort(local_site,width,height,language,scheme):
    pw=pytest.importorskip('playwright.sync_api')
    tr=json.loads((ROOT/'locales'/f'{language}.json').read_text(encoding='utf-8')).__getitem__
    episodes=[dict(id='a',title='Lecture 2',recorded_at='2026-09-01T10:00:00Z',uploaded_at='2026-12-01T10:00:00Z'),
              dict(id='b',title='Lecture 10',date='2. Okt 2026, 09:00'),
              dict(id='c',title='Lecture 1',recorded_at='2027-01-01T10:00:00Z'),
              dict(id='d',title='Undated')]
    for ep in episodes:
        ep.update(status='available',stream_url=URL.replace('episode-one',ep['id']))
    with pw.sync_playwright() as p:
        browser=p.chromium.launch(headless=True,channel=os.environ.get('BETTERILIAS_BROWSER_CHANNEL'))
        page=browser.new_page(viewport=dict(width=width,height=height),color_scheme=scheme,has_touch=width<768)
        page.set_default_timeout(10000)
        page.add_init_script(f"localStorage.setItem('betterilias_language','{language}');localStorage.setItem('betterilias_theme_mode','{scheme}')")
        def respond(route):
            if urlparse(route.request.url).path=='/api/podcasts/60':
                route.fulfill(content_type='application/json',body=json.dumps(dict(ref_id='60',title='Lecture recordings',total_episodes=4,recorded_count=4,scheduled_count=0,pages_available=[],episodes=episodes)))
            else:player_api(route,captions=True)
        page.route('**/api/**',respond)
        page.route('**/media/**',media_route)
        def open_list():
            page.get_by_text('Lecture recordings',exact=True).click()
            pw.expect(page.locator('[data-recording-id]')).to_have_count(4)
        def order():
            return page.locator('[data-recording-id]').evaluate_all("es=>es.map(e=>e.dataset.recordingId)")
        def open_player(identifier):
            page.locator(f'[data-recording-id="{identifier}"]').get_by_role('button',name=tr('Streamen'),exact=True).click()
            page.wait_for_function("document.querySelectorAll('dialog video').length===2 && Array.from(document.querySelectorAll('dialog video')).every(v=>v.readyState>=3)")
        page.goto(local_site+'/?course=42')
        open_list()
        field=page.get_by_role('combobox',name=tr('recordings.sort_by'),exact=True)
        direction=page.get_by_role('combobox',name=tr('recordings.direction'),exact=True)
        assert order()==['c','a','b','d']
        direction.select_option('asc')
        assert order()==['b','a','c','d']
        field.select_option('title')
        assert order()==['c','a','b','d']
        direction.select_option('desc')
        assert order()==['d','b','a','c']
        search=page.get_by_placeholder(tr('Episode suchen...'),exact=True)
        search.fill('Lecture')
        pw.expect(page.locator('[data-recording-id]')).to_have_count(3)
        assert order()==['b','a','c']
        search.clear()
        assert_no_overflow(page)
        page.screenshot(path=f'.pytest_cache/recording-sort-{width}-{height}-{language}-{scheme}.png',animations='disabled')
        # The last recording remains reachable even in short landscape viewports.
        region=page.get_by_role('region',name=tr('Opencast Vorlesungsaufzeichnungen'),exact=True)
        last=page.locator('[data-recording-id="c"]')
        last.scroll_into_view_if_needed()
        bounds=last.bounding_box()
        viewport=region.bounding_box()
        assert bounds['y']+bounds['height'] <= viewport['y']+viewport['height']+1
        page.screenshot(path=f'.pytest_cache/recording-sort-scrolled-{width}-{height}-{language}-{scheme}.png',animations='disabled')
        open_player('a')
        dialog=page.locator('dialog.podcast-player-dialog')
        dialog.get_by_role('button',name=tr('player.single'),exact=True).click()
        dialog.get_by_role('combobox',name=tr('player.speed'),exact=True).select_option('1.5')
        volume=dialog.get_by_role('slider',name=tr('player.volume'),exact=True)
        volume.focus()
        volume.press('Home')
        volume.press('ArrowRight')
        mute=dialog.get_by_role('button',name=tr('player.mute'),exact=True)
        icon=mute.locator('svg').bounding_box()
        mute.click()
        muted_icon=dialog.get_by_role('button',name=tr('player.unmute'),exact=True).locator('svg').bounding_box()
        assert icon['width']==muted_icon['width']==20 and icon['height']==muted_icon['height']==20
        page.keyboard.press('c')
        dialog.get_by_role('button',name=tr('player.settings'),exact=True).click()
        dialog.get_by_role('combobox',name=tr('player.camera_quality'),exact=True).select_option('0')
        dialog.get_by_role('combobox',name=tr('player.subtitle_language'),exact=True).select_option('1')
        page.keyboard.press('Escape')
        page.keyboard.press('Escape')
        # Reload and another episode share preferences, but not playback clocks.
        page.reload()
        open_list()
        pw.expect(field).to_have_value('title')
        pw.expect(direction).to_have_value('desc')
        open_player('b')
        pw.expect(dialog.locator('[data-stream=audio]')).to_be_hidden()
        pw.expect(dialog.locator('[data-stream=slides]')).to_be_visible()
        assert dialog.locator('[data-stream=audio]').evaluate('v=>v.muted && v.volume===.05 && v.playbackRate===1.5 && v.currentTime<.1')
        assert dialog.locator('[data-stream=audio]').evaluate("v=>v.currentSrc.endsWith('presenter-480.mp4')")
        pw.expect(dialog.get_by_role('button',name=tr('player.captions'),exact=True)).to_have_attribute('aria-pressed','true')
        dialog.get_by_role('button',name=tr('player.settings'),exact=True).click()
        pw.expect(dialog.get_by_role('combobox',name=tr('player.subtitle_language'),exact=True)).to_have_value('1')
        page.keyboard.press('Escape')
        dialog.get_by_role('button',name=tr('player.swap'),exact=True).click()
        page.keyboard.press('Escape')
        open_player('c')
        pw.expect(dialog.locator('[data-stream=audio]')).to_be_visible()
        pw.expect(dialog.locator('[data-stream=slides]')).to_be_hidden()
        page.keyboard.press('Escape')
        page.evaluate("localStorage.setItem('betterilias_session_id','another-preference-viewer')")
        open_player('c')
        pw.expect(dialog.get_by_role('button',name=tr('player.inset'),exact=True)).to_have_attribute('aria-pressed','true')
        assert dialog.locator('[data-stream=audio]').evaluate('v=>!v.muted && v.volume===1 && v.playbackRate===1')
        browser.close()


def player_api(route, single=False, failure=False, embedded=False, captions=False):
    path = urlparse(route.request.url).path
    if path.endswith('/video-stream-info'):
        base = route.request.url.split('/api/')[0]
        streams = [dict(content=kind, main_audio=kind == 'presenter', renditions=[
            dict(url=f'{base}/media/{kind}-{height}.mp4', width=320, height=height, mimetype='video/mp4') for height in [480, 720, 1080]])
            for kind in ['presenter', 'presentation']]
        data = dict(streams=streams[:1] if single else streams, captions=[dict(url=base+'/media/captions.vtt',language=lang,label=label,format='vtt') for lang,label in [('en','English'),('de','Deutsch')]] if captions else [], chapters=[] if single else [dict(time=0, image=base+'/media/slide-0.svg', text=''), dict(time=6, image=base+'/media/slide-6.svg', text='')],
                    duration=12, title='Recording one', preview_url=None, fallback_url=URL)
        route.fulfill(status=401 if failure else 200, content_type='application/json', body=json.dumps(data))
    elif path.endswith('/video-captions'):
        track=parse_qs(urlparse(route.request.url).query).get('track',['0'])[0]
        text='Hallo Untertitel' if track=='1' else 'Hello subtitles'
        route.fulfill(content_type='text/vtt',body=f'WEBVTT\n\n00:00:00.000 --> 00:00:12.000\n<b>{text}</b>\n')
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
        requests, errors, held = [], [], []
        def respond(route):
            if '/video-stream-info' in route.request.url:
                requests.append(route.request)
                held.append(route)
                return
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
        skeleton = dialog.locator('[data-player-skeleton]')
        pw.expect(skeleton).to_be_visible()
        stage_before = skeleton.bounding_box()
        header_before = dialog.get_by_role('heading', name='Recording one').bounding_box()
        page.screenshot(path=f'.pytest_cache/player-skeleton-{width}-{height}-{language}-{scheme}.png', animations='disabled')
        player_api(held.pop())
        audio = dialog.locator('video[data-stream="audio"]')
        slides = dialog.locator('video[data-stream="slides"]')
        pw.expect(audio).to_have_count(1)
        page.wait_for_function("Array.from(document.querySelectorAll('dialog video')).every(v => v.readyState >= 3)")
        pw.expect(dialog.locator('[data-media-skeleton]')).to_have_count(0)
        stage = dialog.locator('[data-player-layout]')
        stage_after = stage.bounding_box()
        header_after = dialog.get_by_role('heading', name='Recording one').bounding_box()
        assert abs(stage_before['height']-stage_after['height']) < 2
        assert abs(stage_before['y']-stage_after['y']) < 2
        assert abs(header_before['y']-header_after['y']) < 2
        stage.hover(position=dict(x=20,y=70))
        pw.expect(dialog.locator('.player-chapter-marker')).to_have_count(2)
        assert dialog.locator('details').count() == 0
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
        seek = dialog.get_by_role('slider', name=tr('player.seek'), exact=True)
        seek.focus()
        seek.press('PageUp')
        pw.expect(dialog.locator('.player-preview img')).to_be_visible()
        preview = dialog.locator('.player-preview').bounding_box()
        expected_width = 192 if width == 320 or height <= 450 else 256 if width < 640 else 288
        assert preview['width'] >= expected_width - 1
        canvas = stage.bounding_box()
        assert preview['x'] >= canvas['x'] and preview['x'] + preview['width'] <= canvas['x'] + canvas['width'] + 1
        assert preview['y'] >= canvas['y'] - 1
        page.screenshot(path=f'.pytest_cache/player-large-preview-{width}-{height}-{language}-{scheme}.png',animations='disabled')
        page.wait_for_function("Array.from(document.querySelectorAll('dialog video')).every(v => Math.abs(v.currentTime-6) < .2 && !v.seeking)")
        assert audio.evaluate('v => v.paused')
        dialog.get_by_role('button',name=tr('player.split'),exact=True).click()
        before = audio.evaluate('v => v.parentElement.style.order')
        dialog.get_by_role('button', name=tr('player.swap'), exact=True).click()
        assert audio.evaluate('v => v.parentElement.style.order') != before
        dialog.get_by_role('button',name=tr('player.settings'),exact=True).click()
        settings=dialog.get_by_role('dialog',name=tr('player.settings'),exact=True)
        settings.get_by_role('combobox',name=tr('player.camera_quality'),exact=True).select_option('0')
        settings.get_by_role('combobox',name=tr('player.slides_quality'),exact=True).select_option('2')
        page.keyboard.press('Escape')
        dialog.get_by_role('button',name=tr('player.single'),exact=True).click()
        page.wait_for_function("document.querySelector('[data-stream=audio]').readyState>=3 && !document.querySelector('[data-stream=audio]').seeking")
        assert audio.evaluate('v => v.currentSrc').endswith('presenter-480.mp4')
        assert slides.evaluate('v => v.currentSrc').endswith('presentation-1080.mp4')
        assert audio.evaluate('v => v.paused && !v.muted && Math.abs(v.currentTime-6)<.2')
        pw.expect(dialog.get_by_role('button',name=tr('player.single'),exact=True)).to_have_attribute('aria-pressed','true')
        pw.expect(audio).to_be_visible()
        pw.expect(slides).to_be_hidden()
        dialog.get_by_role('button',name=tr('player.swap'),exact=True).click()
        pw.expect(audio).to_be_hidden()
        pw.expect(slides).to_be_visible()
        dialog.get_by_role('button', name=tr('player.play'), exact=True).click()
        page.wait_for_function("document.querySelector('[data-stream=audio]').currentTime > 6.4")
        # A rendition change while playing restores the clock, speed and intent.
        dialog.get_by_role('button',name=tr('player.settings'),exact=True).click()
        dialog.get_by_role('combobox', name=tr('player.camera_quality'), exact=True).select_option('1')
        page.keyboard.press('Escape')
        page.wait_for_function("document.querySelector('[data-stream=audio]').currentSrc.endsWith('presenter-720.mp4') && !document.querySelector('[data-stream=audio]').paused && document.querySelector('[data-stream=audio]').currentTime>6")
        dialog.get_by_role('button', name=tr('player.pause'), exact=True).click()
        assert audio.evaluate('v => v.playbackRate') == 1.5
        dialog.get_by_role('button',name=tr('player.inset'),exact=True).click()
        assert_no_overflow(page)
        assert dialog.evaluate('e => e.scrollWidth <= e.clientWidth+1')
        seek.blur()
        dialog.evaluate('e => e.scrollTop=0')
        page.screenshot(path=f'.pytest_cache/player-{width}-{height}-{language}-{scheme}.png', animations='disabled')
        page.keyboard.press('Escape')
        pw.expect(dialog).to_have_count(0)
        pw.expect(stream_button).to_be_focused()
        assert not errors
        browser.close()


@pytest.mark.parametrize('width', [390,1280])
def test_overlay_loading_drag_previews_inactivity_and_keyboard(local_site,width):
    pw=pytest.importorskip('playwright.sync_api')
    with pw.sync_playwright() as p:
        browser=p.chromium.launch(headless=True,channel=os.environ.get('BETTERILIAS_BROWSER_CHANNEL'))
        page=browser.new_page(viewport=dict(width=width,height=800),has_touch=True,reduced_motion='reduce')
        page.set_default_timeout(10000)
        page.add_init_script("localStorage.setItem('betterilias_language','en')")
        page.route('**/api/**',lambda route: player_api(route))
        held=[]
        released=[False]
        def hold_media(route):
            if released[0] or route.request.url.endswith('.svg'):
                media_route(route)
            else:
                held.append(route)
        page.route('**/media/**',hold_media)
        page.goto(local_site+'/?course=42')
        page.get_by_text('Lecture recordings',exact=True).click()
        page.get_by_role('button',name='Stream',exact=True).click()
        dialog=page.locator('dialog.podcast-player-dialog')
        pw.expect(dialog.locator('[data-media-skeleton]')).to_be_visible()
        stage=dialog.locator('[data-player-layout]')
        before=stage.bounding_box()
        page.screenshot(path=f'.pytest_cache/player-media-loading-{width}.png',animations='disabled')
        released[0]=True
        for route in held:
            media_route(route)
        page.wait_for_function("Array.from(document.querySelectorAll('dialog video')).every(v => v.readyState>=3)")
        pw.expect(dialog.locator('[data-media-skeleton]')).to_have_count(0)
        assert stage.bounding_box()==before
        seek=dialog.get_by_role('slider',name='Playback position',exact=True)
        bounds=seek.bounding_box()
        page.mouse.move(bounds['x']+9,bounds['y']+bounds['height']/2)
        page.mouse.down()
        page.mouse.move(bounds['x']+8+(bounds['width']-16)*.7,bounds['y']+bounds['height']/2,steps=6)
        overlay=dialog.locator('.player-overlay')
        pw.expect(overlay).to_have_attribute('data-scrubbing','true')
        assert abs(seek.bounding_box()['y']-bounds['y'])<1
        pw.expect(dialog.locator('.player-preview img')).to_have_attribute('src',re.compile('slide-6.svg$'))
        assert dialog.locator('[data-stream=audio]').evaluate('v=>v.currentTime') < .1
        page.screenshot(path=f'.pytest_cache/player-scrub-preview-{width}.png',animations='disabled')
        page.mouse.up()
        page.wait_for_function("Array.from(document.querySelectorAll('dialog video')).every(v => v.currentTime>8 && !v.seeking)")
        seek.focus()
        seek.press('Home')
        page.wait_for_function("document.querySelector('[data-stream=audio]').currentTime<.1")
        volume=dialog.get_by_role('slider',name='Volume',exact=True)
        volume.focus()
        volume.press('Home')
        volume.press('ArrowRight')
        assert abs(dialog.locator('[data-stream=audio]').evaluate('v=>v.volume')-.05)<.001
        assert dialog.locator('.player-volume-cone').count()==0
        assert dialog.locator('.player-volume-bar').evaluate('e=>getComputedStyle(e).clipPath')=='none'
        assert dialog.locator('[data-volume-wave=outer]').get_attribute('opacity')=='0.3'
        page.clock.install()
        dialog.get_by_role('button',name='Play',exact=True).click()
        page.wait_for_function("document.querySelector('[data-stream=audio]').currentTime>.2")
        page.mouse.move(2,2)
        page.clock.fast_forward(3000)
        pw.expect(overlay).to_have_attribute('data-visible','false')
        # Touch reveals controls and toggles playback, with central feedback.
        stage.tap(position=dict(x=20,y=20))
        pw.expect(overlay).to_have_attribute('data-visible','true')
        assert dialog.locator('[data-stream=audio]').evaluate('v=>v.paused')
        pw.expect(dialog.locator('[data-feedback=pause]')).to_be_visible()
        page.keyboard.press('Space')
        page.clock.fast_forward(3000)
        pw.expect(overlay).to_have_attribute('data-visible','false')
        box=stage.bounding_box()
        page.mouse.move(box['x']+30,box['y']+30)
        pw.expect(overlay).to_have_attribute('data-visible','true')
        # Keyboard focus pins the controls, including while previewing a slide.
        stage.focus()
        stage.press('Tab')
        pw.expect(dialog.get_by_role('button',name='Picture in picture',exact=True)).to_be_focused()
        seek.focus()
        page.clock.fast_forward(3000)
        pw.expect(overlay).to_have_attribute('data-visible','true')
        seek.press('Tab')
        pw.expect(dialog.get_by_role('button',name='Pause',exact=True)).to_be_focused()
        dialog.get_by_role('button',name='Pause',exact=True).click()
        assert_no_overflow(page)
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
        dialog.get_by_role('button',name='Try again',exact=True).click()
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
            pw.expect(dialog.get_by_role('button',name='Try again',exact=True)).to_be_visible()
            assert dialog.get_by_role('link').count()==0
            page.keyboard.press('Escape')
            pw.expect(page.get_by_role('link',name='Open in ILIAS',exact=True).first).to_have_attribute('href',URL)
        else:
            pw.expect(dialog.locator('video')).to_have_count(1)
            pw.expect(dialog.get_by_role('combobox',name='Layout')).to_have_count(0)
            dialog.get_by_role('button',name='Play',exact=True).click()
            page.wait_for_function("document.querySelector('dialog video').currentTime>.3")
        browser.close()


@pytest.mark.parametrize('width,height', [(320,740),(390,800),(768,850),(1280,900),(740,360)])
@pytest.mark.parametrize('language,scheme', [('en','light'),('de','dark')])
def test_keyboard_canvas_layout_settings_and_subtitles(local_site,width,height,language,scheme):
    pw=pytest.importorskip('playwright.sync_api')
    tr=json.loads((ROOT/'locales'/f'{language}.json').read_text(encoding='utf-8')).__getitem__
    with pw.sync_playwright() as p:
        browser=p.chromium.launch(headless=True,channel=os.environ.get('BETTERILIAS_BROWSER_CHANNEL'))
        page=browser.new_page(viewport=dict(width=width,height=height),color_scheme=scheme,has_touch=True,reduced_motion='reduce')
        page.set_default_timeout(10000)
        page.add_init_script(f"localStorage.setItem('betterilias_language','{language}');localStorage.setItem('betterilias_theme_mode','{scheme}')")
        page.route('**/api/**',lambda route:player_api(route,captions=True))
        page.route('**/media/**',media_route)
        errors=[]
        page.on('pageerror',lambda error:errors.append(str(error)))
        page.goto(local_site+'/?course=42')
        page.get_by_text('Lecture recordings',exact=True).click()
        stream=page.get_by_role('button',name=tr('Streamen'),exact=True)
        link=stream.locator('..').get_by_role('link')
        pw.expect(link).to_have_attribute('href',URL)
        assert link.bounding_box()['y']>=stream.bounding_box()['y']+stream.bounding_box()['height']
        stream.click()
        dialog=page.locator('dialog.podcast-player-dialog')
        stage=dialog.locator('[data-player-layout]')
        page.wait_for_function("Array.from(document.querySelectorAll('dialog video')).every(v=>v.readyState>=3)")
        audio=dialog.locator('[data-stream=audio]')
        slides=dialog.locator('[data-stream=slides]')
        assert dialog.get_by_role('button',name=tr('player.reload'),exact=True).count()==0
        assert dialog.get_by_role('button',name=tr('player.saver'),exact=True).count()==0
        assert dialog.get_by_role('link').count()==0
        # Space toggles playback even when a different button has focus and is
        # never followed by a second native button activation on key-up.
        close=dialog.get_by_role('button',name=tr('Schliessen'),exact=True)
        close.focus()
        page.keyboard.press('Space')
        pw.expect(dialog.locator('[data-feedback=play]')).to_be_visible()
        page.wait_for_function("document.querySelector('[data-stream=audio]').currentTime>.2")
        page.keyboard.down('Space')
        page.keyboard.down('Space')
        page.keyboard.up('Space')
        assert audio.evaluate('v=>v.paused')
        pw.expect(dialog.locator('[data-feedback=pause]')).to_be_visible()
        page.clock.install()
        page.clock.fast_forward(1000)
        pw.expect(dialog.locator('.player-feedback')).to_have_count(0)
        # Direct canvas taps have identical behavior, including with hidden UI.
        canvas_point=stage.evaluate("e=>{const r=e.getBoundingClientRect(),a=e.querySelector('.player-top-controls').getBoundingClientRect(),b=e.querySelector('.player-overlay').getBoundingClientRect();return {x:r.width/2,y:(a.bottom+b.top)/2-r.y}}")
        stage.tap(position=canvas_point)
        page.wait_for_function("!document.querySelector('[data-stream=audio]').paused")
        stage.tap(position=canvas_point)
        assert audio.evaluate('v=>v.paused')
        page.mouse.move(2,2)
        page.clock.fast_forward(3000)
        pw.expect(dialog.locator('.player-overlay')).to_have_attribute('data-visible','false')
        stage.tap(position=canvas_point)
        page.wait_for_function("!document.querySelector('[data-stream=audio]').paused")
        page.keyboard.press('Space')
        assert audio.evaluate('v=>v.paused')
        page.keyboard.press('m')
        assert audio.evaluate('v=>v.muted') and slides.evaluate('v=>v.muted')
        page.keyboard.press('m')
        assert audio.evaluate('v=>!v.muted') and slides.evaluate('v=>v.muted')
        # Captions use an actual WebVTT track clock, even when the audio stream
        # is hidden by single view. Rendered cue markup remains plain text.
        page.keyboard.press('c')
        pw.expect(dialog.locator('.player-caption-layer')).to_have_text('Hello subtitles')
        assert dialog.locator('.player-caption-layer b').count()==0
        page.keyboard.press('c')
        pw.expect(dialog.locator('.player-caption-layer')).to_have_count(0)
        page.keyboard.press('c')
        pw.expect(dialog.locator('.player-caption-layer')).to_have_text('Hello subtitles')
        dialog.get_by_role('button',name=tr('player.settings'),exact=True).click()
        settings=dialog.get_by_role('dialog',name=tr('player.settings'),exact=True)
        language_select=settings.get_by_role('combobox',name=tr('player.subtitle_language'),exact=True)
        language_select.select_option('1')
        pw.expect(dialog.locator('.player-caption-layer')).to_have_text('Hallo Untertitel')
        # Space still controls playback inside a focused native quality select.
        quality=settings.get_by_role('combobox',name=tr('player.camera_quality'),exact=True)
        quality.select_option('0')
        page.wait_for_function("document.querySelector('[data-stream=audio]').currentSrc.endsWith('presenter-480.mp4') && document.querySelector('[data-stream=audio]').readyState>=3")
        quality.focus()
        page.keyboard.press('Space')
        page.wait_for_function("!document.querySelector('[data-stream=audio]').paused")
        page.keyboard.press('Space')
        assert audio.evaluate('v=>v.paused')
        page.keyboard.press('Escape')
        pw.expect(settings).to_have_count(0)
        pw.expect(dialog.get_by_role('button',name=tr('player.settings'),exact=True)).to_be_focused()
        for mode,label in [('inset','player.inset'),('split','player.split'),('slides','player.single')]:
            dialog.get_by_role('button',name=tr(label),exact=True).click()
            pw.expect(stage).to_have_attribute('data-player-layout',mode)
            swap=dialog.get_by_role('button',name=tr('player.swap'),exact=True)
            pw.expect(swap).to_be_enabled()
            swap.click()
            if mode=='slides':
                assert audio.is_visible()!=slides.is_visible()
                before=audio.is_visible()
                swap.click()
                assert audio.is_visible()!=before
                assert audio.evaluate('v=>!v.muted') and slides.evaluate('v=>v.muted')
        # Fullscreen contains only the player canvas and its own controls.
        page.keyboard.press('f')
        page.wait_for_function("document.fullscreenElement?.hasAttribute('data-player-layout')")
        assert stage.evaluate('e=>Math.abs(e.clientHeight-innerHeight)<2')
        assert stage.evaluate("e=>!!e.querySelector('.player-overlay') && !e.querySelector('h2')")
        page.keyboard.press('f')
        page.wait_for_function('!document.fullscreenElement')
        stage.focus()
        page.keyboard.press('ArrowRight')
        page.wait_for_function("document.querySelector('[data-stream=audio]').currentTime>=5")
        assert_no_overflow(page)
        page.clock.fast_forward(1000)
        stage.hover(position=dict(x=20,y=56))
        dialog.evaluate('e=>e.scrollTop=0')
        page.screenshot(path=f'.pytest_cache/player-keyboard-{width}-{height}-{language}-{scheme}.png',animations='disabled')
        dialog.get_by_role('button',name=tr('player.settings'),exact=True).click()
        settings.screenshot(path=f'.pytest_cache/player-settings-{width}-{height}-{language}-{scheme}.png',animations='disabled')
        page.keyboard.press('Escape')
        page.keyboard.press('f')
        page.wait_for_function('Boolean(document.fullscreenElement)')
        page.keyboard.press('Escape')
        page.wait_for_function('!document.fullscreenElement')
        pw.expect(dialog).to_be_visible()
        page.keyboard.press('Escape')
        pw.expect(dialog).to_have_count(0)
        pw.expect(stream).to_be_focused()
        assert not errors
        browser.close()


@pytest.mark.parametrize('width,height', [(320,740),(390,800),(430,800),(768,850),(1280,900),(740,360)])
def test_player_resume_volume_and_taller_geometry(local_site,width,height):
    pw=pytest.importorskip('playwright.sync_api')
    with pw.sync_playwright() as p:
        browser=p.chromium.launch(headless=True,channel=os.environ.get('BETTERILIAS_BROWSER_CHANNEL'))
        page=browser.new_page(viewport=dict(width=width,height=height),has_touch=width<768)
        page.set_default_timeout(10000)
        page.add_init_script("localStorage.setItem('betterilias_language','en')")
        native_url=[URL]
        def respond(route):
            if urlparse(route.request.url).path=='/api/podcasts/60':
                data=dict(ref_id='60',title='Lecture recordings',total_episodes=1,recorded_count=1,scheduled_count=0,pages_available=[],
                          episodes=[dict(id='episode-one',title='Recording one',status='available',stream_url=native_url[0])])
                route.fulfill(content_type='application/json',body=json.dumps(data))
            else:player_api(route)
        page.route('**/api/**',respond)
        page.route('**/media/**',media_route)
        def open_player():
            page.get_by_role('button',name='Stream',exact=True).click()
            page.wait_for_function("document.querySelectorAll('dialog video').length===2 && Array.from(document.querySelectorAll('dialog video')).every(v=>v.readyState>=3 && !v.seeking)")
        page.goto(local_site+'/?course=42')
        page.get_by_text('Lecture recordings',exact=True).click()
        open_player()
        dialog=page.locator('dialog.podcast-player-dialog')
        stage=dialog.locator('[data-player-layout]')
        pw.expect(stage).to_be_visible()
        assert stage.evaluate('e=>getComputedStyle(e).aspectRatio')=='16 / 10'
        if width==1280:
            bounds=stage.bounding_box()
            assert abs(bounds['width']/bounds['height']-1.6)<.01
            assert bounds['height']>height*.7
        stage.hover(position=dict(x=20,y=70))
        volume=dialog.get_by_role('slider',name='Volume',exact=True)
        volume.focus()
        volume.press('Home')
        volume.press('ArrowRight')
        pw.expect(dialog.locator('[data-volume-wave=outer]')).to_have_attribute('opacity','0.3')
        pw.expect(dialog.locator('[data-volume-wave=inner]')).to_have_attribute('opacity','0.3')
        volume.press('End')
        pw.expect(dialog.locator('[data-volume-wave=outer]')).to_have_attribute('opacity','1')
        assert dialog.locator('.player-volume-bar').bounding_box()['height']==8
        seek=dialog.get_by_role('slider',name='Playback position',exact=True)
        seek.focus()
        seek.press('PageUp')
        page.wait_for_function("Array.from(document.querySelectorAll('dialog video')).every(v=>Math.abs(v.currentTime-6)<.2 && !v.seeking)")
        page.keyboard.press('Space')
        page.wait_for_function("document.querySelector('[data-stream=audio]').currentTime>6.3")
        page.keyboard.press('Space')
        position=dialog.locator('[data-stream=audio]').evaluate('v=>v.currentTime')
        page.keyboard.press('Escape')
        saved=page.evaluate("JSON.parse(localStorage.getItem('betterilias_video_progress_local_60_episode-one'))")
        assert abs(saved['position']-position)<.2
        assert saved['lastStartedAt'] and saved['updatedAt'] and not saved['completed']
        # Routing nodes and tokens change without changing the saved episode.
        native_url[0]=URL+'&cmdNode=fresh-routing-node&rtoken=do-not-store-this-token'
        page.reload()
        page.get_by_text('Lecture recordings',exact=True).click()
        open_player()
        page.wait_for_function("Array.from(document.querySelectorAll('dialog video')).every(v=>v.currentTime>6 && !v.seeking)")
        assert dialog.locator('[data-stream=audio]').evaluate('v=>v.paused')
        assert page.evaluate("Object.keys(localStorage).filter(k=>k.startsWith('betterilias_video_progress_')).every(k=>!k.includes('rtoken')&&!k.includes('cmdNode'))")
        # Another tenant must not inherit the previous account's progress.
        page.keyboard.press('Escape')
        page.evaluate("localStorage.setItem('betterilias_session_id','another-video-viewer')")
        open_player()
        assert dialog.locator('[data-stream=audio]').evaluate('v=>v.currentTime')<.1
        seek.focus()
        seek.press('End')
        seek.press('ArrowLeft')
        page.keyboard.press('Space')
        page.wait_for_function("document.querySelector('[data-stream=audio]').ended")
        page.keyboard.press('Escape')
        saved=page.evaluate("JSON.parse(localStorage.getItem('betterilias_video_progress_another-video-viewer_60_episode-one'))")
        assert saved['completed'] and saved['position']==0
        open_player()
        assert dialog.locator('[data-stream=audio]').evaluate('v=>v.currentTime')<.1
        assert_no_overflow(page)
        dialog.evaluate('e=>e.scrollTop=0')
        stage.hover(position=dict(x=20,y=70))
        page.screenshot(path=f'.pytest_cache/player-resume-volume-{width}-{height}.png',animations='disabled')
        browser.close()
