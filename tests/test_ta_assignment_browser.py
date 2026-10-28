"""Creation remains a single editor page; changing type must retain the draft."""
import json
import os
from urllib.parse import urlparse
import pytest
from tests.test_localisation_browser import local_site
from tests.test_ta_assignment_save import NativeMarkupScenario, NATIVE_FORM, upload_parts
from backend.services.assignment_multipart import encode_assignment_form
import httpx
from backend.api.deps import get_ilias_client
from backend.main import app
from fastapi.testclient import TestClient

pytestmark = pytest.mark.skipif(os.environ.get('BETTERILIAS_BROWSER_TESTS') != '1', reason='Requires a frontend build and Chromium')


def test_native_browser_and_backend_send_the_same_empty_uploads():
    playwright = pytest.importorskip('playwright.sync_api')
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch(headless=True, channel=os.environ.get('BETTERILIAS_BROWSER_CHANNEL'))
        page = browser.new_page()
        page.set_content(NATIVE_FORM)
        # Request serializes FormData locally without sending anything to ILIAS.
        native = page.evaluate('''async () => {
            const request = new Request('https://example.invalid', {
                method: 'POST', body: new FormData(document.querySelector('form'))
            });
            return {contentType: request.headers.get('content-type'), body: await request.text()};
        }''')
        browser.close()
    reference = httpx.Request('POST', 'https://example.invalid', content=native['body'].encode(),
                              headers={'Content-Type': native['contentType']})
    native_uploads = upload_parts(reference)
    assert set(native_uploads) == {'files[0]', 'fb_file'}
    body, content_type = encode_assignment_form({}, list(native_uploads))
    encoded = upload_parts(httpx.Request('POST', 'https://example.invalid', content=body,
                                        headers={'Content-Type': content_type}))
    for name, part in native_uploads.items():
        assert part.get_filename() == encoded[name].get_filename() == ''
        assert part.get_payload(decode=True) == encoded[name].get_payload(decode=True) == b''
        assert part.get_content_type() == encoded[name].get_content_type() == 'application/octet-stream'


