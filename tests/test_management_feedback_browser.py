"""Real browser management feedback; mocked API data, no live ILIAS writes."""
import json
import os
import time
from urllib.parse import urlparse

import pytest

from tests.test_localisation_browser import ROOT, local_site

pytestmark = pytest.mark.skipif(os.environ.get('BETTERILIAS_BROWSER_TESTS') != '1', reason='Opt-in Chromium checks')


@pytest.mark.parametrize('language,scheme', [('de', 'dark'), ('de', 'light'), ('en', 'dark'), ('en', 'light')])
@pytest.mark.parametrize('width,height', [(320, 740), (390, 844), (430, 900), (768, 1024), (1280, 800), (844, 390)])
def test_management_shared_feedback_and_unconfirmed_upload(local_site, language, scheme, width, height):
    pw = pytest.importorskip('playwright.sync_api')
    catalogue = json.loads((ROOT/'locales'/f'{language}.json').read_text(encoding='utf8'))
    def tr(key, **values):
        text = catalogue[key]
        for name, value in values.items():
            text = text.replace('{'+name+'}', str(value))
        return text
    context = dict(ref_id='42', can_create=True, can_manage=True, can_edit_page=False, creatable_types=['file', 'fold'])
    items = []
    calls = []
    pending_reviews = []
    pending_deletions = []
    state = dict(unconfirmed=True, refresh_failure=False, invalid_uploads=0)
    def respond(route):
        path = urlparse(route.request.url).path
        calls.append((route.request.method, path))
        if path.endswith('/status'):
            body = dict(authenticated=True, cookies_present=True)
        elif path.endswith('/semesters'):
            body = dict(active_semester='HS2026', available_semesters=[], courses=[], grouped_by_category={})
        elif path.endswith('/authoring-context'):
            body = context
        elif path.endswith('/management'):
            if state['refresh_failure']:
                route.fulfill(status=503, content_type='application/json', body=json.dumps(dict(detail=tr('management.load_failed'))))
                return
            body = dict(ref_id='42', authoring=context, items=[dict(item, can_delete=True) for item in items],
                can_sort=False, order=[], order_revision='')
        elif path.endswith('/folders/options'):
            body = dict(templates=[dict(value='default', label='Default', selected=True)])
        elif path.endswith('/files/options'):
            body = dict(licenses=[dict(value='rights', label='All rights reserved', selected=True)])
        elif path.endswith('/folders'):
            item = dict(ref_id='51', title=route.request.post_data_json['title'], item_type='fold', url='', properties={})
            items.append(item)
            body = dict(success=True, items=[item])
        elif path.endswith('/files'):
            if state['unconfirmed']:
                valid_item = dict(ref_id='52', title='notes.pdf', item_type='file', url='', properties={})
                body = [dict(success=True, items=[]), dict(success=False, items=[valid_item]),
                    {}, dict(success=True, items=[dict(valid_item, item_type='fold')])][state['invalid_uploads']]
                state['invalid_uploads'] += 1
            else:
                item = dict(ref_id='52', title='notes.pdf', item_type='file', url='', properties={})
                items.append(item)
                body = dict(success=True, items=[item])
        elif path.endswith('/deletion-review'):
            if state.get('hold_review'):
                pending_reviews.append(route)
                return
            body = dict(items=[dict(ref_id='52', title='notes.pdf', item_type='file', children=[])], revision='a'*64, descendants=0)
        elif path.endswith('/batch/delete'):
            if state.get('hold_delete'):
                pending_deletions.append(route)
                return
            items[:] = [item for item in items if item['ref_id'] != '52']
            body = dict(success=True, deleted_ids=['52'])
        elif path.endswith('/materials'):
            body = dict(container_ref_id='42', title='Demo course', authoring=context, breadcrumbs=[], items=items,
                blocks=[], sections=[], sessions=[], logs=[], rich_text_blocks=[])
        else:
            body = {}
        route.fulfill(content_type='application/json', body=json.dumps(body))
    with pw.sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport=dict(width=width, height=height), color_scheme=scheme, locale=language)
        page.add_init_script(f"localStorage.setItem('betterilias_language','{language}'); localStorage.setItem('betterilias_session_id','test-management'); localStorage.setItem('betterilias_theme_mode','{scheme}');")
        page.route('**/api/**', respond)
        page.route('https://cdn.jsdelivr.net/**', lambda route: route.abort())
        page.goto(local_site+'/?course=42', wait_until='networkidle')
        if width < 768:
            page.get_by_label(tr('mobile.actions'), exact=True).click()
        page.get_by_role('button', name=tr('management.enter'), exact=True).click()
        panel = page.get_by_role('region', name=tr('management.panel'))
        add = panel.get_by_role('button', name=tr('authoring.add'), exact=True)
        feedback = panel.locator('[data-management-feedback]')
        dialog = page.get_by_role('dialog')
        def take_pending(requests):
            deadline = time.monotonic() + 5
            while not requests and time.monotonic() < deadline:
                page.wait_for_timeout(10)
            assert requests, 'Expected a held backend request'
            return requests.pop(0)
        def open_form(kind):
            pw.expect(add).to_be_enabled()
            add.click()
            dialog.get_by_role('button', name=tr('objects.'+kind), exact=True).click()
        def dismiss():
            feedback.get_by_role('button', name=tr('Schliessen'), exact=True).click()
            pw.expect(feedback).to_have_count(0)
            pw.expect(panel.get_by_role('heading', name='Demo course', exact=True)).to_be_focused()
        open_form('file')
        pw.expect(dialog.get_by_role('button', name=tr('authoring.upload'), exact=True)).to_be_disabled()
        # An empty form submission must never claim that files were uploaded.
        dialog.locator('form').dispatch_event('submit')
        assert not [call for call in calls if call[0]=='POST' and call[1].endswith('/files')]
        dialog.locator('input[type=file]').set_input_files([
            dict(name=f'notes-{index}.pdf', mimeType='application/pdf', buffer=b'demo') for index in range(4)])
        dialog.get_by_role('button', name=tr('authoring.upload'), exact=True).click()
        pw.expect(dialog.get_by_role('alert')).to_have_text(tr('authoring.uploads_partial'))
        pw.expect(dialog.get_by_text(tr('authoring.uncertain'), exact=True)).to_have_count(4)
        pw.expect(page.get_by_text(tr('authoring.files_saved'), exact=True)).to_have_count(0)
        dialog.get_by_role('button', name=tr('authoring.cancel'), exact=True).click()
        open_form('fold')
        dialog.get_by_label(tr('authoring.title'), exact=True).fill('New folder')
        dialog.get_by_role('button', name=tr('authoring.create'), exact=True).click()
        pw.expect(dialog).to_have_count(0)
        pw.expect(feedback.get_by_role('status')).to_have_text(tr('authoring.created'))
        pw.expect(panel.get_by_text('New folder', exact=True)).to_be_visible()
        assert panel.get_by_text('New folder', exact=True).bounding_box()['height'] <= 48
        assert feedback.bounding_box()['width'] <= width
        dismiss()
        # A verified save followed by a failed refresh is one warning, with the saved item retained.
        state.update(unconfirmed=False, refresh_failure=True)
        reads_before = len([call for call in calls if call[1].endswith('/management')])
        open_form('file')
        dialog.locator('input[type=file]').set_input_files(dict(name='notes.pdf', mimeType='application/pdf', buffer=b'demo'))
        dialog.get_by_role('button', name=tr('authoring.upload'), exact=True).click()
        pw.expect(dialog).to_have_count(0)
        pw.expect(feedback).to_have_count(1)
        pw.expect(feedback.get_by_role('status')).to_have_text(tr('management.saved_refresh_failed', result=tr('authoring.files_saved')))
        pw.expect(panel.get_by_text('notes.pdf', exact=True)).to_be_visible()
        assert len([call for call in calls if call[1].endswith('/management')]) - reads_before == 1
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        artifacts = ROOT/'scratch'/'management-feedback'
        artifacts.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(artifacts/f'{language}-{scheme}-{width}-refresh-warning.png'), animations='disabled')
        dismiss()
        state['refresh_failure'] = False
        panel.get_by_role('button', name=tr('management.reload'), exact=True).click()
        delete = panel.get_by_role('button', name=tr('management.delete_item', name='notes.pdf'), exact=True)
        pw.expect(delete).to_be_enabled()
        state.update(hold_review=True, hold_delete=True)
        delete.click()
        confirm = dialog.get_by_role('button', name=tr('management.confirm_delete'), exact=True)
        cancel = dialog.get_by_role('button', name=tr('authoring.cancel'), exact=True)
        pw.expect(dialog).to_be_visible()
        pw.expect(confirm).to_be_disabled()
        pw.expect(confirm).to_have_attribute('aria-busy', 'true')
        pw.expect(confirm.locator('svg')).to_be_visible()
        pw.expect(cancel).to_be_enabled()
        pw.expect(cancel).to_be_focused()
        page.emulate_media(reduced_motion='reduce')
        assert confirm.locator('svg').evaluate('(icon) => getComputedStyle(icon).animationName') == 'none'
        page.emulate_media(reduced_motion='no-preference')
        # Dismissing an in-flight review must not reopen the dialog on its late response.
        cancel.click()
        pw.expect(dialog).to_have_count(0)
        pw.expect(delete).to_be_focused()
        review_body = dict(items=[dict(ref_id='52', title='notes.pdf', item_type='file', children=[])], revision='a'*64, descendants=0)
        take_pending(pending_reviews).fulfill(content_type='application/json', body=json.dumps(review_body))
        pw.expect(dialog).to_have_count(0)
        delete.click()
        pw.expect(confirm).to_be_disabled()
        take_pending(pending_reviews).fulfill(status=503, content_type='application/json', body=json.dumps(dict(detail=tr('management.inspection_incomplete'))))
        pw.expect(dialog.get_by_role('alert')).to_contain_text(tr('management.inspection_incomplete'))
        pw.expect(confirm).to_be_disabled()
        pw.expect(confirm).to_have_attribute('aria-busy', 'false')
        dialog.get_by_role('button', name=tr('Erneut versuchen'), exact=True).click()
        pw.expect(confirm).to_have_attribute('aria-busy', 'true')
        take_pending(pending_reviews).fulfill(content_type='application/json', body=json.dumps(review_body))
        pw.expect(confirm).to_be_enabled()
        # Cached previews still wait for a fresh review before enabling deletion.
        cancel.click()
        delete.click()
        pw.expect(confirm).to_be_disabled()
        pw.expect(confirm.locator('svg')).to_be_visible()
        page.screenshot(path=str(artifacts/f'{language}-{scheme}-{width}-review-loading.png'), animations='disabled')
        take_pending(pending_reviews).fulfill(content_type='application/json', body=json.dumps(review_body))
        pw.expect(confirm).to_be_enabled()
        confirm.click()
        pw.expect(dialog).to_be_visible()
        pw.expect(confirm).to_be_disabled()
        pw.expect(confirm).to_have_attribute('aria-busy', 'true')
        pw.expect(confirm.locator('svg')).to_be_visible()
        pw.expect(cancel).to_be_disabled()
        page.keyboard.press('Escape')
        pw.expect(dialog).to_be_visible()
        page.screenshot(path=str(artifacts/f'{language}-{scheme}-{width}-deleting.png'), animations='disabled')
        items[:] = [item for item in items if item['ref_id'] != '52']
        request = take_pending(pending_deletions)
        assert not pending_deletions
        assert len([call for call in calls if call[1].endswith('/batch/delete')]) == 1
        request.fulfill(content_type='application/json', body=json.dumps(dict(success=True, deleted_ids=['52'])))
        pw.expect(dialog).to_have_count(0)
        pw.expect(feedback.get_by_role('status')).to_have_text(tr('management.deleted'))
        page.screenshot(path=str(artifacts/f'{language}-{scheme}-{width}-deleted.png'), animations='disabled')
        dismiss()
        pw.expect(panel.get_by_text('notes.pdf', exact=True)).to_have_count(0)
        browser.close()
