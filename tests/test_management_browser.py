"""Unified mode, reviewed deletion, shared ordering and empty-cache regression."""
import json
import os
from urllib.parse import urlparse

import pytest

from tests.test_localisation_browser import local_site

pytestmark = pytest.mark.skipif(os.environ.get('BETTERILIAS_BROWSER_TESTS') != '1', reason='Opt-in Chromium tests')


@pytest.mark.parametrize('viewport', [(320, 740), (1280, 800)])
@pytest.mark.parametrize('language,scheme,uncertain', [('en', 'light', False), ('de', 'dark', False), ('en', 'light', True)])
def test_unified_management_order_review_delete_and_empty_parent(local_site, language, scheme, uncertain, viewport):
    from pathlib import Path
    playwright = pytest.importorskip('playwright.sync_api')
    tr = json.loads((Path(__file__).resolve().parents[1] / 'locales' / f'{language}.json').read_text(encoding='utf8')).__getitem__
    context = dict(ref_id='42', can_create=True, can_manage=True, can_edit_page=True, creatable_types=['file', 'fold'])
    items = [dict(ref_id='51', title='Lecture notes', item_type='file', url='', properties={}, can_delete=True),
             dict(ref_id='52', title='Folder', item_type='fold', url='', properties={}, can_delete=True)]
    order = ['51', '52']
    deletes = []
    orders = []
    revision = '0' * 64

    def respond(route):
        nonlocal order, items
        path = urlparse(route.request.url).path
        if path.endswith('/status'):
            body = dict(authenticated=True, cookies_present=True)
        elif path.endswith('/semesters'):
            body = dict(active_semester='HS2026', available_semesters=[], courses=[], grouped_by_category={})
        elif path.endswith('/authoring-context'):
            body = context
        elif path.endswith('/management'):
            ref = path.split('/')[3]
            if ref == '52':
                body = dict(ref_id=ref, authoring=dict(context, ref_id=ref), items=[], order=[], order_revision=revision, can_sort=False)
            else:
                body = dict(ref_id='42', authoring=context, items=items, order=order, order_revision=revision,
                            can_sort=bool(items), editor_url='https://ilias.unibe.ch/ilias.php?ref_id=42&cmd=editPageFrame')
        elif path.endswith('/order'):
            payload = route.request.post_data_json
            orders.append(payload)
            assert payload['revision'] == revision
            order = payload['item_ids']
            body = dict(success=True)
        elif path.endswith('/deletion-review'):
            payload = route.request.post_data_json
            reviewed = [dict(ref_id=item['ref_id'], title=item['title'], item_type=item['item_type'], children=[
                dict(ref_id='53', title='Nested file', item_type='file', children=[])] if item['item_type'] == 'fold' else [])
                for item in items if item['ref_id'] in payload['item_ids']]
            body = dict(items=reviewed, revision=revision, descendants=1 if any(item['ref_id'] == '52' for item in reviewed) else 0)
        elif path.endswith('/batch/delete'):
            payload = route.request.post_data_json
            deletes.append(payload)
            assert payload['revision'] == revision
            items = [item for item in items if item['ref_id'] not in payload['item_ids']]
            order = [ref for ref in order if ref not in payload['item_ids']]
            if uncertain:
                route.fulfill(status=502, content_type='application/json', body=json.dumps({'detail': tr('management.delete_uncertain')}))
                return
            body = dict(success=True, deleted_ids=payload['item_ids'])
        elif path.endswith('/materials'):
            ref = path.split('/')[3]
            current_items = items if ref == '42' else []
            body = dict(container_ref_id=ref, title='Course' if ref == '42' else 'Folder', authoring=dict(context, ref_id=ref),
                        breadcrumbs=[dict(ref_id='42', title='Course')], items=current_items,
                        blocks=[dict(id='materials', block_type='items', items=current_items)] if current_items else [],
                        sections=[], sessions=[], logs=[], rich_text_blocks=[])
        else:
            body = {}
        route.fulfill(status=200, content_type='application/json', body=json.dumps(body))

    with playwright.sync_playwright() as p:
        browser = p.chromium.launch(headless=True, channel=os.environ.get('BETTERILIAS_BROWSER_CHANNEL'))
        page = browser.new_page(locale=language, color_scheme=scheme, viewport=dict(width=viewport[0], height=viewport[1]))
        page.add_init_script(f"localStorage.setItem('betterilias_language', '{language}');")
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.route('**/api/**', respond)
        page.goto(local_site + '/?course=42')
        playwright.expect(page.get_by_role('button', name=tr('authoring.add'), exact=True)).to_have_count(0)
        if viewport[0] < 768: page.get_by_label(tr('mobile.actions'), exact=True).click()
        page.get_by_role('button', name=tr('management.enter'), exact=True).click()
        panel = page.get_by_role('region', name=tr('management.panel'))
        playwright.expect(panel.get_by_role('button', name=tr('authoring.add'), exact=True)).to_be_visible()
        # Folder navigation preserves management mode within the current course.
        panel.get_by_role('button', name=tr('management.open_folder'), exact=True).click()
        playwright.expect(panel.get_by_role('heading', name='Folder', exact=True)).to_be_visible()
        if viewport[0] < 768:
            page.get_by_role('button', name=tr('mobile.back'), exact=True).click()
        else:
            page.get_by_role('navigation').get_by_role('button', name='Course', exact=True).click()
        playwright.expect(panel.get_by_role('heading', name='Course', exact=True)).to_be_visible()

        panel.get_by_role('button', name=tr('authoring.add'), exact=True).click()
        dialog = page.get_by_role('dialog')
        dialog.get_by_role('button', name=tr('management.page_elements'), exact=True).click()
        playwright.expect(dialog.get_by_text(tr('management.elements.columns'), exact=True)).to_be_visible()
        playwright.expect(dialog.get_by_role('link', name=tr('management.open_editor'))).to_have_attribute('href', 'https://ilias.unibe.ch/ilias.php?ref_id=42&cmd=editPageFrame')
        playwright.expect(dialog).to_contain_text(tr('management.editor_handoff'))
        dialog.get_by_role('button', name=tr('authoring.cancel'), exact=True).click()

        panel.get_by_role('button', name=tr('management.move_down').replace('{name}', 'Lecture notes'), exact=True).click()
        playwright.expect(panel.get_by_text(tr('management.order_draft'), exact=True)).to_be_visible()
        page.once('dialog', lambda event: event.dismiss())
        if viewport[0] < 768: page.get_by_label(tr('mobile.actions'), exact=True).click()
        page.get_by_role('button', name=tr('management.done'), exact=True).click()
        playwright.expect(panel).to_be_visible()
        panel.get_by_role('button', name=tr('management.save_order'), exact=True).click()
        playwright.expect(panel.get_by_text(tr('management.order_saved'), exact=True)).to_be_visible()
        assert orders[0]['item_ids'] == ['52', '51']
        Path('.pytest_cache').mkdir(exist_ok=True)
        panel.screenshot(path=f'.pytest_cache/management-{language}.png')

        panel.get_by_label(tr('management.select_all'), exact=True).check()
        panel.get_by_role('button', name=tr('management.delete_selected'), exact=True).click()
        delete_dialog = page.get_by_role('dialog', name=tr('management.delete_title'))
        playwright.expect(delete_dialog.get_by_role('button', name=tr('management.confirm_delete'), exact=True)).to_be_disabled()
        delete_dialog.get_by_text(tr('management.show_contents').replace('{count}', '1'), exact=True).click()
        playwright.expect(delete_dialog.get_by_text('Nested file', exact=True)).to_be_visible()
        delete_dialog.screenshot(path=f'.pytest_cache/management-delete-{language}.png')
        assert not deletes
        delete_dialog.get_by_role('button', name=tr('authoring.cancel'), exact=True).click()
        assert not deletes
        panel.get_by_role('button', name=tr('management.delete_selected'), exact=True).click()
        delete_dialog.get_by_role('checkbox').check()
        delete_dialog.get_by_role('button', name=tr('management.confirm_delete'), exact=True).click()
        playwright.expect(delete_dialog).to_have_count(0)
        if uncertain:
            playwright.expect(panel.get_by_role('alert')).to_have_text(tr('management.delete_uncertain'))
            playwright.expect(panel.get_by_role('button', name=tr('management.delete_selected'), exact=True)).to_be_disabled()
            playwright.expect(panel.get_by_role('link', name=tr('authoring.open_ilias'), exact=True)).to_be_visible()
            panel.get_by_role('button', name=tr('management.reload'), exact=True).click()
        playwright.expect(panel.get_by_text(tr('management.empty'), exact=True)).to_be_visible()
        if not uncertain:
            playwright.expect(panel.get_by_text(tr('management.deleted'), exact=True)).to_be_visible()
        assert set(deletes[0]['item_ids']) == {'51', '52'} and len(deletes) == 1
        page.wait_for_function("JSON.parse(localStorage.getItem('ilias_materials_cache_42')).items.length === 0")
        if viewport[0] < 768: page.get_by_label(tr('mobile.actions'), exact=True).click()
        page.get_by_role('button', name=tr('management.done'), exact=True).click()
        playwright.expect(page.get_by_text('Lecture notes', exact=True)).to_have_count(0)
        page.reload()
        playwright.expect(page.get_by_text('Lecture notes', exact=True)).to_have_count(0)
        context.update(can_create=False, can_manage=False, can_edit_page=False, creatable_types=[])
        page.reload()
        playwright.expect(page.get_by_role('button', name=tr('management.enter'), exact=True)).to_have_count(0)
        playwright.expect(page.get_by_role('button', name=tr('authoring.add'), exact=True)).to_have_count(0)
        assert not errors
        browser.close()
