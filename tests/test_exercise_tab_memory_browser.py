"""Lecture/account-scoped tab memory in Chromium with mocked ILIAS responses."""
import json
import os
import re
from urllib.parse import urlparse

import pytest

from tests.test_localisation_browser import ROOT, local_site
from tests.test_mobile_refinement_browser import mock_api

pytestmark = pytest.mark.skipif(os.environ.get('BETTERILIAS_BROWSER_TESTS') != '1', reason='Opt-in Chromium checks')


@pytest.mark.parametrize('language,scheme', [('de', 'dark'), ('de', 'light'), ('en', 'dark'), ('en', 'light')])
@pytest.mark.parametrize('width,height', [(320, 740), (390, 844), (430, 900), (768, 1024), (1280, 800), (844, 390)])
def test_tab_memory_is_per_lecture_account_and_respects_explicit_history(local_site, language, scheme, width, height):
    pw = pytest.importorskip('playwright.sync_api')
    tr = json.loads((ROOT/'locales'/f'{language}.json').read_text(encoding='utf8')).__getitem__
    state = dict(ta=True)
    errors = []
    def respond(route):
        path = urlparse(route.request.url).path
        if path.endswith('/overview'):
            ref = path.split('/')[3]
            body = dict(exercise_ref_id=ref, title='Exercises', has_ta_access=state['ta'], breadcrumbs=[], assignments=[])
        elif path.endswith('/info'):
            body = dict(sections=[dict(title='Course information', properties={'Language': 'English'})])
        else:
            mock_api(route)
            return
        route.fulfill(content_type='application/json', body=json.dumps(body))
    with pw.sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport=dict(width=width, height=height), color_scheme=scheme)
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.add_init_script(f"""
          localStorage.setItem('betterilias_language', '{language}');
          localStorage.setItem('betterilias_theme_mode', '{scheme}');
          if (!localStorage.getItem('betterilias_session_id')) localStorage.setItem('betterilias_session_id', 'tab-account-a');
        """)
        page.route('**/api/**', respond)
        page.route('https://cdn.jsdelivr.net/**', lambda route: route.abort())
        selector = page.locator('.exercise-view-select')
        def visit(course='42', exercise='200', tab=None):
            page.goto(f'{local_site}/?course={course}&exercise={exercise}' + (f'&tab={tab}' if tab else ''))
            pw.expect(selector).to_have_count(1)
        def choose(tab):
            if selector.is_visible():
                # Wait until the permission-dependent option is present.
                pw.expect(selector.locator(f'option[value="{tab}"]')).to_have_count(1)
                selector.select_option(tab)
            else:
                label = {'assignments': tr('Übungsblätter'), 'info': tr('Informationen'), 'submissions': tr('Abgaben & Noten')}[tab]
                page.get_by_role('button', name=re.compile('^'+re.escape(label))).click()
            pw.expect(selector).to_have_value(tab)
        visit()
        pw.expect(selector).to_have_value('assignments')
        choose('info')
        visit('42', '201')
        pw.expect(selector).to_have_value('info')
        pw.expect(page.get_by_text('Course information', exact=True)).to_be_visible()
        visit('43', '202')
        pw.expect(selector).to_have_value('assignments')
        choose('submissions')
        visit()
        pw.expect(selector).to_have_value('info')
        # Explicit links override memory; history preserves explicit Assignments.
        visit(tab='assignments')
        pw.expect(selector).to_have_value('assignments')
        choose('info')
        page.go_back()
        pw.expect(selector).to_have_value('assignments')
        page.go_forward()
        pw.expect(selector).to_have_value('info')
        visit('43', '202')
        pw.expect(selector).to_have_value('submissions')
        page.reload()
        pw.expect(selector).to_have_value('submissions')
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        artifacts = ROOT/'scratch'/'exercise-tab-memory'
        artifacts.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(artifacts/f'{language}-{scheme}-{width}-restored.png'), animations='disabled')
        # A different signed-in account must not inherit the lecture's preference.
        page.evaluate("localStorage.setItem('betterilias_session_id', 'tab-account-b')")
        visit('43', '202')
        pw.expect(selector).to_have_value('assignments')
        page.evaluate("localStorage.setItem('betterilias_session_id', 'tab-account-a')")
        visit('43', '202')
        pw.expect(selector).to_have_value('submissions')
        # Lost TA permission cannot restore an unavailable, blank grading view.
        state['ta'] = False
        page.evaluate("Object.keys(localStorage).filter(key => key.startsWith('ilias_exercise_')).forEach(key => localStorage.removeItem(key))")
        visit('43', '202')
        pw.expect(selector).to_have_value('assignments')
        assert not errors
        browser.close()