@pytest.mark.parametrize('width', [320, 1280])
def test_create_team_assignment_preserves_draft_and_recovers_from_rejection(local_site, width):
    playwright = pytest.importorskip('playwright.sync_api')
    drafts, errors = [], []
    created = False
    types = {'1':'Upload','4':'Team Upload','5':'Text','3':'Portfolio','6':'Team Wiki'}
    title = 'Draft team assignment'
    saved = dict(ass_id='99', exercise_ref_id='200', title=title, type_id=4, type_name='Team Upload', mandatory=True,
                 instruction_html='<p>Keep these instructions</p>', deadline_mode=0, deadline='2030-12-31T23:59',
                 instruction_files=[], available_types=types)

    def respond(route):
        nonlocal created
        path = urlparse(route.request.url).path
        if path == '/api/auth/status':
            data = dict(authenticated=True, cookies_present=True)
        elif path == '/api/dashboard/semesters':
            data = dict(active_semester='HS2026', courses=[], available_semesters=[], grouped_by_category={})
        elif path == '/api/courses/42/materials':
            data = dict(container_ref_id='42', title='Course', is_enrolled=True, items=[], blocks=[], sections=[], sessions=[], breadcrumbs=[], logs=[], rich_text_blocks=[])
        elif path == '/api/exercises/200/overview':
            data = dict(exercise_ref_id='200', title='Exercises', has_ta_access=True, assignments=[], breadcrumbs=[])
        elif path == '/api/exercises/200/ta/assignments':
            assignments = [dict(ass_id='99', title=title, type_id=4, type_name='Team Upload', order_val=10, mandatory=True)] if created else []
            data = dict(exercise_ref_id='200', assignments=assignments, available_types=types)
        elif path == '/api/exercises/200/ta/assignment-detail':
            if route.request.method == 'POST':
                drafts.append(route.request.post_data_json)
                if len(drafts) == 1:
                    route.fulfill(status=400, content_type='application/json', body=json.dumps({'detail':'Team formation: Please select an option.'}))
                    return
                created = True
            data = saved
        else:
            data = {}
        route.fulfill(status=200, content_type='application/json', body=json.dumps(data))

    with playwright.sync_playwright() as p:
        browser = p.chromium.launch(headless=True, channel=os.environ.get('BETTERILIAS_BROWSER_CHANNEL'))
        page = browser.new_page(locale='en-GB', viewport=dict(width=width, height=740), has_touch=width < 768)
        page.set_default_timeout(10000)
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.route('**/api/**', respond)
        page.goto(local_site + '/?course=42&exercise=200')
        page.get_by_role('button', name='Manage assignments', exact=True).click()
        page.get_by_role('button', name='Create new assignment', exact=True).click()
        title_input = page.get_by_placeholder('e.g. Assignment 01: Introduction to algorithms')
        original_border = title_input.evaluate('(el) => getComputedStyle(el).borderColor')
        page.get_by_role('button', name='Create assignment', exact=True).last.click()
        playwright.expect(title_input).to_be_focused()
        playwright.expect(title_input).to_be_in_viewport()
        playwright.expect(title_input).to_have_attribute('aria-invalid', 'true')
        playwright.expect(page.locator('#assignment-title-error')).to_have_text('Please enter a title for the assignment.')
        assert title_input.get_attribute('aria-describedby') == 'assignment-title-error'
        assert title_input.evaluate('(el) => getComputedStyle(el).borderColor') != original_border
        assert drafts == []
        title_input.fill(title)
        playwright.expect(title_input).to_have_attribute('aria-invalid', 'false')
        playwright.expect(page.locator('#assignment-title-error')).to_have_count(0)
        page.get_by_role('button', name='Create assignment', exact=True).first.click()
        deadline_input = page.get_by_label('Submission deadline', exact=True)
        playwright.expect(deadline_input).to_be_focused()
        playwright.expect(deadline_input).to_be_in_viewport()
        playwright.expect(page.locator('#assignment-deadline-error')).to_be_visible()
        page.get_by_role('radio', name='No deadline', exact=True).check()
        playwright.expect(page.locator('#assignment-deadline-error')).to_have_count(0)
        page.get_by_role('radio', name='Fixed submission date', exact=True).check()
        deadline_input.fill('2030-12-31T23:59')
        playwright.expect(deadline_input).to_have_attribute('aria-invalid', 'false')
        page.get_by_role('checkbox', name='Allow grace period', exact=True).check()
        page.get_by_role('button', name='Create assignment', exact=True).last.click()
        grace = page.get_by_label('End of grace period', exact=True)
        playwright.expect(grace).to_be_focused()
        playwright.expect(page.locator('#assignment-grace-end-error')).to_have_text('Please enter the end of the grace period.')
        grace.fill('2029-12-31T23:59')
        playwright.expect(grace).to_have_attribute('aria-invalid', 'true')
        grace.fill('2031-01-01T23:59')
        playwright.expect(grace).to_have_attribute('aria-invalid', 'false')
        page.get_by_role('checkbox', name='Allow grace period', exact=True).uncheck()
        # The final checkbox in the settings section enables the conditional limit.
        limit_toggle = page.locator('input[type=checkbox]').last
        limit_toggle.check()
        page.get_by_role('button', name='Create assignment', exact=True).first.click()
        limit = page.get_by_label('Maximum number of files', exact=True)
        playwright.expect(limit).to_be_focused()
        playwright.expect(page.locator('#assignment-file-limit-error')).to_have_text('Enter a whole number between 1 and 100.')
        limit.fill('1.5')
        playwright.expect(limit).to_have_attribute('aria-invalid', 'true')
        limit.fill('3')
        playwright.expect(limit).to_have_attribute('aria-invalid', 'false')
        limit_toggle.uncheck()
        start = page.locator('#assignment-start')
        start.fill('2031-01-01T00:00')
        page.get_by_role('button', name='Create assignment', exact=True).first.click()
        playwright.expect(start).to_be_focused()
        playwright.expect(page.locator('#assignment-start-error')).to_be_visible()
        start.fill('')
        playwright.expect(start).to_have_attribute('aria-invalid', 'false')
        assert drafts == []
        instructions = page.get_by_role('textbox', name='Formatted assignment instructions', exact=True)
        instructions.fill('Keep these instructions')
        page.get_by_label('Submission deadline', exact=True).fill('2030-12-31T23:59')
        selector = page.get_by_label('Submission type', exact=True)
        selector.select_option('4')
        playwright.expect(title_input).to_have_value(title)
        playwright.expect(instructions).to_have_text('Keep these instructions')
        assert selector.locator('option[value="2"]').count() == 0
        page.get_by_role('button', name='Create assignment', exact=True).first.click()
        playwright.expect(page.get_by_text('Team formation: Please select an option.', exact=True)).to_be_visible()
        playwright.expect(title_input).to_have_value(title)
        playwright.expect(selector).to_have_value('4')
        playwright.expect(instructions).to_have_text('Keep these instructions')
        page.get_by_role('button', name='Create assignment', exact=True).last.click()
        if width < 768:
            playwright.expect(page.get_by_role('combobox', name='Exercise view')).to_have_value('manage')
        else:
            playwright.expect(page.get_by_role('heading', name='Manage & edit assignments', exact=True)).to_be_visible()
        playwright.expect(page.get_by_text(title, exact=True)).to_be_visible()
        confirmation = page.get_by_role('status', name='Assignment confirmation', exact=True)
        playwright.expect(confirmation).to_have_text(f'Assignment “{title}” created successfully.')
        playwright.expect(confirmation).to_be_visible()
        playwright.expect(confirmation).to_have_attribute('aria-live', 'polite')
        confirmation.get_by_role('button', name='Close', exact=True).click()
        playwright.expect(confirmation).to_have_count(0)
        assert len(drafts) == 2 and drafts[0] == drafts[1]
        assert drafts[1]['type_id'] == 4 and drafts[1]['deadline'] == '2030-12-31T23:59'
        assert 'Keep these instructions' in drafts[1]['instruction_html']
        page.get_by_role('button', name=f'Edit assignment {title}', exact=True).click()
        playwright.expect(page.get_by_label('Submission type', exact=True)).to_be_disabled()
        page.get_by_role('button', name='Save changes', exact=True).first.click()
        playwright.expect(page.get_by_role('status', name='Assignment confirmation', exact=True)).to_have_text(f'Assignment “{title}” saved successfully.')
        assert errors == []
        browser.close()


