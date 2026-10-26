import json
import os
from urllib.parse import urlparse
import pytest
from fastapi.testclient import TestClient
from backend.main import app
from backend.api.deps import get_ilias_client
from backend.scrapers.exercise_editor import parse_ta_assignments_list
from tests.test_localisation_browser import local_site
from tests.test_ta_assignment_delete import DeletionScenario

pytestmark = pytest.mark.skipif(os.environ.get('BETTERILIAS_BROWSER_TESTS') != '1', reason='Requires a frontend build and Chromium')


@pytest.mark.parametrize('outcome', ['timeout_deleted', 'timeout_present'])
def test_delete_timeout_is_verified_or_shows_visible_uncertainty(local_site, outcome):
    playwright = pytest.importorskip('playwright.sync_api')
    scenario = DeletionScenario(outcome)
    title = parse_ta_assignments_list(scenario.listing(), scenario.ref).assignments[0].title
    app.dependency_overrides[get_ilias_client] = lambda: scenario.client
    try:
        with TestClient(app) as backend, playwright.sync_playwright() as p:
            browser = p.chromium.launch(headless=True, channel=os.environ.get('BETTERILIAS_BROWSER_CHANNEL'))
            page = browser.new_page(locale='en-GB')
            page.set_default_timeout(10000)

            def respond(route):
                path = urlparse(route.request.url).path
                if '/ta/' in path:
                    response = backend.request(route.request.method, path, headers={'Accept-Language': 'en'})
                    route.fulfill(status=response.status_code, content_type='application/json', body=response.content)
                    return
                if path.endswith('/status'): data = dict(authenticated=True, cookies_present=True)
                elif path.endswith('/semesters'): data = dict(active_semester='HS2026', courses=[], available_semesters=[], grouped_by_category={})
                elif path.endswith('/materials'): data = dict(container_ref_id='42', title='Course', is_enrolled=True, items=[], blocks=[], sections=[], sessions=[], breadcrumbs=[], logs=[], rich_text_blocks=[])
                elif path.endswith('/overview'): data = dict(exercise_ref_id=scenario.ref, title='Exercises', has_ta_access=True, assignments=[], breadcrumbs=[])
                else: data = {}
                route.fulfill(status=200, content_type='application/json', body=json.dumps(data))

            page.route('**/api/**', respond)
            page.goto(local_site + f'/?course=42&exercise={scenario.ref}')
            page.get_by_role('button', name='Manage assignments', exact=True).click()
            playwright.expect(page.locator('tbody tr')).to_have_count(12)
            page.get_by_role('button', name=f'Delete assignment {title}', exact=True).click()
            page.get_by_role('button', name='Permanently delete assignment', exact=True).click()
            playwright.expect(page.get_by_role('button', name='Permanently delete assignment', exact=True)).to_have_count(0)
            if outcome == 'timeout_deleted':
                playwright.expect(page.get_by_role('status', name='Assignment confirmation', exact=True)).to_have_text(f'Assignment “{title}” deleted successfully.')
                playwright.expect(page.get_by_role('status', name='Assignment confirmation', exact=True)).to_be_visible()
                playwright.expect(page.locator('tbody tr')).to_have_count(11)
                playwright.expect(page.get_by_role('button', name=f'Delete assignment {title}', exact=True)).to_have_count(0)
            else:
                playwright.expect(page.get_by_role('status', name='Assignment confirmation', exact=True)).to_have_count(0)
                playwright.expect(page.get_by_text('ILIAS did not respond in time', exact=False)).to_be_visible()
                playwright.expect(page.locator('tbody tr')).to_have_count(12)
            assert len(scenario.posts) == 2
            browser.close()
    finally:
        app.dependency_overrides.pop(get_ilias_client, None)
