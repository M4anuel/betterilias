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
        browser = p.chromium.launch(channel=os.environ.get('BETTERILIAS_BROWSER_CHANNEL'))
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
        course_button = nav.locator('[data-sidebar-course="42"] button').first
        selected = nav.locator('[aria-current="page"]')
        confirmation = page.get_by_role('dialog', name=tr('sidebar.remove_title'), exact=True)
        sidebar_unpin = lambda title: nav.get_by_role('button', name=tr('sidebar.unpin', title=title), exact=True)
        folder_card = main.locator('#course-block-folders .grid > div').first
        card_pin = folder_card.get_by_role('button', name=tr('sidebar.pin', title='Folder one'), exact=True)
        assert card_pin.bounding_box()['x'] > folder_card.get_by_text('Folder one', exact=True).bounding_box()['x']
        assert card_pin.bounding_box()['x'] + card_pin.bounding_box()['width'] >= folder_card.bounding_box()['x'] + folder_card.bounding_box()['width'] - 16
        pw.expect(card_pin).to_have_css('cursor', 'pointer')
        grey_pin = card_pin.evaluate('e => getComputedStyle(e).color')
        pw.expect(card_pin.locator('.pin-icon-rest.lucide-pin')).to_be_visible()
        card_pin.hover()
        pw.expect(card_pin.locator('.pin-icon-hover.lucide-pin')).to_be_visible()
        lit_pin = card_pin.evaluate('e => getComputedStyle(e).color')
        assert lit_pin != grey_pin
        pw.expect(card_pin.locator('.pin-icon-rest')).not_to_be_visible()
        pw.expect(card_pin).to_have_attribute('aria-pressed', 'false')
        page.mouse.move(10, 10)
        card_pin.focus()
        page.keyboard.press('Tab'); page.keyboard.press('Shift+Tab')
        pw.expect(card_pin).to_be_focused()
        pw.expect(card_pin.locator('.pin-icon-hover')).to_be_visible()
        separator.focus()
        # Pin state stays lit; only a pinned hover previews the struck-through icon.
        card_pin.click()
        pinned_card = folder_card.get_by_role('button', name=tr('sidebar.unpin', title='Folder one'), exact=True)
        pw.expect(pinned_card).to_have_attribute('aria-pressed', 'true')
        page.mouse.move(10, 10)
        pw.expect(pinned_card.locator('.pin-icon-rest.lucide-pin')).to_be_visible()
        pw.expect(pinned_card).to_have_css('color', lit_pin)
        pinned_card.hover()
        pw.expect(pinned_card.locator('.pin-icon-hover.lucide-pin-off')).to_be_visible()
        pinned_card.click()
        pw.expect(card_pin).to_have_attribute('aria-pressed', 'false')
        pw.expect(card_pin).to_have_css('color', grey_pin)
        pw.expect(card_pin.locator('.pin-icon-rest.lucide-pin')).to_be_visible()
        page.mouse.move(10, 10)
        card_pin.hover()
        pw.expect(card_pin).to_have_css('color', lit_pin)
        page.mouse.move(10, 10)
        for title in ['Folder one', 'Exercises', 'Discussion forum', 'Materials']:
            pin(title).click()
            pw.expect(nav.get_by_role('link', name=title, exact=True)).to_be_visible()
        pw.expect(nav.get_by_role('link', name='Discussion forum', exact=True)).to_have_attribute('href', 'https://ilias.unibe.ch/go/frm/300')
        pw.expect(selected).to_have_count(1)
        pw.expect(course_button).to_have_attribute('aria-current', 'page')
        unpin('Folder one').hover()
        pw.expect(unpin('Folder one').locator('.pin-icon-hover.lucide-pin-off')).to_be_visible()
        pw.expect(unpin('Folder one')).to_have_attribute('aria-pressed', 'true')
        sidebar_unpin('Folder one').hover()
        pw.expect(sidebar_unpin('Folder one').locator('.pin-icon-hover.lucide-pin-off')).to_be_visible()
        pw.expect(sidebar_unpin('Folder one')).to_have_css('cursor', 'pointer')
        # Sidebar removal is deliberate, while content toggles remain immediate.
        sidebar_unpin('Folder one').click()
        pw.expect(confirmation).to_be_visible()
        pw.expect(confirmation.get_by_role('button', name=tr('Abbrechen'), exact=True)).to_be_focused()
        page.keyboard.press('Escape')
        pw.expect(confirmation).to_have_count(0)
        pw.expect(sidebar_unpin('Folder one')).to_be_focused()
        sidebar_unpin('Folder one').click()
        confirmation.get_by_role('button', name=tr('sidebar.remove_confirm'), exact=True).click()
        pw.expect(nav.get_by_role('link', name='Folder one', exact=True)).to_have_count(0)
        pw.expect(course_button).to_be_focused()
        pin('Folder one').click()
        page.screenshot(path=str(artifacts / f'{language}-{scheme}-expanded.png'), animations='disabled')
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
        pw.expect(aside).to_have_css('width', '68px')
        separator.press('ArrowRight')
        pw.expect(aside).to_have_css('width', '160px')
        page.screenshot(path=str(artifacts / f'{language}-{scheme}-narrow.png'), animations='disabled')
        separator.press('ArrowLeft')
        pw.expect(aside).to_have_css('width', '68px')
        page.screenshot(path=str(artifacts / f'{language}-{scheme}-collapsed.png'), animations='disabled')
        separator.press('ArrowRight')
        pw.expect(aside).to_have_css('width', '160px')
        box = separator.bounding_box()
        page.mouse.move(box['x'] + box['width']/2, 350)
        page.mouse.down(); page.mouse.move(170, 350, steps=5); page.mouse.up()
        pw.expect(aside).to_have_css('width', '170px')
        pw.expect(aside).to_have_attribute('data-sidebar-collapsed', 'false')
        box = separator.bounding_box()
        page.mouse.move(box['x'] + box['width']/2, 350)
        page.mouse.down(); page.mouse.move(120, 350, steps=5); page.mouse.up()
        pw.expect(aside).to_have_css('width', '68px')
        separator.press('End')
        pw.expect(aside).to_have_css('width', '640px')
        # Native anchors support deep links, browser history and opening new tabs.
        nav.get_by_role('link', name='Folder one', exact=True).click()
        pw.expect(page).to_have_url(re.compile(r'course=42&folder=51'))
        pw.expect(selected).to_have_count(1)
        pw.expect(nav.get_by_role('link', name='Folder one', exact=True)).to_have_attribute('aria-current', 'page')
        # Reordered query parameters and semester preferences do not lose selection.
        page.goto(local_site + '/?folder=51&semester=HS2026&course=42')
        pw.expect(nav.get_by_role('link', name='Folder one', exact=True)).to_have_attribute('aria-current', 'page')
        page.screenshot(path=str(artifacts / f'{language}-{scheme}-selected-folder.png'), animations='disabled')
        main.get_by_role('button', name='Nested folder', exact=True).click()
        pw.expect(page).to_have_url(re.compile(r'folder=53'))
        pw.expect(selected).to_have_count(1)
        pw.expect(course_button).to_have_attribute('aria-current', 'page')
        page.go_back()
        pw.expect(nav.get_by_role('link', name='Folder one', exact=True)).to_have_attribute('aria-current', 'page')
        pw.expect(unpin('Folder one')).to_be_visible()
        unpin('Folder one').click()
        pw.expect(nav.get_by_role('link', name='Folder one', exact=True)).to_have_count(0)
        pw.expect(confirmation).to_have_count(0)
        pw.expect(course_button).to_have_attribute('aria-current', 'page')
        pin('Folder one').click()
        nav.get_by_role('link', name='Exercises', exact=True).click()
        pw.expect(page).to_have_url(re.compile(r'exercise=200'))
        pw.expect(selected).to_have_count(1)
        pw.expect(nav.get_by_role('link', name='Exercises', exact=True)).to_have_attribute('aria-current', 'page')
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
        pw.expect(selected).to_have_count(1)
        pw.expect(nav.get_by_role('link', name='Materials', exact=True)).to_have_attribute('aria-current', 'page')
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
            sidebar_unpin('Folder one').tap()
            pw.expect(confirmation).to_be_visible()
            pw.expect(confirmation.get_by_role('button', name=tr('Abbrechen'), exact=True)).to_be_focused()
            if width < 640:
                assert confirmation.get_by_role('button', name=tr('Abbrechen'), exact=True).bounding_box()['y'] < confirmation.get_by_role('button', name=tr('sidebar.remove_confirm'), exact=True).bounding_box()['y']
            assert confirmation.evaluate('e => { const r = e.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight; }')
            page.screenshot(path=str(artifacts / f'{language}-{scheme}-confirm-{width}.png'), animations='disabled')
            confirmation.get_by_role('button', name=tr('Abbrechen'), exact=True).tap()
            pw.expect(sidebar_unpin('Folder one')).to_be_focused()
            pw.expect(page.locator('.mobile-navigation[open]')).to_be_visible()
            if width == 320:
                sidebar_unpin('Folder one').tap()
                confirmation.get_by_role('button', name=tr('sidebar.remove_confirm'), exact=True).tap()
                pw.expect(nav.get_by_role('link', name='Folder one', exact=True)).to_have_count(0)
                nav.get_by_role('button', name=tr('Schliessen'), exact=True).tap()
                pin('Folder one').tap()
                pw.expect(confirmation).to_have_count(0)
                page.get_by_role('button', name=tr('Sidebar umschalten'), exact=True).tap()
            nav.get_by_role('link', name='Folder one', exact=True).tap()
            pw.expect(page.locator('.mobile-navigation[open]')).to_have_count(0)
            assert_no_overflow(page)
        # A new account must never inherit another account's pins.
        page.get_by_role('button', name=tr('Sidebar umschalten'), exact=True).click()
        sidebar_unpin('Folder one').tap()
        pw.expect(confirmation).to_be_visible()
        page.evaluate("localStorage.setItem('betterilias_session_id','bob'); window.dispatchEvent(new Event('betterilias-session-changed'))")
        confirmation.get_by_role('button', name=tr('sidebar.remove_confirm'), exact=True).click()
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
