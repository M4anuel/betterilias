"""One visible ILIAS loading animation during cold loads and cached revalidation."""
import json
import os
import time
from urllib.parse import urlparse

import pytest
from tests.test_localisation_browser import local_site, ROOT
from tests.test_mobile_refinement_browser import mock_api

pytestmark = pytest.mark.skipif(os.environ.get('BETTERILIAS_BROWSER_TESTS') != '1', reason='Opt-in Chromium checks')

VIEWS = {
    'semester': ('?semester=HS2026', '/dashboard/semesters'),
    'course': ('?course=42', '/courses/42/materials'),
    'assignments': ('?course=42&exercise=200', '/exercises/200/overview'),
    'grading': ('?course=42&exercise=200&tab=submissions', '/exercises/200/submissions'),
    'management': ('?course=42&exercise=200&tab=manage', '/exercises/200/ta/assignments'),
    'editor': ('?course=42&exercise=200&tab=manage-edit', '/exercises/200/ta/assignments'),
    'information': ('?course=42&exercise=200&tab=info', '/exercises/200/info'),
    'repository': ('?repository=1', '/repository/1'),
    'memberships': ('?view=my-courses', '/dashboard/memberships'),
    'calendar': ('?semester=HS2026&view=calendar', '/calendar'),
}


@pytest.mark.parametrize('view', VIEWS)
@pytest.mark.parametrize('width,language,scheme', [(320, 'de', 'dark'), (1280, 'en', 'light')])
def test_page_has_one_loader_for_initial_and_cached_sync(local_site, view, width, language, scheme):
    pw = pytest.importorskip('playwright.sync_api')
    query, target = VIEWS[view]
    held = []
    holding = [True]
    requests = []
    def reply(route):
        path = urlparse(route.request.url).path
        if path.startswith('/api/calendar'):
            body = dict(semester='HS2026', semester_start_date='2026-09-14', semester_end_date='2026-12-31',
                        semester_mid_date='2026-11-01', timezone='Europe/Zurich', courses=[], rules=[], events=[])
        elif path.endswith('/memberships'):
            body = dict(courses=[], fetched_at='2026-11-01T10:00:00Z')
        elif path.startswith('/api/repository/'):
            body = dict(container_ref_id='1', title='Repository', items=[], breadcrumbs=[])
        elif path.endswith('/ta/assignments'):
            body = dict(exercise_ref_id='200', assignments=[], available_types={'1': 'Upload'})
        elif path.endswith('/exercises/200/info'):
            body = dict(exercise_ref_id='200', title='Exercises', sections=[])
        elif path.endswith('/semesters') and view in ('calendar', 'memberships', 'repository'):
            body = dict(active_semester='HS2026', available_semesters=[], courses=[], grouped_by_category={})
        else:
            mock_api(route)
            return
        route.fulfill(content_type='application/json', body=json.dumps(body))
    def respond(route):
        is_target = urlparse(route.request.url).path.startswith('/api' + target)
        if is_target:
            requests.append(route.request.url)
        if holding[0] and is_target:
            held.append(route)
        else:
            reply(route)
    with pw.sync_playwright() as p:
        browser = p.chromium.launch(headless=True, channel=os.environ.get('BETTERILIAS_BROWSER_CHANNEL'))
        page = browser.new_page(viewport=dict(width=width, height=390 if width == 844 else 840), color_scheme=scheme)
        page.add_init_script(f"localStorage.setItem('betterilias_language','{language}');")
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.route('**/api/**', respond)
        page.goto(local_site + '/' + query)
        animations = page.locator('main [class*="animate-spin"]:visible, main [class*="animate-pulse"]:visible')
        for cached in (False, True):
            pw.expect(animations).to_have_count(1)
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            artifacts = ROOT / 'scratch' / 'page-sync-checks'
            artifacts.mkdir(parents=True, exist_ok=True)
            page.screenshot(path=str(artifacts / f'{view}-{language}-{width}-{cached}.png'))
            holding[0] = False
            for route in held:
                reply(route)
            held.clear()
            pw.expect(animations).to_have_count(0)
            if view == 'information':
                page.wait_for_timeout(150)
                # StrictMode may mount twice; receiving data must not refetch it.
                assert len(requests) <= (4 if cached else 2)
            if not cached:
                holding[0] = True
                page.reload()
        assert errors == []
        browser.close()