def test_native_management_list_and_creation_toolbar_through_backend(local_site):
    playwright = pytest.importorskip('playwright.sync_api')
    scenario = NativeMarkupScenario()
    app.dependency_overrides[get_ilias_client] = lambda: scenario.client
    try:
        with TestClient(app) as backend, playwright.sync_playwright() as p:
            browser = p.chromium.launch(headless=True, channel=os.environ.get('BETTERILIAS_BROWSER_CHANNEL'))
            page = browser.new_page(locale='en-GB')
            page.set_default_timeout(10000)

            def respond(route):
                path = urlparse(route.request.url).path
                if '/ta/' in path:
                    data = route.request.post_data_json if route.request.method == 'POST' else None
                    response = backend.request(route.request.method, path, json=data, headers={'Accept-Language':'en'})
                    route.fulfill(status=response.status_code, content_type='application/json', body=response.content)
                    return
                if path.endswith('/status'):
                    data = dict(authenticated=True, cookies_present=True)
                elif path.endswith('/semesters'):
                    data = dict(active_semester='HS2026', courses=[], available_semesters=[], grouped_by_category={})
                elif path.endswith('/materials'):
                    data = dict(container_ref_id='42', title='Course', is_enrolled=True, items=[], sections=[], blocks=[], sessions=[], breadcrumbs=[], logs=[], rich_text_blocks=[])
                elif path.endswith('/overview'):
                    data = dict(exercise_ref_id=scenario.ref, title='Exercises', has_ta_access=True, assignments=[], breadcrumbs=[])
                else:
                    data = {}
                route.fulfill(status=200, content_type='application/json', body=json.dumps(data))

            page.route('**/api/**', respond)
            page.goto(local_site + f'/?course=42&exercise={scenario.ref}')
            page.get_by_role('button', name='Manage assignments', exact=True).click()
            playwright.expect(page.locator('tbody tr')).to_have_count(12)
            assert scenario.posts == []
            page.get_by_role('button', name='Create new assignment', exact=True).click()
            page.get_by_placeholder('e.g. Assignment 01: Introduction to algorithms').fill(scenario.title)
            page.get_by_label('Submission type', exact=True).select_option('4')
            page.get_by_label('Submission deadline', exact=True).fill('2030-12-31T23:59')
            page.get_by_role('button', name='Create assignment', exact=True).first.click()
            playwright.expect(page.get_by_role('heading', name='Manage & edit assignments', exact=True)).to_be_visible()
            playwright.expect(page.locator('tbody tr')).to_have_count(13)
            playwright.expect(page.get_by_text(scenario.title, exact=True)).to_be_visible()
            playwright.expect(page.get_by_role('status', name='Assignment confirmation', exact=True)).to_have_text(f'Assignment “{scenario.title}” created successfully.')
            assert scenario.posts[0][1] == {'type':'4'}
            browser.close()
    finally:
        app.dependency_overrides.pop(get_ilias_client, None)


