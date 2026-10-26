"""Verify that a rejected upload is visible even when an old file exists."""
import json
import os
from urllib.parse import urlparse

import pytest

from tests.test_localisation_browser import local_site
from backend.scrapers.submissions import parse_student_assignment_detail

pytestmark = pytest.mark.skipif(os.environ.get('BETTERILIAS_BROWSER_TESTS') != '1', reason='Requires a frontend build and Chromium')


@pytest.mark.parametrize('team_upload', [False, True])
def test_upload_rejection_then_verified_success(local_site, team_upload):
    playwright = pytest.importorskip('playwright.sync_api')
    attempts, alerts, errors = [], [], []
    course = dict(ref_id='42', title='Course', url='', item_type='crs')
    old_file = dict(filename='previous.pdf', download_url='https://ilias.unibe.ch/ilias.php?cmd=download&delivered=1', delivered_id='1')
    detail = dict(exercise_ref_id='200', ass_id='20', title='Assignment', is_ended=False,
                  team_members=[], team_member_details=[], exercise_files=[], submitted_files=[old_file], submission_status='submitted')
    native_html = '''<div class="panel"><h2>Work instructions</h2><div class="panel-body">
        <div class="ilAssignmentInstructions"><p><strong>Important</strong> <em>emphasis</em> <u>underlined</u><br>New line</p>
        <p>Second paragraph</p><ul><li>First item</li></ul><ol><li>Step one</li></ol>
        <a href="https://example.org" target="_blank">Reading link</a></div></div></div>'''
    if team_upload: native_html += '<div class="panel"><h2>Team</h2><div class="panel-body"></div></div>'
    parsed = parse_student_assignment_detail(native_html, '200', '20')
    detail.update(instructions=parsed.instructions, is_team_upload=parsed.is_team_upload, time_remaining='No deadline specified')

    def respond(route):
        path = urlparse(route.request.url).path
        if path == '/api/auth/status':
            data = dict(authenticated=True, cookies_present=True)
        elif path == '/api/dashboard/semesters':
            data = dict(active_semester='HS2026', available_semesters=[], courses=[course], grouped_by_category={})
        elif path == '/api/courses/42/materials':
            data = dict(container_ref_id='42', title='Course', is_enrolled=True, breadcrumbs=[],
                        items=[], sections=[], blocks=[], sessions=[], logs=[], rich_text_blocks=[])
        elif path == '/api/exercises/200/overview':
            data = dict(exercise_ref_id='200', title='Exercises', has_ta_access=False, breadcrumbs=[], assignments=[
                dict(ass_id='20', title='Assignment', url='', is_ongoing=True, is_ended=False, properties={},
                     time_remaining='No deadline specified', status='Not Graded', requirement='Mandatory')])
        elif path == '/api/exercises/200/assignment/20':
            data = detail
        elif path == '/api/exercises/200/assignment/20/upload':
            attempts.append(route.request)
            if len(attempts) == 1:
                route.fulfill(status=400, content_type='application/json', body=json.dumps(dict(detail='ILIAS rejected this file type.')))
                return
            data = {**detail, 'submitted_files': [old_file, dict(filename='answer.pdf', delivered_id='2', download_url='https://ilias.unibe.ch/ilias.php?cmd=download&delivered=2')]}
        else:
            data = {}
        route.fulfill(status=200, content_type='application/json', body=json.dumps(data))

    with playwright.sync_playwright() as p:
        browser = p.chromium.launch(headless=True, channel=os.environ.get('BETTERILIAS_BROWSER_CHANNEL'))
        page = browser.new_page(locale='en-GB')
        page.set_default_timeout(10000)
        page.on('pageerror', lambda error: errors.append(str(error)))
        def accept_alert(dialog):
            alerts.append(dialog.message)
            dialog.accept()
        page.on('dialog', accept_alert)
        page.route('**/api/**', respond)
        page.goto(local_site + '/?course=42&exercise=200')
        page.get_by_role('button', name='Details & submission', exact=False).click()
        team_heading = page.get_by_role('heading', name='Team & group members', exact=True)
        if team_upload: playwright.expect(team_heading).to_be_visible()
        else: playwright.expect(team_heading).to_have_count(0)
        instructions = page.locator('.ilias-rich-content').filter(has=page.get_by_text('Important', exact=True))
        playwright.expect(instructions.locator('p')).to_have_count(2)
        playwright.expect(instructions.locator('br')).to_have_count(1)
        playwright.expect(instructions.locator('a')).to_have_attribute('target', '_blank')
        for dark in (False, True):
            page.evaluate('(dark) => document.documentElement.classList.toggle("dark", dark)', dark)
            assert instructions.locator('strong').evaluate('(el) => getComputedStyle(el).fontWeight') == '700'
            assert instructions.locator('em').evaluate('(el) => getComputedStyle(el).fontStyle') == 'italic'
            assert 'underline' in instructions.locator('u').evaluate('(el) => getComputedStyle(el).textDecorationLine')
            assert instructions.locator('ul').evaluate('(el) => getComputedStyle(el).listStyleType') == 'disc'
            assert instructions.locator('ol').evaluate('(el) => getComputedStyle(el).listStyleType') == 'decimal'
        upload = page.locator('#student-upload-20')
        playwright.expect(page.get_by_text('previous.pdf', exact=True)).to_be_visible()
        upload.set_input_files(dict(name='answer.pdf', mimeType='application/pdf', buffer=b'%PDF-test'))
        page.wait_for_function('document.querySelector("#student-upload-20").disabled === false')
        assert alerts == ['Could not upload submission: ILIAS rejected this file type.']
        playwright.expect(page.get_by_text('"answer.pdf" submitted successfully.', exact=True)).to_have_count(0)
        upload.set_input_files(dict(name='answer.pdf', mimeType='application/pdf', buffer=b'%PDF-test'))
        playwright.expect(page.get_by_text('"answer.pdf" submitted successfully.', exact=True)).to_be_visible()
        playwright.expect(page.get_by_text('answer.pdf', exact=True)).to_be_visible()
        assert len(attempts) == 2 and all(request.headers.get('accept-language') == 'en' for request in attempts)
        page.get_by_role('button', name='Close (Esc)', exact=True).click()
        page.get_by_role('button', name='Appearance & settings', exact=True).click()
        page.get_by_label('Language', exact=True).select_option('de')
        playwright.expect(page.get_by_text('Keine Abgabefrist angegeben', exact=True)).to_be_visible()
        playwright.expect(page.get_by_text('Nicht bewertet', exact=True)).to_be_visible()
        playwright.expect(page.get_by_text('Pflicht', exact=True)).to_be_visible()
        # The mocked ILIAS response stays English while BetterIlias changes language.
        page.keyboard.press('Escape')
        page.get_by_role('button', name='Details & Abgabe', exact=False).click()
        playwright.expect(page.get_by_text('Keine Abgabefrist angegeben', exact=True)).to_have_count(2)
        assert page.get_by_text('No deadline specified', exact=True).count() == 0
        assert not errors
        browser.close()