@pytest.mark.parametrize('view', ['semester', 'grading'])
@pytest.mark.parametrize('width', [390, 430, 768, 844])
def test_sync_indicator_at_intermediate_and_landscape_widths(local_site, view, width):
    test_page_has_one_loader_for_initial_and_cached_sync(local_site, view, width, 'de', 'light')


@pytest.mark.parametrize('kind', ['session', 'feedback', 'calendar'])
@pytest.mark.parametrize('width', [320, 1280])
def test_nested_syncs_share_page_indicator_and_clear_on_error(local_site, kind, width):
    pw = pytest.importorskip('playwright.sync_api')
    held = []
    course = dict(ref_id='42', title='Lecture', item_type='crs', semester='HS2026')
    session = dict(ref_id='70', title='Session one', materials=[], materials_count=1, is_past=False)
    def respond(route):
        path = urlparse(route.request.url).path
        if ((kind == 'session' and '/sessions/70/materials' in path)
            or (kind == 'feedback' and path.endswith('/feedback-files'))
            or (kind == 'calendar' and path.endswith('/calendar/sync'))):
            held.append(route)
            return
        if path == '/api/courses/42/materials' and kind == 'session':
            body = dict(container_ref_id='42', title='Lecture', is_enrolled=True, items=[], sections=[], sessions=[], logs=[], breadcrumbs=[],
                        blocks=[dict(id='sessions', block_type='sessions', sessions=[session])])
        elif path.endswith('/submissions') and kind == 'feedback':
            body = dict(exercise=dict(ref_id='200', title='Exercises', submitted_count=2, graded_count=0, total_participants=2),
                active_assignment_id='20', available_assignments=[dict(ass_id='20', title='Assignment one', url='')],
                submissions=[dict(member_id=str(member), student_name=f'Student {member}', files=[], submission_status='submitted',
                    evaluation_by_file_url=f'https://ilias.unibe.ch/ilias.php?member_id={member}') for member in [1, 2]])
        elif path.startswith('/api/calendar'):
            body = dict(semester='HS2026', semester_start_date='2026-09-14', semester_end_date='2026-12-31',
                        semester_mid_date='2026-11-01', courses=[], rules=[], events=[])
        elif path.endswith('/memberships'):
            body = dict(courses=[course])
        else:
            mock_api(route)
            return
        route.fulfill(content_type='application/json', body=json.dumps(body))
    with pw.sync_playwright() as p:
        browser = p.chromium.launch(headless=True, channel=os.environ.get('BETTERILIAS_BROWSER_CHANNEL'))
        page = browser.new_page(viewport=dict(width=width, height=840), locale='en-GB')
        page.add_init_script("localStorage.setItem('ilias_ta_eval_mode_42','file')")
        page.route('**/api/**', respond)
        page.goto(local_site + '/' + ('?view=calendar' if kind == 'calendar' else
            '?course=42&exercise=200&tab=submissions' if kind == 'feedback' else '?course=42'))
        if kind == 'session':
            page.get_by_text('Session one', exact=True).click()
        deadline = time.monotonic() + 5
        while not held and time.monotonic() < deadline:
            page.wait_for_timeout(20)
        assert held
        animations = page.locator('main [class*="animate-spin"]:visible, main [class*="animate-pulse"]:visible')
        pw.expect(animations).to_have_count(1)
        if kind == 'session':
            page.emulate_media(reduced_motion='reduce')
            page.wait_for_function("[...document.querySelectorAll('[data-ilias-sync-indicator] svg')].every(icon => getComputedStyle(icon).animationName === 'none')")
        for route in held:
            route.fulfill(status=503, content_type='application/json', body='{"detail":"Temporarily unavailable"}')
        pw.expect(animations).to_have_count(0)
        browser.close()