def test_instruction_formatting_links_edit_reload_and_failed_attachment_retry(local_site):
    playwright = pytest.importorskip('playwright.sync_api')
    drafts, uploads = [], []
    initial = '<p><strong>Existing instructions</strong><br><em>Read carefully</em></p>'
    saved = dict(ass_id='99', exercise_ref_id='200', title='Rich instructions', type_id=1, type_name='Upload', mandatory=True,
                 instruction_html=initial, deadline_mode=-1, instruction_files=[], available_types={'1':'Upload', '4':'Team Upload'})

    def respond(route):
        path = urlparse(route.request.url).path
        if path.endswith('/instruction-files'):
            uploads.append(route.request.post_data_buffer)
            if len(uploads) == 1:
                route.fulfill(status=400, content_type='application/json', body=json.dumps({'detail':'ILIAS rejected attachment'}))
                return
            saved['instruction_files'] = [dict(file_id='resource', filename='worksheet.pdf', download_url='https://example.org/file')]
            data = saved['instruction_files']
        elif path.endswith('/assignment-detail'):
            if route.request.method == 'POST':
                drafts.append(route.request.post_data_json)
                saved.update(drafts[-1], ass_id='99')
            data = saved
        elif path.endswith('/ta/assignments'):
            data = dict(exercise_ref_id='200', available_types=saved['available_types'], assignments=[dict(ass_id='99', title=saved['title'], type_id=1, type_name='Upload', order_val=10, mandatory=True)])
        elif path.endswith('/status'):
            data = dict(authenticated=True, cookies_present=True)
        elif path.endswith('/semesters'):
            data = dict(active_semester='HS2026', courses=[], available_semesters=[], grouped_by_category={})
        elif path.endswith('/materials'):
            data = dict(container_ref_id='42', title='Course', is_enrolled=True, items=[], blocks=[], sections=[], sessions=[], breadcrumbs=[], logs=[], rich_text_blocks=[])
        elif path.endswith('/overview'):
            data = dict(exercise_ref_id='200', title='Exercises', has_ta_access=True, assignments=[], breadcrumbs=[])
        else:
            data = {}
        route.fulfill(status=200, content_type='application/json', body=json.dumps(data))

    with playwright.sync_playwright() as p:
        browser = p.chromium.launch(headless=True, channel=os.environ.get('BETTERILIAS_BROWSER_CHANNEL'))
        page = browser.new_page(locale='en-GB')
        page.set_default_timeout(10000)
        page.route('**/api/**', respond)
        page.goto(local_site + '/?course=42&exercise=200')
        page.get_by_role('button', name='Manage assignments', exact=True).click()
        page.get_by_role('button', name='Edit assignment Rich instructions', exact=True).click()
        editor = page.get_by_role('textbox', name='Formatted assignment instructions', exact=True)
        playwright.expect(editor.locator('strong')).to_have_text('Existing instructions')
        playwright.expect(editor.locator('em')).to_have_text('Read carefully')
        playwright.expect(page.get_by_label('Submission type', exact=True)).to_be_disabled()
        info = page.get_by_role('button', name='The submission type is fixed after creation.', exact=True)
        playwright.expect(page.get_by_role('tooltip')).to_be_hidden()
        info.hover()
        playwright.expect(page.get_by_role('tooltip')).to_have_text('The submission type is fixed after creation.')
        editor.click()
        playwright.expect(page.get_by_role('tooltip')).to_be_hidden()
        # Start a creation draft and retain a failed queued attachment after save.
        page.get_by_role('button', name='Back to assignment management', exact=True).click()
        page.get_by_role('button', name='Create new assignment', exact=True).click()
        page.get_by_placeholder('e.g. Assignment 01: Introduction to algorithms').fill('Rich instructions')
        playwright.expect(page.get_by_label('Submission type', exact=True)).to_be_enabled()
        assert info.count() == 0
        assert page.get_by_text('You can change this at any time without resetting your inputs.', exact=True).count() == 0
        page.get_by_role('radio', name='No deadline', exact=True).check()
        editor.fill('Important instructions')
        editor.press('Control+a')
        bold = page.get_by_role('button', name='Apply bold', exact=True)
        bold.click()
        playwright.expect(bold).to_have_attribute('aria-pressed', 'true')
        italic = page.get_by_role('button', name='Apply italic', exact=True)
        italic.click()
        playwright.expect(italic).to_have_attribute('aria-pressed', 'true')
        editor.press('ArrowRight')
        page.keyboard.type(' both formats')
        bold.click()
        playwright.expect(bold).to_have_attribute('aria-pressed', 'false')
        playwright.expect(italic).to_have_attribute('aria-pressed', 'true')
        playwright.expect(editor).to_be_focused()
        italic.click()
        playwright.expect(bold).to_have_attribute('aria-pressed', 'false')
        playwright.expect(italic).to_have_attribute('aria-pressed', 'false')
        playwright.expect(editor).to_be_focused()
        page.keyboard.type(' plain text')
        assert editor.evaluate('''element => {
            const selection = window.getSelection();
            return !selection.anchorNode.parentElement.closest('b,strong,i,em');
        }''')
        page.get_by_role('button', name='Insert link', exact=True).click()
        dialog = page.get_by_role('dialog', name='Insert link', exact=True)
        dialog.get_by_label('URL', exact=True).fill('https://example.org/worksheet?a=1&b=2')
        dialog.get_by_label('Text to display', exact=True).fill('Worksheet link')
        dialog.get_by_label('Open link in', exact=True).select_option('_blank')
        dialog.get_by_role('button', name='Apply link', exact=True).click()
        playwright.expect(editor.locator('a')).to_have_text('Worksheet link')
        playwright.expect(editor.locator('a')).to_have_attribute('target', '_blank')
        # Edit an existing link and use the current window.
        editor.locator('a').click()
        page.get_by_role('button', name='Insert link', exact=True).click()
        playwright.expect(dialog.get_by_label('Text to display', exact=True)).to_have_value('Worksheet link')
        dialog.get_by_label('Open link in', exact=True).select_option('_self')
        dialog.get_by_role('button', name='Apply link', exact=True).click()
        assert editor.locator('a').get_attribute('target') is None
        page.get_by_role('button', name='HTML', exact=True).click()
        source = page.get_by_role('textbox', name='Instruction HTML', exact=True)
        assert '<strong>' in source.input_value() and '<em>' in source.input_value()
        source.fill(source.input_value() + '<p>Second paragraph<br>Another line</p>')
        page.get_by_role('button', name='Formatted text', exact=True).click()
        playwright.expect(editor).to_contain_text('Second paragraph')
        page.locator('input[type=file]').set_input_files(dict(name='worksheet.pdf', mimeType='application/pdf', buffer=b'%PDF-test'))
        page.get_by_role('button', name='Create assignment', exact=True).first.click()
        playwright.expect(page.get_by_role('alert')).to_contain_text('ILIAS rejected attachment')
        playwright.expect(page.get_by_text('worksheet.pdf', exact=True)).to_be_visible()
        playwright.expect(editor).to_contain_text('Important instructions')
        page.get_by_role('button', name='Save changes', exact=True).first.click()
        playwright.expect(page.get_by_role('heading', name='Manage & edit assignments', exact=True)).to_be_visible()
        assert len(uploads) == 2
        assert drafts[0]['ass_id'] is None and drafts[1]['ass_id'] == '99'
        assert '<strong>' in drafts[0]['instruction_html'] and '<em>' in drafts[0]['instruction_html']
        assert '<b>' not in drafts[0]['instruction_html']
        page.get_by_role('button', name='Edit assignment Rich instructions', exact=True).click()
        playwright.expect(editor).to_contain_text('Important instructions')
        playwright.expect(editor.locator('a')).to_have_text('Worksheet link')
        playwright.expect(page.get_by_text('worksheet.pdf', exact=True)).to_be_visible()
        browser.close()
