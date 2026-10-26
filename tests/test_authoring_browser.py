"""Opt-in browser coverage for authoring in both languages and color schemes."""
import json
import os
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from urllib.parse import urlparse

import pytest

pytestmark = pytest.mark.skipif(os.environ.get('BETTERILIAS_BROWSER_TESTS') != '1', reason='Opt-in Chromium tests')


@pytest.mark.parametrize('language,scheme', [('en', 'light'), ('de', 'dark')])
def test_authoring_catalogue_folder_and_partial_file_upload(language, scheme):
    playwright = pytest.importorskip('playwright.sync_api')
    dist = Path(__file__).resolve().parents[1] / 'frontend' / 'dist'
    catalog = json.loads((dist.parents[1] / 'locales' / f'{language}.json').read_text(encoding='utf8'))
    tr = catalog.__getitem__
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(SimpleHTTPRequestHandler, directory=str(dist)))
    Thread(target=server.serve_forever, daemon=True).start()
    base = f'http://127.0.0.1:{server.server_port}'
    context = dict(ref_id='42', can_create=True, can_manage=True, can_edit_page=True, creatable_types=['fold', 'file', 'exc'])
    mutations = []
    uploads = []
    items = []

    def respond(route):
        path = urlparse(route.request.url).path
        if path.endswith('/status'):
            body = dict(authenticated=True, cookies_present=True)
        elif path.endswith('/semesters'):
            body = dict(active_semester='HS2026', available_semesters=[], courses=[], grouped_by_category={})
        elif path.endswith('/authoring-context'):
            body = context
        elif path.endswith('/folders/options'):
            body = dict(templates=[dict(value='dtpl_0', label='Default', selected=True), dict(value='dtpl_5', label='Hidden folder', selected=False)])
        elif path.endswith('/files/options'):
            body = dict(licenses=[dict(value='rights', label='All rights reserved', selected=True), dict(value='cc', label='Attribution (by)', selected=False)])
        elif path.endswith('/folders'):
            payload = route.request.post_data_json
            mutations.append(payload)
            item = dict(ref_id='51', title=payload['title'], item_type='fold', url='', properties={})
            items.append(item)
            body = dict(success=True, items=[item])
        elif path.endswith('/files'):
            assert page.evaluate("!window.dispatchEvent(new Event('beforeunload', { cancelable: true }))")
            uploads.append(route.request.post_data_buffer)
            assert route.request.headers.get('accept-language') == language
            assert route.request.headers.get('x-session-id') == 'test-author-session'
            if len(uploads) == 2:
                route.fulfill(status=502, content_type='application/json', body=json.dumps({'detail': tr('authoring.uncertain')}))
                return
            body = dict(success=True, items=[])
        elif path.endswith('/materials'):
            body = dict(container_ref_id='42', title='Course', authoring=context, breadcrumbs=[], items=items,
                        blocks=[dict(id='materials', block_type='items', items=items)], sections=[], sessions=[], logs=[], rich_text_blocks=[])
        else:
            body = {}
        route.fulfill(status=200, content_type='application/json', body=json.dumps(body))

    try:
        with playwright.sync_playwright() as p:
            browser = p.chromium.launch(headless=True, channel=os.environ.get('BETTERILIAS_BROWSER_CHANNEL'))
            page = browser.new_page(locale=language, color_scheme=scheme)
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.add_init_script(f"localStorage.setItem('betterilias_language', '{language}'); localStorage.setItem('betterilias_session_id', 'test-author-session');")
            page.route('**/api/**', respond)
            page.goto(base + '/?course=42')
            page.get_by_role('button', name=tr('authoring.add'), exact=True).click()
            dialog = page.get_by_role('dialog')
            playwright.expect(dialog.locator('section button')).to_have_count(30)
            playwright.expect(dialog.get_by_role('button', name=tr('objects.exc'), exact=False)).to_be_disabled()
            dialog.get_by_label(tr('authoring.search')).fill(tr('objects.fold'))
            dialog.get_by_role('button', name=tr('objects.fold'), exact=True).click()
            dialog.get_by_label(tr('authoring.title'), exact=True).fill('New materials')
            dialog.get_by_label(tr('authoring.description')).fill('Lecturer content')
            playwright.expect(dialog.get_by_label(tr('authoring.view'))).to_contain_text(tr('authoring.hidden'))
            dialog.get_by_role('button', name=tr('authoring.create'), exact=True).click()
            playwright.expect(dialog).to_have_count(0)
            assert mutations == [dict(title='New materials', description='Lecturer content', template_id='dtpl_0')]

            page.get_by_role('button', name=tr('authoring.add'), exact=True).click()
            dialog.get_by_role('button', name=tr('objects.file'), exact=True).click()
            dialog.locator('input[type=file]').set_input_files([
                dict(name='first.pdf', mimeType='application/pdf', buffer=b'first'),
                dict(name='second.pdf', mimeType='application/pdf', buffer=b'second'),
                dict(name='third.pdf', mimeType='application/pdf', buffer=b'third'),
            ])
            playwright.expect(dialog.get_by_label(tr('authoring.license'))).to_have_value('rights')
            dialog.get_by_role('button', name=tr('authoring.upload'), exact=True).click()
            playwright.expect(dialog.get_by_role('alert')).to_have_text(tr('authoring.uncertain'))
            playwright.expect(dialog.get_by_role('button', name=tr('authoring.upload'), exact=True)).to_be_disabled()
            playwright.expect(dialog.get_by_text(tr('authoring.saved'), exact=True)).to_be_visible()
            assert len(uploads) == 2
            assert b'first.pdf' in uploads[0] and b'second.pdf' in uploads[1]
            assert b'rights' in uploads[0]
            assert page.evaluate("window.dispatchEvent(new Event('beforeunload', { cancelable: true }))")
            dialog.get_by_role('button', name=tr('authoring.cancel'), exact=True).click()
            context.update(can_create=False, creatable_types=[])
            page.reload()
            playwright.expect(page.get_by_role('button', name=tr('authoring.add'), exact=True)).to_have_count(0)
            assert not errors
            browser.close()
    finally:
        server.shutdown()
        server.server_close()
