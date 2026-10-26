"""Exercise the production sorting controls in both supported languages."""
import json
import os
import re
from urllib.parse import urlparse, parse_qs

import pytest
from tests.test_localisation_browser import local_site

pytestmark = pytest.mark.skipif(os.environ.get('BETTERILIAS_BROWSER_TESTS') != '1', reason='Requires a frontend build and Chromium')


@pytest.mark.parametrize(('language', 'label', 'settings'), [
    ('en', 'ILIAS default order', 'Open filter, sorting & course view settings'),
    ('de', 'ILIAS-Standardsortierung', 'Filter-, Sortier- & Kursansicht-Einstellungen öffnen'),
])
def test_original_team_sort_is_lazy_and_reversible(local_site, language, label, settings):
    playwright = pytest.importorskip('playwright.sync_api')
    enriched_requests = []
    errors = []
    submissions = [
        dict(member_id='1', student_name='Alpha, Anna', team_id='101', team_members=['Alpha, Anna', 'Zulu, Zoe'],
             first_added_surname='Zulu', submission_status='submitted', files=[]),
        dict(member_id='2', student_name='Bravo, Ben', team_id='102', team_members=['Bravo, Ben', 'Example, Eve'],
             first_added_surname='Example', submission_status='submitted', files=[]),
        dict(member_id='3', student_name='Unknown team', team_id='103', team_members=[],
             first_added_surname=None, submission_status='submitted', files=[]),
    ]

    def respond(route):
        url = urlparse(route.request.url)
        if url.path == '/api/auth/status':
            data = dict(authenticated=True, cookies_present=True)
        elif url.path == '/api/dashboard/semesters':
            data = dict(active_semester='HS2026', courses=[], available_semesters=[], grouped_by_category={})
        elif url.path == '/api/courses/42/materials':
            data = dict(container_ref_id='42', title='Course', is_enrolled=True, items=[], blocks=[], sections=[], sessions=[], breadcrumbs=[], logs=[], rich_text_blocks=[])
        elif url.path == '/api/exercises/200/overview':
            data = dict(exercise_ref_id='200', title='Exercises', has_ta_access=True, assignments=[], breadcrumbs=[])
        elif url.path == '/api/exercises/200/submissions':
            enriched = parse_qs(url.query).get('include_team_order') == ['true']
            if enriched:
                enriched_requests.append(url.query)
            rows = [dict(s) for s in submissions]
            if not enriched:
                for s in rows:
                    s.pop('first_added_surname')
            data = dict(exercise=dict(ref_id='200', title='Exercises', total_participants=3, submitted_count=3, graded_count=0),
                        active_assignment_id='55', available_assignments=[dict(ass_id='55', title='One', url='#')], submissions=rows)
        else:
            data = {}
        route.fulfill(status=200, content_type='application/json', body=json.dumps(data))

    with playwright.sync_playwright() as p:
        browser = p.chromium.launch(headless=True, channel=os.environ.get('BETTERILIAS_BROWSER_CHANNEL'))
        page = browser.new_page(locale='en-GB', color_scheme='dark' if language == 'de' else 'light')
        page.add_init_script(f"localStorage.setItem('betterilias_language', '{language}')")
        page.set_default_timeout(10000)
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.route('**/api/**', respond)
        page.goto(local_site + '/?course=42&exercise=200&tab=submissions')
        playwright.expect(page.get_by_text('Alpha, Anna', exact=True)).to_be_visible()
        assert enriched_requests == []
        page.get_by_title(settings, exact=True).click()
        page.get_by_role('button', name=label, exact=True).click()
        page.keyboard.press('Escape')

        def names():
            return page.locator('span:not(:has(span))').filter(has_text=re.compile(r'^(Alpha, Anna|Bravo, Ben|Unknown team)$'))

        playwright.expect(names()).to_have_text(['Bravo, Ben', 'Alpha, Anna', 'Unknown team'])
        assert len(enriched_requests) == 1
        page.get_by_title(settings, exact=True).click()
        page.get_by_role('button', name='Descending (Z–A, newest first)' if language == 'en' else 'Absteigend (Z-A, neueste)', exact=True).click()
        page.keyboard.press('Escape')
        playwright.expect(names()).to_have_text(['Alpha, Anna', 'Bravo, Ben', 'Unknown team'])
        assert len(enriched_requests) == 1
        assert errors == []
        browser.close()
