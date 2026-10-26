"""Opt-in UI regression checks: BETTERILIAS_BROWSER_TESTS=1 after a frontend build."""
import json
import os
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from urllib.parse import urlparse, parse_qs

import pytest

pytestmark = pytest.mark.skipif(os.environ.get('BETTERILIAS_BROWSER_TESTS') != '1', reason='Opt-in Chromium tests')


def test_membership_actions_and_automatic_icons():
    playwright = pytest.importorskip('playwright.sync_api')
    dist = Path(__file__).resolve().parents[1] / 'frontend' / 'dist'
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(SimpleHTTPRequestHandler, directory=str(dist)))
    Thread(target=server.serve_forever, daemon=True).start()
    base = f'http://127.0.0.1:{server.server_port}'
    joined = False
    mutations = []
    crumbs = [dict(ref_id=ref, title=title) for ref, title in [
        ('1', 'Repository'), ('10', 'Philosophisch-naturwissenschaftliche Fakultät'),
        ('11', 'Informatik'), ('12', 'HS2026'), ('13', 'Vorlesung'),
    ]]

    def course(ref, title, **extra):
        return dict(ref_id=ref, title=title, item_type='crs', url=f'https://ilias.unibe.ch/go/crs/{ref}', **extra)

    def respond(route):
        nonlocal joined
        url = urlparse(route.request.url)
        path = url.path
        if path == '/api/auth/status':
            body = dict(authenticated=True, cookies_present=True)
        elif path == '/api/dashboard/semesters':
            courses = [course('44', 'KSL course', subject='Future discipline', faculty='Rechtswissenschaftliche Fakultät'),
                       course('45', 'Psychology course', subject='Psychologie')]
            if joined:
                courses.append(course('43', 'Voluntary course', subject='Informatik'))
            body = dict(active_semester='HS2026', available_semesters=[], courses=courses, grouped_by_category={'Courses': courses})
        elif path.endswith('/membership'):
            if route.request.method == 'GET':
                action = parse_qs(url.query)['action'][0]
                fields = [dict(name='course_password', label='Course password', field_type='password', required=True, value=''),
                          dict(name='terms', label='Agree', field_type='checkbox', required=True, value='yes')] if action == 'join' else []
                body = dict(action=action, available=True, message='Registration details' if action == 'join' else 'Confirm leaving this course.', fields=fields, ilias_url='https://ilias.unibe.ch/go/crs/43')
            else:
                payload = route.request.post_data_json
                mutations.append(payload)
                if payload['action'] == 'join' and payload['values'].get('course_password') != 'correct':
                    route.fulfill(status=400, content_type='application/json', body=json.dumps(dict(detail='Wrong password')))
                    return
                joined = payload['action'] == 'join'
                body = dict(success=True, is_enrolled=joined, message='Joined.' if joined else 'Left.')
        elif path.endswith('/materials'):
            ref = path.split('/')[3]
            voluntary = ref == '43'
            title = 'Voluntary course' if voluntary else 'KSL course'
            membership = dict(is_enrolled=joined if voluntary else None, can_join=voluntary and not joined, can_leave=voluntary and joined)
            items = [dict(ref_id='50', title='Slides', item_type='fold', url='', properties={})] if joined and voluntary else []
            path_crumbs = crumbs + [dict(ref_id='44' if ref == '51' else ref, title=title)]
            if ref == '51':
                path_crumbs.append(dict(ref_id='51', title='Folder'))
            body = dict(container_ref_id=ref, title=title, is_enrolled=membership['is_enrolled'], membership=membership,
                        breadcrumbs=path_crumbs, items=items,
                        blocks=[dict(id='materials', block_type='items', items=items)] if items else [], sections=[], sessions=[], logs=[], rich_text_blocks=[])
        elif path.startswith('/api/repository/'):
            body = dict(container_ref_id='13', title='Vorlesung', breadcrumbs=crumbs, items=[
                dict(**course('43', 'Voluntary course'), accessible=True, properties={}, membership=dict(is_enrolled=joined, can_join=not joined, can_leave=joined)),
                dict(**course('44', 'KSL course'), accessible=True, properties={}, membership=dict(is_enrolled=None, can_join=False, can_leave=False)),
            ])
        else:
            body = dict(logs=[], total_pages=1, current_page=1)
        route.fulfill(status=200, content_type='application/json', body=json.dumps(body))

    try:
        with playwright.sync_playwright() as p:
            browser = p.chromium.launch(headless=True, channel=os.environ.get('BETTERILIAS_BROWSER_CHANNEL'))
            page = browser.new_page(locale='de-CH')
            errors = []
            page.on('pageerror', lambda err: errors.append(str(err)))
            page.route('**/api/**', respond)
            page.goto(base + '/?course=43')
            main = page.get_by_role('main')
            sidebar = page.locator('aside')
            playwright.expect(sidebar.get_by_role('button', name='KSL course', exact=True).locator('svg.lucide-scale')).to_be_visible()
            playwright.expect(sidebar.get_by_role('button', name='Psychology course', exact=True).locator('svg.lucide-brain')).to_be_visible()
            main.get_by_role('button', name='Kurs beitreten', exact=True).click()
            dialog = page.get_by_role('dialog')
            playwright.expect(dialog).to_contain_text('Registration details')
            dialog.get_by_label('Course password').fill('wrong')
            dialog.get_by_label('Agree').check()
            dialog.get_by_role('button', name='Kurs beitreten', exact=True).click()
            playwright.expect(dialog.get_by_role('alert')).to_have_text('Wrong password')
            dialog.get_by_label('Course password').fill('correct')
            dialog.get_by_role('button', name='Kurs beitreten', exact=True).click()
            playwright.expect(dialog).to_have_count(0)
            playwright.expect(main.get_by_role('button', name='Kurs verlassen', exact=True)).to_be_visible()
            playwright.expect(main.get_by_text('Slides', exact=True).first).to_be_visible()
            voluntary = sidebar.get_by_role('button', name='Voluntary course', exact=True)
            playwright.expect(voluntary.locator('svg.lucide-code')).to_be_visible()

            # Saving only a nickname must not freeze an automatic icon into an override.
            sidebar.get_by_role('button', name='Vorlesungen anpassen', exact=True).click()
            page.locator('#course-nickname-43').fill('My course')
            page.get_by_role('button', name='Änderungen speichern', exact=True).click()
            assert page.evaluate("JSON.parse(localStorage.getItem('ilias_course_icons') || '{}')['43'] || null") is None
            custom = sidebar.get_by_role('button', name='My course', exact=False)
            playwright.expect(custom.locator('svg.lucide-code')).to_be_visible()

            # Every automatic icon can also be selected explicitly, including the general book icon.
            sidebar.get_by_role('button', name='Vorlesungen anpassen', exact=True).click()
            row = page.locator('#course-nickname-43').locator('xpath=../..')
            row.get_by_role('button', name='Icon auswählen', exact=True).click()
            playwright.expect(row.get_by_role('button', name='Veterinärmedizin', exact=True)).to_be_visible()
            playwright.expect(row.get_by_role('button', name='Chemie', exact=True)).to_be_visible()
            row.get_by_role('button', name='Vorlesung / Allgemein', exact=True).click()
            page.get_by_role('button', name='Änderungen speichern', exact=True).click()
            playwright.expect(custom.locator('svg.lucide-book-open')).to_be_visible()
            page.reload()
            playwright.expect(sidebar.get_by_role('button', name='My course', exact=False).locator('svg.lucide-book-open')).to_be_visible()

            # Reset remains reversible until saved, then restores the subject default.
            sidebar.get_by_role('button', name='Vorlesungen anpassen', exact=True).click()
            row = page.locator('#course-nickname-43').locator('xpath=../..')
            row.get_by_role('button', name='Zurücksetzen', exact=True).click()
            page.get_by_role('button', name='Abbrechen', exact=True).click()
            playwright.expect(sidebar.get_by_role('button', name='My course', exact=False).locator('svg.lucide-book-open')).to_be_visible()
            sidebar.get_by_role('button', name='Vorlesungen anpassen', exact=True).click()
            row.get_by_role('button', name='Zurücksetzen', exact=True).click()
            page.get_by_role('button', name='Änderungen speichern', exact=True).click()
            playwright.expect(voluntary.locator('svg.lucide-code')).to_be_visible()

            main.get_by_role('button', name='Kurs verlassen', exact=True).click()
            dialog.get_by_role('button', name='Abbrechen', exact=True).click()
            assert len(mutations) == 2
            main.get_by_role('button', name='Kurs verlassen', exact=True).click()
            dialog.get_by_role('button', name='Kurs verlassen', exact=True).click()
            playwright.expect(page).to_have_url(base + '/?repository=13')
            playwright.expect(main.get_by_role('button', name='Kurs beitreten: Voluntary course', exact=True)).to_be_visible()
            playwright.expect(sidebar.get_by_role('button', name='Voluntary course', exact=True)).to_have_count(0)
            playwright.expect(main.get_by_text('Slides', exact=True)).to_have_count(0)
            sidebar.get_by_role('button', name='KSL course', exact=True).click()
            playwright.expect(main.get_by_role('heading', name='KSL course', exact=True)).to_be_visible()
            playwright.expect(main.get_by_role('button', name='Kurs beitreten', exact=True)).to_have_count(0)
            playwright.expect(main.get_by_role('button', name='Kurs verlassen', exact=True)).to_have_count(0)

            page.goto(base + '/?repository=13')
            playwright.expect(main.get_by_role('button', name='Voluntary course', exact=True).locator('svg.lucide-code')).to_be_visible()
            playwright.expect(main.get_by_role('button', name='Kurs beitreten: Voluntary course', exact=True)).to_be_visible()
            playwright.expect(main.get_by_role('button', name='Kurs beitreten: KSL course', exact=True)).to_have_count(0)
            # A managed course remains enrolled even though its root exposes no leave action.
            page.evaluate('localStorage.clear()')
            page.goto(base + '/?course=44&folder=51')
            page.wait_for_function("localStorage.getItem('ilias_materials_cache_44') !== null")
            playwright.expect(page.get_by_role('navigation', name='Navigationspfad', exact=True).get_by_role('button', name='HS2026', exact=True)).to_have_attribute('title', 'Meine Kurse im HS2026')
            assert not errors
            browser.close()
    finally:
        server.shutdown()
        server.server_close()
