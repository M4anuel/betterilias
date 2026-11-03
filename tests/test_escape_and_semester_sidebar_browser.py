"""Real production UI interactions; mocked ILIAS responses, Chromium emulation."""
import json
import os
import re
from urllib.parse import urlparse

import pytest
from tests.test_localisation_browser import local_site, ROOT
from tests.test_mobile_refinement_browser import mock_api

pytestmark = pytest.mark.skipif(os.environ.get('BETTERILIAS_BROWSER_TESTS') != '1', reason='Opt-in browser checks')


def setup_page(browser, language, width, height=800):
    page = browser.new_page(viewport=dict(width=width, height=height), color_scheme='dark' if language == 'de' else 'light')
    page.set_default_timeout(10000)
    page.add_init_script(f"localStorage.setItem('betterilias_language', '{language}');")
    page.route('**/api/**', mock_api)
    return page


def open_editor(page, tr, width):
    if width < 1024:
        page.get_by_role('button', name=tr('Sidebar umschalten'), exact=True).click()
    page.get_by_role('button', name=tr('Vorlesungen anpassen'), exact=True).click()
    return page.locator('.app-overlay')


def assert_sidebar_dividers(page, pw, tr, width, present, absent):
    if width < 1024:
        page.get_by_role('button', name=tr('Sidebar umschalten'), exact=True).click()
    sidebar = page.locator('aside:visible')
    pw.expect(sidebar.get_by_text(present, exact=True)).to_be_visible()
    pw.expect(sidebar.get_by_text(absent, exact=True)).to_have_count(0)
    if width < 1024:
        page.keyboard.press('Escape')


@pytest.mark.parametrize('language', ['de', 'en'])
@pytest.mark.parametrize('width,height', [(320, 740), (390, 844), (430, 900), (768, 1024), (1280, 900), (844, 390)])
def test_dividers_edit_reset_and_migrate_per_semester(local_site, language, width, height):
    pw = pytest.importorskip('playwright.sync_api')
    tr = json.loads((ROOT / 'locales' / f'{language}.json').read_text(encoding='utf8')).__getitem__
    with pw.sync_playwright() as p:
        browser = p.chromium.launch(headless=True, channel=os.environ.get('BETTERILIAS_BROWSER_CHANNEL'))
        page = setup_page(browser, language, width, height)
        page.add_init_script("""if (!localStorage.getItem('seeded')) {
            localStorage.setItem('seeded','1');
            localStorage.setItem('ilias_sidebar_order',JSON.stringify([
              {id:'legacy',type:'section',title:'Autumn only'}, {id:'42',type:'course'}]));
        }""")
        page.goto(local_site + '/?semester=HS2026&entry=standalone')
        editor = open_editor(page, tr, width)
        pw.expect(editor.get_by_placeholder(tr('Abschnittsname'), exact=True)).to_have_value('Autumn only')
        editor.get_by_role('button', name=tr('Änderungen speichern'), exact=True).click()
        assert_sidebar_dividers(page, pw, tr, width, 'Autumn only', 'Spring only')
        assert page.evaluate("localStorage.getItem('ilias_sidebar_order')") is None
        page.get_by_role('combobox', name=tr('semester.choose')).select_option('FS2023')
        editor = open_editor(page, tr, width)
        pw.expect(editor.get_by_placeholder(tr('Abschnittsname'), exact=True)).to_have_count(0)
        editor.get_by_role('button', name=tr('Abschnitt hinzufügen'), exact=True).click()
        editor.get_by_placeholder(tr('Abschnittsname'), exact=True).fill('Spring only')
        editor.get_by_role('button', name=tr('Änderungen speichern'), exact=True).click()
        assert_sidebar_dividers(page, pw, tr, width, 'Spring only', 'Autumn only')
        page.reload()
        editor = open_editor(page, tr, width)
        pw.expect(editor.get_by_placeholder(tr('Abschnittsname'), exact=True)).to_have_value('Spring only')
        editor.get_by_role('button', name=tr('Auf Fachbereiche zurücksetzen'), exact=True).click()
        editor.get_by_role('button', name=tr('Änderungen speichern'), exact=True).click()
        page.get_by_role('combobox', name=tr('semester.choose')).select_option('HS2026')
        editor = open_editor(page, tr, width)
        pw.expect(editor.get_by_placeholder(tr('Abschnittsname'), exact=True)).to_have_value('Autumn only')
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        artifacts = ROOT / 'scratch' / 'semester-sidebar-checks'
        artifacts.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(artifacts / f'{language}-{width}-{height}.png'))
        browser.close()


