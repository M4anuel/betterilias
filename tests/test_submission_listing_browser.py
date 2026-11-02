"""Complete listings replace legacy filtered caches, with usable error/retry UI."""
import json
import os
from urllib.parse import urlparse

import pytest
from tests.test_localisation_browser import local_site, ROOT
from tests.test_mobile_refinement_browser import mock_api, assert_no_overflow

pytestmark = pytest.mark.skipif(
    os.environ.get('BETTERILIAS_BROWSER_TESTS') != '1', reason='Opt-in browser tests')


@pytest.mark.parametrize('width,height', [(320, 740), (390, 740), (430, 740),
                                         (768, 900), (1280, 900), (667, 375)])
@pytest.mark.parametrize('language,scheme', [('de', 'dark'), ('en', 'light')])
def test_complete_submissions_retry_and_local_filters(local_site, tmp_path, width, height, language, scheme):
    pw = pytest.importorskip('playwright.sync_api')
    tr = json.loads((ROOT / 'locales' / f'{language}.json').read_text(encoding='utf8')).__getitem__
    failure = tr('Could not load all submissions from ILIAS. Please refresh and try again.')
    fail = True
    requests = []
    submissions = [dict(member_id=str(i), student_name=f'Student {i:02d}',
                        submission_status='submitted', passed_status='passed' if i % 2 == 0 else 'not_graded',
                        files=[]) for i in range(1, 51)]
    data = dict(exercise=dict(ref_id='200', title='Exercises', total_participants=50,
                             submitted_count=50, graded_count=25),
                active_assignment_id='20', available_assignments=[dict(ass_id='20', title='One', url='#')],
                submissions=submissions, listing_complete=True)
    # A fresh Saver cache produced by the old backend is still incomplete.
    legacy = dict(data, submissions=[submissions[1]])
    legacy.pop('listing_complete')

    def respond(route):
        path = urlparse(route.request.url).path
        if path.endswith('/submissions'):
            requests.append(route.request.method)
            route.fulfill(status=502 if fail else 200, content_type='application/json',
                          body=json.dumps(dict(detail=failure, code='SUBMISSIONS_INCOMPLETE') if fail else data))
        else:
            mock_api(route)

    with pw.sync_playwright() as p:
        browser = p.chromium.launch(headless=True, channel=os.environ.get('BETTERILIAS_BROWSER_CHANNEL'))
        page = browser.new_page(viewport=dict(width=width, height=height), color_scheme=scheme,
                                is_mobile=width < 768, has_touch=width < 768)
        page.add_init_script(f"""
            localStorage.setItem('betterilias_language', '{language}');
            localStorage.setItem('betterilias_saver_enabled', 'true');
            for (const suffix of ['default', '20']) {{
                const key = 'ilias_exercise_submissions_200_' + suffix;
                localStorage.setItem(key, {json.dumps(json.dumps(legacy))});
                localStorage.setItem('ilias_ts_' + key, String(Date.now()));
            }}
        """)
        page.route('**/api/**', respond)
        page.goto(local_site + '/?course=42&exercise=200&tab=submissions')
        alert = page.get_by_role('alert').filter(has_text=failure)
        pw.expect(alert).to_be_visible()
        pw.expect(page.locator('.submission-card')).to_have_count(0)
        assert requests
        assert_no_overflow(page)
        alert.scroll_into_view_if_needed()
        pw.expect(alert).to_be_in_viewport()
        if width < 640:
            assert alert.locator('p').bounding_box()['width'] >= alert.bounding_box()['width'] - 36
        page.screenshot(path=str(tmp_path / f'submission-list-error-{width}-{language}.png'))
        fail = False
        retry = alert.get_by_role('button', name=tr('Erneut versuchen'), exact=True)
        retry.focus()
        page.keyboard.press('Enter')
        pw.expect(page.locator('.submission-card')).to_have_count(50)
        pw.expect(alert).to_have_count(0)
        pw.expect(page.locator('.submission-card').filter(has_text='Student 50')).to_have_count(1)
        assert_no_overflow(page)
        quick_filter = page.get_by_role('button', name=tr('Zu bewerten'), exact=False)
        quick_filter.click()
        pw.expect(page.locator('.submission-card')).to_have_count(25)
        quick_filter.click()
        pw.expect(page.locator('.submission-card')).to_have_count(50)
        assert set(requests) == {'GET'}
        page.screenshot(path=str(tmp_path / f'submission-list-complete-{width}-{language}.png'))
        browser.close()
