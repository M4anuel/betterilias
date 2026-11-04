"""Account/course defaults, mobile drafts and refused note truncation."""
import json
import os
from urllib.parse import urlparse

import pytest
from tests.test_localisation_browser import local_site, ROOT
from tests.test_mobile_refinement_browser import mock_api, assert_no_overflow
from backend.services.ta_allocation import compute_distribution_fingerprint

pytestmark = pytest.mark.skipif(os.environ.get('BETTERILIAS_BROWSER_TESTS') != '1', reason='Opt-in browser tests')


@pytest.mark.parametrize('width,height', [(320, 740), (390, 844), (430, 900), (768, 900), (1280, 900), (667, 375)])
@pytest.mark.parametrize('language,scheme', [('de', 'dark'), ('en', 'light')])
def test_allocation_defaults_drafts_and_note_guard(local_site, width, height, language, scheme):
    pw = pytest.importorskip('playwright.sync_api')
    catalogue = json.loads((ROOT / 'locales' / f'{language}.json').read_text(encoding='utf-8'))
    def tr(key, **values):
        text = catalogue[key]
        for key, value in values.items():
            text = text.replace('{' + key + '}', str(value))
        return text
    notes, posts, oversized = ['  Original human note  ', '', 'Third note'], [], [False]
    def respond(route):
        path = urlparse(route.request.url).path
        if path.endswith('/submissions'):
            current = ['X' * 195, *notes[1:]] if oversized[0] else notes
            data = dict(exercise=dict(ref_id='200', title='Exercises', total_participants=3, submitted_count=3, graded_count=0),
                active_assignment_id='20', available_assignments=[dict(ass_id='20', title='Assignment one', url='#')],
                submissions=[dict(member_id=str(101+i), student_name=f'Student {i+1}', submission_status='submitted',
                                   passed_status='not_graded', notice=note, files=[]) for i,note in enumerate(current)],
                listing_complete=True, fingerprint=compute_distribution_fingerprint(['101','102','103'],current))
            route.fulfill(content_type='application/json', body=json.dumps(data))
        elif path.endswith('/allocation/apply'):
            payload = route.request.post_data_json
            posts.append(payload)
            for item in payload['items']:
                notes[int(item['member_id']) - 101] = item['notice']
            route.fulfill(content_type='application/json', body=json.dumps(dict(success=True, updated_count=3, failed_count=0, message='ok')))
        else:
            mock_api(route)
    artifacts = ROOT / 'scratch' / 'allocation-review'
    artifacts.mkdir(parents=True, exist_ok=True)
    with pw.sync_playwright() as p:
        browser = p.chromium.launch(headless=True, channel=os.environ.get('BETTERILIAS_BROWSER_CHANNEL'))
        page = browser.new_page(viewport={'width':width,'height':height}, color_scheme=scheme,
                                is_mobile=width < 768, has_touch=width < 768)
        page.add_init_script(f"""localStorage.setItem('betterilias_language','{language}');
            if (!localStorage.getItem('betterilias_session_id')) localStorage.setItem('betterilias_session_id','alice');""")
        page.route('**/api/**', respond)
        def open_dialog():
            trigger = page.get_by_role('button', name=tr('Arbeit auf Tutoren verteilen'), exact=True)
            trigger.click()
            dialog = page.get_by_role('dialog', name=tr('Arbeit verteilen'), exact=True)
            pw.expect(dialog).to_be_visible()
            return dialog, trigger
        page.goto(local_site + '/?course=42&exercise=200&tab=submissions')
        dialog, trigger = open_dialog()
        inputs = dialog.get_by_role('textbox')
        inputs.nth(0).fill('Ada')
        inputs.nth(1).fill('Bob')
        dialog.get_by_role('button', name=tr('Nach unten verschieben'), exact=True).first.click()
        pw.expect(inputs.nth(0)).to_have_value('Bob')
        dialog.get_by_role('button', name='+ ' + tr('Tutor hinzufügen'), exact=True).click()
        inputs.nth(2).fill('Carol')
        dialog.get_by_role('button', name=tr('allocation.remove_assistant', name='Carol'), exact=True).click()
        dialog.get_by_role('button', name='+ ' + tr('Tutor hinzufügen'), exact=True).click()
        pw.expect(inputs.nth(2)).to_have_value('TA 4')
        # Real resizing keeps the existing editor and its inputs mounted.
        inputs.nth(1).fill('Ada draft')
        page.set_viewport_size({'width':430,'height':400})
        pw.expect(inputs.nth(1)).to_have_value('Ada draft')
        page.set_viewport_size({'width':width,'height':height})
        assert_no_overflow(page)
        assert dialog.evaluate('e => e.scrollWidth <= e.clientWidth + 1')
        close = dialog.get_by_role('button', name=tr('Schliessen'), exact=True)
        pw.expect(close).to_be_in_viewport()
        page.keyboard.press('Escape')
        pw.expect(dialog).to_have_count(0)
        pw.expect(trigger).to_be_focused()
        assert not posts
        # Same course/account reload restores roster, order and monotonic slot IDs.
        page.reload()
        dialog, _ = open_dialog()
        inputs = dialog.get_by_role('textbox')
        pw.expect(inputs.nth(0)).to_have_value('Bob')
        pw.expect(inputs.nth(1)).to_have_value('Ada draft')
        pw.expect(inputs.nth(2)).to_have_value('TA 4')
        apply = dialog.get_by_role('button', name=tr('Verteilung in ILIAS speichern'), exact=True)
        pw.expect(apply).to_be_enabled()
        apply.click()
        pw.expect(dialog).to_have_count(0)
        assert len(posts) == 1
        assert posts[0]['items'][0]['notice'] == '  Original human note   [BI:ta2|Bob]'
        assert posts[0]['items'][1]['notice'] == '[BI:ta1|Ada draft]'
        # A long native human note must block saving, with no truncated payload.
        oversized[0] = True
        page.reload()
        dialog, _ = open_dialog()
        pw.expect(dialog.get_by_role('alert').filter(has_text=tr('allocation.notice_conflicts', count=1))).to_be_visible()
        pw.expect(dialog.get_by_role('button', name=tr('Verteilung in ILIAS speichern'), exact=True)).to_be_disabled()
        assert len(posts) == 1
        assert dialog.evaluate('e => e.scrollWidth <= e.clientWidth + 1')
        page.screenshot(path=str(artifacts / f'note-guard-{width}-{language}.png'))
        page.keyboard.press('Escape')
        # Another account cannot see Alice's assistant names.
        page.evaluate("localStorage.setItem('betterilias_session_id','bob')")
        page.reload()
        dialog, _ = open_dialog()
        pw.expect(dialog.get_by_role('textbox').nth(0)).to_have_value('TA 1')
        pw.expect(dialog.get_by_role('textbox')).to_have_count(2)
        page.keyboard.press('Escape')
        # Same account in a different course also starts with its own defaults.
        page.evaluate("localStorage.setItem('betterilias_session_id','alice')")
        page.goto(local_site + '/?course=43&exercise=200&tab=submissions')
        dialog, _ = open_dialog()
        pw.expect(dialog.get_by_role('textbox').nth(0)).to_have_value('TA 1')
        assert len(posts) == 1
        browser.close()