@pytest.mark.parametrize('language', ['de', 'en'])
@pytest.mark.parametrize('width', [320, 768, 1280])
def test_escape_back_double_escape_and_overlay_priority(local_site, language, width):
    pw = pytest.importorskip('playwright.sync_api')
    tr = json.loads((ROOT / 'locales' / f'{language}.json').read_text(encoding='utf8')).__getitem__
    with pw.sync_playwright() as p:
        browser = p.chromium.launch(headless=True, channel=os.environ.get('BETTERILIAS_BROWSER_CHANNEL'))
        page = setup_page(browser, language, width)
        page.goto(local_site + '/?course=42')
        page.get_by_text('Folder one', exact=True).first.click()
        pw.expect(page).to_have_url(re.compile(r'folder=51'))
        page.get_by_text('Nested folder', exact=True).first.click()
        pw.expect(page).to_have_url(re.compile(r'folder=53'))
        deep_url = page.url
        page.get_by_role('button', name=tr('Design & Einstellungen'), exact=True).click()
        page.keyboard.press('Escape')
        pw.expect(page.locator('dialog[open]')).to_have_count(0)
        assert page.url == deep_url
        # The Escape used to close settings must not count as the first navigation press.
        page.keyboard.press('Escape')
        pw.expect(page).to_have_url(re.compile(r'folder=51'))
        page.keyboard.press('Escape')
        pw.expect(page).to_have_url(re.compile(r'\?semester='))
        # A fresh overview entry cannot Escape back to another document/site.
        page.goto(local_site + '/?semester=HS2026&entry=standalone')
        pw.expect(page.get_by_role('heading', name=tr('Vorlesungsübersicht'), exact=True)).to_be_visible()
        overview_url = page.url
        page.keyboard.press('Escape')
        page.wait_for_timeout(100)
        assert page.url == overview_url
        page.goto(local_site + '/?course=42')
        page.get_by_text('Folder one', exact=True).first.click()
        pw.expect(page).to_have_url(re.compile(r'folder=51'))
        page.get_by_text('Nested folder', exact=True).first.click()
        pw.expect(page).to_have_url(re.compile(r'folder=53'))
        page.keyboard.press('Escape')
        pw.expect(page).to_have_url(re.compile(r'folder=51'))
        page.wait_for_timeout(800)
        page.keyboard.press('Escape')
        pw.expect(page).to_have_url(re.compile(r'\?course=42$'))
        page.get_by_text('Folder one', exact=True).first.click()
        pw.expect(page).to_have_url(re.compile(r'folder=51'))
        folder_url = page.url
        if width < 768:
            page.get_by_label(tr('mobile.actions'), exact=True).click()
            page.keyboard.press('Escape')
            pw.expect(page.locator('.phone-page-header details[open]')).to_have_count(0)
            assert page.url == folder_url
        page.evaluate("""() => {
          const input = document.createElement('input'); input.id='shortcut-input';
          document.body.append(input); input.focus();
        }""")
        page.keyboard.press('Escape')
        assert page.url == folder_url
        page.evaluate("document.querySelector('#shortcut-input').remove()")
        page.evaluate("() => { window.addEventListener('keydown', e => e.preventDefault(), { once:true }); }")
        page.keyboard.press('Escape')
        page.wait_for_timeout(100)
        assert page.url == folder_url
        page.evaluate("""() => {
          const control = document.createElement('button'); control.id='custom-escape-owner';
          control.addEventListener('keydown', event => event.stopPropagation());
          document.body.append(control); control.focus();
        }""")
        page.keyboard.press('Escape')
        page.wait_for_timeout(100)
        assert page.url == folder_url
        page.evaluate("document.querySelector('#custom-escape-owner').remove()")
        page.evaluate("Object.defineProperty(document,'fullscreenElement',{configurable:true,get:()=>document.body})")
        page.keyboard.press('Escape')
        assert page.url == folder_url
        page.evaluate('delete document.fullscreenElement')
        page.keyboard.press('Escape')
        pw.expect(page).to_have_url(re.compile(r'\?course=42$'))
        browser.close()


def test_escape_pending_mutation_confirmation_is_not_duplicated(local_site):
    pw = pytest.importorskip('playwright.sync_api')
    pending = []
    def respond(route):
        if urlparse(route.request.url).path.endswith('/auth/logout'):
            pending.append(route)
        else:
            mock_api(route)
    with pw.sync_playwright() as p:
        browser = p.chromium.launch(headless=True, channel=os.environ.get('BETTERILIAS_BROWSER_CHANNEL'))
        page = setup_page(browser, 'en', 1280)
        page.unroute('**/api/**')
        page.route('**/api/**', respond)
        page.goto(local_site + '/?course=42')
        page.get_by_role('button', name='Appearance & settings', exact=True).click()
        page.get_by_role('button', name='Sign out', exact=True).click()
        page.wait_for_timeout(100)
        assert pending
        page.keyboard.press('Escape')
        confirmation = page.get_by_role('dialog', name='Cancel operation?')
        pw.expect(confirmation).to_be_visible()
        page.keyboard.press('Escape')
        pw.expect(confirmation).to_have_count(0)
        assert 'course=42' in page.url
        page.keyboard.press('Escape')
        pw.expect(confirmation).to_be_visible()
        confirmation.get_by_role('button', name='Leave anyway', exact=True).click()
        pw.expect(page).to_have_url(re.compile(r'\?semester='))
        pw.expect(confirmation).to_have_count(0)
        pending[0].fulfill(content_type='application/json', body='{"success":true}')
        browser.close()
