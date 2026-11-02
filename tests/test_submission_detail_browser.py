"""Submission details keep complete action labels at every supported viewport."""
import json
import os
from urllib.parse import urlparse

import pytest
from tests.test_localisation_browser import local_site, ROOT
from tests.test_mobile_refinement_browser import mock_api

pytestmark = pytest.mark.skipif(
    os.environ.get('BETTERILIAS_BROWSER_TESTS') != '1', reason='Opt-in browser tests')


@pytest.mark.parametrize('width,height', [(320, 740), (390, 740), (430, 740),
                                         (768, 900), (1280, 900), (667, 375)])
@pytest.mark.parametrize('language', ['de', 'en'])
@pytest.mark.parametrize('scheme', ['light', 'dark'])
def test_submission_details_action_labels_and_save(local_site, width, height, language, scheme):
    pw = pytest.importorskip('playwright.sync_api')
    tr = json.loads((ROOT / 'locales' / f'{language}.json').read_text(encoding='utf8')).__getitem__
    saved = []

    def respond(route):
        path = urlparse(route.request.url).path
        if path.endswith('/submissions'):
            data = dict(exercise=dict(ref_id='200', title='Exercises', total_participants=1,
                                     submitted_count=1, graded_count=0),
                        active_assignment_id='20',
                        available_assignments=[dict(ass_id='20', title='Assignment one', url='#')],
                        submissions=[dict(member_id='1', student_name='Student, Test',
                                          submission_status='submitted', passed_status='not_graded', files=[],
                                          evaluation_by_file_url='https://example.org/feedback',
                                          feedback_mail_url='https://example.org/mail',
                                          team_log_url='https://example.org/log')])
        elif path.endswith('/grade'):
            saved.append(route.request.post_data_json)
            data = dict(success=True)
        elif path.endswith('/feedback-files'):
            data = dict(files=[])
        else:
            return mock_api(route)
        route.fulfill(status=200, content_type='application/json', body=json.dumps(data))

    with pw.sync_playwright() as p:
        browser = p.chromium.launch(headless=True, channel=os.environ.get('BETTERILIAS_BROWSER_CHANNEL'))
        page = browser.new_page(viewport=dict(width=width, height=height), color_scheme=scheme,
                                is_mobile=width < 768, has_touch=width < 768)
        page.add_init_script(f"localStorage.setItem('betterilias_language', '{language}');")
        page.route('**/api/**', respond)
        page.goto(local_site + '/?course=42&exercise=200&tab=submissions')
        page.locator('.submission-card').get_by_role('button', name=tr('Details'), exact=True).click()
        dialog = page.get_by_role('dialog', name='Student, Test', exact=True)
        footer = dialog.locator('.submission-detail-footer')
        close = footer.get_by_role('button', name=tr('Schliessen'), exact=True)
        pw.expect(close).to_be_in_viewport()
        pw.expect(dialog.locator('.submission-detail-save')).to_have_count(2)

        def check_actions():
            # Check actual text ranges, not just overflow: wrapping can fit inside a button.
            for button in [*dialog.locator('.submission-detail-save').all(), close]:
                assert button.evaluate('''e => {
                    const walker = document.createTreeWalker(e, NodeFilter.SHOW_TEXT);
                    let node;
                    while ((node = walker.nextNode())) {
                        if (!node.textContent.trim()) continue;
                        const range = document.createRange();
                        range.selectNodeContents(node);
                        if (range.getClientRects().length !== 1) return false;
                    }
                    return e.scrollWidth <= e.clientWidth + 1;
                }''')
            assert dialog.evaluate('e => e.scrollWidth <= e.clientWidth + 1')

        check_actions()
        field = dialog.get_by_placeholder(tr('Note oder Punktzahl (z.B. 5.5 oder 18/20)'), exact=True)
        field.fill('5.5')
        with page.expect_response(lambda response: urlparse(response.url).path.endswith('/grade')):
            footer.get_by_role('button', name=tr('Speichern'), exact=True).click()
        pw.expect(footer.get_by_role('button', name=tr('Gespeichert!'), exact=True)).to_be_visible()
        assert len(saved) == 1 and saved[0]['mark'] == '5.5'
        check_actions()
        assert '\u00df' not in dialog.inner_text() and '\u1e9e' not in dialog.inner_text()
        page.screenshot(path=f'.pytest_cache/submission-detail-{width}-{height}-{language}-{scheme}.png')
        close.click()
        pw.expect(dialog).to_have_count(0)
        browser.close()
