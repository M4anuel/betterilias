"""Sidebar resizing and account-scoped course pins in Chromium emulation."""
import json
import os
import re
from urllib.parse import urlparse

import pytest
from tests.test_localisation_browser import ROOT, local_site
from tests.test_mobile_refinement_browser import mock_api, assert_no_overflow

pytestmark = pytest.mark.skipif(os.environ.get('BETTERILIAS_BROWSER_TESTS') != '1', reason='Opt-in browser checks')


@pytest.mark.parametrize('language,scheme', [('de', 'dark'), ('de', 'light'), ('en', 'dark'), ('en', 'light')])
def test_sidebar_resize_pins_and_account_scope(local_site, language, scheme):
    pw = pytest.importorskip('playwright.sync_api')
    catalogue = json.loads((ROOT / 'locales' / f'{language}.json').read_text(encoding='utf-8'))
    def tr(key, **values):
        text = catalogue[key]
        for key, value in values.items():
            text = text.replace('{' + key + '}', str(value))
        return text
    def respond(route):
        if urlparse(route.request.url).path == '/api/courses/42/materials':
            items = [dict(ref_id='51', title='Folder one', item_type='fold', url='', properties={}),
                     dict(ref_id='200', title='Exercises', item_type='exc', url='https://ilias.unibe.ch/go/exc/200', properties={}),
                     dict(ref_id='300', title='Discussion forum', item_type='frm', url='https://ilias.unibe.ch/go/frm/300', properties={})]
            route.fulfill(content_type='application/json', body=json.dumps(dict(container_ref_id='42', title='Human Computer Interaction',
                items=items, blocks=[dict(id='materials', title='Materials', block_type='items', items=items),
                    dict(id='folders', title='Folders', block_type='items', items=[items[0], dict(items[0], ref_id='52', title='Folder two')])], sections=[],
                breadcrumbs=[dict(ref_id='42', title='Human Computer Interaction')], sessions=[], logs=[], rich_text_blocks=[])))
        else:
            mock_api(route)
    artifacts = ROOT / 'scratch' / 'sidebar-resize-pins'
    artifacts.mkdir(parents=True, exist_ok=True)
    with pw.sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport=dict(width=1280, height=900), color_scheme=scheme, has_touch=True)
        page.add_init_script(f"localStorage.setItem('betterilias_language','{language}'); localStorage.setItem('betterilias_theme_mode','{scheme}'); if (!localStorage.getItem('betterilias_session_id')) localStorage.setItem('betterilias_session_id','alice');")
        page.route('**/api/**', respond)
        page.route('https://cdn.jsdelivr.net/**', lambda route: route.abort())
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(local_site + '/?course=42', wait_until='domcontentloaded')
        nav = page.locator('#course-navigation')
        aside = nav.locator('aside')
        separator = page.get_by_role('separator', name=tr('sidebar.resize'))
        pw.expect(separator).to_be_visible()
        main = page.locator('main')
        pin = lambda title: main.get_by_role('button', name=tr('sidebar.pin', title=title), exact=True).first
        unpin = lambda title: main.get_by_role('button', name=tr('sidebar.unpin', title=title), exact=True).first
        for title in ['Folder one', 'Exercises', 'Discussion forum', 'Materials']:
            pin(title).click()
            pw.expect(nav.get_by_role('link', name=title, exact=True)).to_be_visible()
        pw.expect(nav.get_by_role('link', name='Discussion forum', exact=True)).to_have_attribute('href', 'https://ilias.unibe.ch/go/frm/300')
        # Drag to the maximum, including a pointer released outside the sidebar.
        box = separator.bounding_box()
        page.mouse.move(box['x'] + box['width']/2, 350)
        page.mouse.down()
        page.mouse.move(1000, 350, steps=8)
        page.mouse.up()
        pw.expect(aside).to_have_css('width', '640px')
        assert main.bounding_box()['width'] == 640
        assert main.locator('#course-block-folders .grid').evaluate('e => getComputedStyle(e).gridTemplateColumns.split(" ").length') == 2
        assert_no_overflow(page)
        page.screenshot(path=str(artifacts / f'{language}-{scheme}-half.png'), animations='disabled')
        # The limit follows viewport changes; the stored preferred width survives.
        page.set_viewport_size(dict(width=1100, height=800))
        pw.expect(aside).to_have_css('width', '550px')
        page.set_viewport_size(dict(width=1280, height=900))
        pw.expect(aside).to_have_css('width', '640px')
        separator.focus()
        separator.press('Home')
        pw.expect(aside).to_have_css('width', '64px')
        separator.press('ArrowRight')
        pw.expect(aside).to_have_css('width', '200px')
        separator.press('ArrowLeft')
        pw.expect(aside).to_have_css('width', '64px')
        separator.press('ArrowRight')
        pw.expect(aside).to_have_css('width', '200px')
        box = separator.bounding_box()
        page.mouse.move(box['x'] + box['width']/2, 350)
        page.mouse.down(); page.mouse.move(160, 350, steps=5); page.mouse.up()
        pw.expect(aside).to_have_css('width', '64px')
        separator.press('End')
        pw.expect(aside).to_have_css('width', '640px')
        # Native anchors support deep links, browser history and opening new tabs.
        nav.get_by_role('link', name='Folder one', exact=True).click()
        pw.expect(page).to_have_url(re.compile(r'course=42&folder=51'))
        pw.expect(unpin('Folder one')).to_be_visible()
        unpin('Folder one').click()
        pw.expect(nav.get_by_role('link', name='Folder one', exact=True)).to_have_count(0)
        pin('Folder one').click()
        nav.get_by_role('link', name='Exercises', exact=True).click()
        pw.expect(page).to_have_url(re.compile(r'exercise=200'))
        pw.expect(main.get_by_role('heading', name='Exercises', exact=True).first).to_be_visible()
        main.get_by_label(tr('mobile.actions'), exact=True).click()
        unpin('Exercises').click()
        pw.expect(nav.get_by_role('link', name='Exercises', exact=True)).to_have_count(0)
        main.get_by_label(tr('mobile.actions'), exact=True).click()
        pin('Exercises').click()
        # Changing sidebar width does not remount assignment filter inputs.
        search = main.get_by_placeholder(tr('Übungsblatt suchen...'))
        search.fill('draft')
        separator.press('Home'); separator.press('End')
        pw.expect(search).to_have_value('draft')
        nav.get_by_role('link', name='Materials', exact=True).click()
        pw.expect(page).to_have_url(re.compile(r'#course-block-materials$'))
        pw.expect(main.locator('#course-block-materials')).to_be_in_viewport()
        page.go_back(wait_until='domcontentloaded')
        pw.expect(page).to_have_url(re.compile(r'exercise=200'))
        page.go_forward(wait_until='domcontentloaded')
        pw.expect(main.locator('#course-block-materials')).to_be_in_viewport()
        page.reload(wait_until='domcontentloaded')
        pw.expect(aside).to_have_css('width', '640px')
        pw.expect(nav.get_by_role('link', name='Folder one', exact=True)).to_be_visible()
        # A failed storage write gives visible feedback and leaves the pin intact.
        page.evaluate("""() => { window.originalStorageWrite = Storage.prototype.setItem;
          Storage.prototype.setItem = function(key, value) {
            if (key.startsWith('betterilias_sidebar_pins_')) throw new Error('synthetic storage denial');
            return window.originalStorageWrite.call(this, key, value);
          }; }""")
        unpin('Folder one').click()
        pw.expect(main.get_by_role('alert').filter(has_text=tr('sidebar.save_error'))).to_be_visible()
        pw.expect(nav.get_by_role('link', name='Folder one', exact=True)).to_be_visible()
        page.evaluate('() => { Storage.prototype.setItem = window.originalStorageWrite; }')
        page.reload(wait_until='domcontentloaded')
        # Search spans the narrow workspace even on a wide desktop viewport.
        nav.get_by_role('button', name=tr('my_courses.title'), exact=True).click()
        membership_search = main.get_by_role('searchbox', name=tr('my_courses.search'))
        pw.expect(membership_search).to_be_visible()
        search_label = membership_search.locator('..').locator('..')
        assert abs(search_label.bounding_box()['width'] - search_label.locator('..').bounding_box()['width']) <= 1
        assert_no_overflow(page)
        # Full-screen mobile navigation remains usable at each required size.
        for width, height in [(320, 740), (390, 844), (430, 900), (768, 1024), (844, 390)]:
            page.set_viewport_size(dict(width=width, height=height))
            page.goto(local_site + '/?course=42', wait_until='domcontentloaded')
            pw.expect(separator).to_have_count(0)
            if width <= 430:
                pw.expect(main.locator('#course-block-folders .grid')).to_be_visible()
                assert main.locator('#course-block-folders .grid').evaluate('e => getComputedStyle(e).gridTemplateColumns.split(" ").length') == 1
            page.get_by_role('button', name=tr('Sidebar umschalten'), exact=True).click()
            pw.expect(page.locator('.mobile-navigation[open]')).to_be_visible()
            assert aside.bounding_box()['width'] == width
            pw.expect(separator).to_have_count(0)
            page.screenshot(path=str(artifacts / f'{language}-{scheme}-mobile-{width}.png'), animations='disabled')
            nav.get_by_role('link', name='Folder one', exact=True).tap()
            pw.expect(page.locator('.mobile-navigation[open]')).to_have_count(0)
            assert_no_overflow(page)
        # A new account must never inherit another account's pins.
        page.evaluate("localStorage.setItem('betterilias_session_id','bob'); window.dispatchEvent(new Event('betterilias-session-changed'))")
        page.get_by_role('button', name=tr('Sidebar umschalten'), exact=True).click()
        pw.expect(nav.get_by_role('link', name='Folder one', exact=True)).to_have_count(0)
        page.keyboard.press('Escape')
        page.evaluate("""localStorage.setItem('betterilias_sidebar_pins_bob', JSON.stringify([
          {id:'unsafe',courseId:'42',courseTitle:'Course',title:'Unsafe',href:'javascript:alert(1)'}
        ])); window.dispatchEvent(new Event('storage'));""")
        page.reload(wait_until='domcontentloaded')
        page.get_by_role('button', name=tr('Sidebar umschalten'), exact=True).click()
        pw.expect(nav.get_by_role('link', name='Folder one', exact=True)).to_have_count(0)
        pw.expect(nav.get_by_role('link', name='Unsafe', exact=True)).to_have_count(0)
        assert not errors
        browser.close()
