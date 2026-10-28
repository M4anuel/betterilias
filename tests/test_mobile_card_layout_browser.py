"""Exercise readable names, stable editor controls and real mobile grade saving."""
import json
import os
from urllib.parse import urlparse

import pytest
from tests.test_localisation_browser import local_site, ROOT
from tests.test_mobile_refinement_browser import mock_api, assert_no_overflow

pytestmark = pytest.mark.skipif(os.environ.get('BETTERILIAS_BROWSER_TESTS') != '1', reason='Opt-in browser tests')


@pytest.mark.parametrize('width', [320, 390, 430])
@pytest.mark.parametrize('language,scheme', [('de', 'dark'), ('en', 'light')])
def test_mobile_editor_semester_titles_and_grading_cards(local_site, width, language, scheme):
    pw = pytest.importorskip('playwright.sync_api')
    tr = json.loads((ROOT / 'locales' / f'{language}.json').read_text(encoding='utf8')).__getitem__
    saved = []
    courses = [dict(ref_id='42', title='2414-HS2026-0: Personal und Organisation', url='', item_type='crs', subject='Informatik'),
               dict(ref_id='43', title='2415-HS2026-0: Finanzielles Rechnungswesen I - Grundlagen', url='', item_type='crs', subject='Informatik')]

    def respond(route):
        path = urlparse(route.request.url).path
        if path.endswith('/semesters'):
            data = dict(active_semester='HS2026', available_semesters=[], courses=courses, grouped_by_category={'Informatik': courses})
        elif path.endswith('/submissions'):
            data = dict(exercise=dict(ref_id='200', title='Exercises', total_participants=1, submitted_count=1, graded_count=0),
                        active_assignment_id='20', available_assignments=[dict(ass_id='20', title='Assignment one', url='#')], submissions=[
                            dict(member_id='1', student_name='Erler, Elisabeth Alexandra', team_id='40214',
                                 team_members=['Erler, Elisabeth Alexandra', 'Wehrli, Julian Yanis'],
                                 passed_status='not_graded', submission_status='submitted', files=[], download_url='https://example.org/submission.zip')])
        elif path.endswith('/grade'):
            saved.append(route.request.post_data_json)
            data = dict(success=True)
        else:
            return mock_api(route)
        route.fulfill(status=200, content_type='application/json', body=json.dumps(data))

    with pw.sync_playwright() as p:
        browser = p.chromium.launch(headless=True, channel=os.environ.get('BETTERILIAS_BROWSER_CHANNEL'))
        page = browser.new_page(viewport=dict(width=width, height=800), color_scheme=scheme, is_mobile=True, has_touch=True)
        page.set_default_timeout(10000)
        page.add_init_script(f"""localStorage.setItem('betterilias_language', '{language}');
            localStorage.setItem('ilias_course_nicknames', JSON.stringify({{'43':'Finanzielles Rechnungswesen I - Grundlagen'}}));""")
        page.route('**/api/**', respond)
        page.goto(local_site + '/?semester=HS2026')
        page.get_by_role('button', name=tr('Kompakte Listenansicht'), exact=True).click()
        row = page.locator('.semester-course-row').first
        pw.expect(row).to_contain_text('Personal und Organisation')
        pw.expect(row.get_by_text('42', exact=True)).to_be_hidden()
        pw.expect(row.get_by_text(tr('Öffnen'), exact=True)).to_be_hidden()
        assert '2414' not in row.inner_text()
        assert row.locator('h4').evaluate('e => e.parentElement.clientWidth') >= width - 140
        assert_no_overflow(page)

        page.get_by_role('button', name=tr('Sidebar umschalten'), exact=True).click()
        page.get_by_role('button', name=tr('Vorlesungen anpassen'), exact=True).click()
        cards = page.locator('.sidebar-course-card')
        pw.expect(cards).to_have_count(2)
        arrows = []
        for card in cards.all():
            title = card.locator('.sidebar-course-title')
            field = card.locator('input')
            assert title.evaluate('e => parseFloat(getComputedStyle(e).fontSize)') >= 16
            assert title.bounding_box()['y'] < field.bounding_box()['y']
            control = card.get_by_role('button', name=tr('Nach oben verschieben'), exact=True)
            assert control.bounding_box()['y'] >= field.bounding_box()['y'] + field.bounding_box()['height']
            arrows.append(control.bounding_box()['x'])
        assert abs(arrows[0] - arrows[1]) < 1
        page.screenshot(path=f'.pytest_cache/editor-cards-{width}-{language}.png')
        page.locator('.app-overlay').get_by_role('button', name=tr('Abbrechen'), exact=True).click()

        page.goto(local_site + '/?course=42&exercise=200&tab=submissions')
        views = page.get_by_role('combobox', name=tr('mobile.exercise_view'))
        pw.expect(views.locator('option:checked')).to_have_text(tr('mobile.submissions'))
        assert page.locator('.exercise-view-control > span').evaluate('e => e.scrollWidth <= e.clientWidth + 1')
        assert page.get_by_role('heading', name='Exercises', exact=True).bounding_box()['height'] <= 24
        card = page.locator('.submission-card')
        members = card.locator('.submission-member')
        pw.expect(members).to_have_count(2)
        first, second = [member.bounding_box() for member in members.all()]
        assert second['y'] >= first['y'] + first['height']
        for member in members.all():
            assert member.locator('span').evaluate('e => e.scrollWidth <= e.clientWidth + 1')
        choices = card.locator('.submission-status-options button')
        assert max(button.bounding_box()['y'] for button in choices.all()) - min(button.bounding_box()['y'] for button in choices.all()) < 1
        assert card.locator('.submission-status-options').bounding_box()['height'] <= 52
        info = card.locator('.submission-details')
        assert info.evaluate("""e => { const a=e.getBoundingClientRect(), b=e.querySelector('svg').getBoundingClientRect();
            return Math.abs((a.left+a.right-b.left-b.right)/2)<1 && Math.abs((a.top+a.bottom-b.top-b.bottom)/2)<1; }""")
        pw.expect(card.locator('.submission-download .phone-only')).to_be_visible()
        card.get_by_role('button', name=tr('Bestanden'), exact=True).click()
        comment = card.get_by_placeholder(tr('Korrektur-Kommentar für Studierende eingeben...'), exact=True)
        comment.fill('Clear mobile feedback')
        assert comment.bounding_box()['height'] > card.locator('.submission-status-options').bounding_box()['height']
        assert_no_overflow(page)
        page.screenshot(path=f'.pytest_cache/submission-card-{width}-{language}.png')
        with page.expect_response(lambda response: urlparse(response.url).path.endswith('/grade')):
            card.get_by_role('button', name=tr('Speichern'), exact=True).click()
        pw.expect(card.get_by_role('button', name=tr('Bestanden'), exact=True)).to_have_attribute('aria-pressed', 'true')
        assert len(saved) == 1 and saved[0]['status'] == 'passed' and saved[0]['feedback'] == 'Clear mobile feedback'
        browser.close()
