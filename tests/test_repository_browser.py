"""Build frontend, then set BETTERILIAS_BROWSER_TESTS=1 to run browser checks.

Uses mocked authenticated API responses; never contacts the live ILIAS account.
"""
import json
import os
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

import pytest

pytestmark = pytest.mark.skipif(os.environ.get('BETTERILIAS_BROWSER_TESTS') != '1', reason='Opt-in browser checks require a frontend build and Chromium')


def test_repository_and_contextual_semester_navigation():
    playwright = pytest.importorskip('playwright.sync_api')
    dist = Path(__file__).resolve().parents[1] / 'frontend' / 'dist'
    assert (dist / 'index.html').exists(), 'Run npm run build in frontend first'
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(SimpleHTTPRequestHandler, directory=str(dist)))
    Thread(target=server.serve_forever, daemon=True).start()
    base = f'http://127.0.0.1:{server.server_port}'
    crumbs = [dict(ref_id=ref, title=title) for ref, title in [
        ('1', 'Repository'), ('10', 'Faculty'), ('11', 'Subject'), ('12', 'FS2020'), ('13', 'Vorlesung'),
    ]]
    visited_semesters = []
    held_repository = set()
    pending_repository = {}
    failed_repository = set()

    def item(ref, title, kind='cat', accessible=True):
        return dict(ref_id=ref, title=title, item_type=kind, accessible=accessible,
                    url=f'https://ilias.unibe.ch/go/{kind}/{ref}', properties={})

    nodes = {
        '1': ('Repository', [item('10', 'Faculty')], []),
        '10': ('Faculty', [item('11', 'Subject')], crumbs[:2]),
        '11': ('Subject', [item('12', 'FS2020')], crumbs[:3]),
        '12': ('FS2020', [item('13', 'Vorlesung')], crumbs[:4]),
        '13': ('Vorlesung', [item('42', 'Enrolled course', 'crs'), item('43', 'Preview course', 'crs'), item('44', 'Locked course', 'crs', False)], crumbs),
    }

    def respond(route):
        from urllib.parse import urlparse, parse_qs
        url = urlparse(route.request.url)
        path = url.path
        if path == '/api/auth/status':
            body = dict(authenticated=True, cookies_present=True)
        elif path == '/api/dashboard/semesters':
            semester = parse_qs(url.query).get('semester', ['HS2026'])[0]
            visited_semesters.append(semester)
            body = dict(active_semester=semester, available_semesters=[], courses=[], grouped_by_category={})
        elif path.startswith('/api/repository/'):
            ref = path.rsplit('/', 1)[1]
            if ref in held_repository:
                pending_repository[ref] = route
                return
            if ref in failed_repository:
                route.fulfill(status=503, content_type='application/json', body=json.dumps(dict(detail='Temporarily unavailable')))
                return
            title, items, breadcrumbs = nodes[ref]
            body = dict(container_ref_id=ref, title=title, items=items, breadcrumbs=breadcrumbs)
        elif path.endswith('/materials'):
            ref = path.split('/')[3]
            course = '43' if ref == '43' else '42'
            title = 'Preview course' if course == '43' else 'Enrolled course'
            breadcrumbs = crumbs + [dict(ref_id=course, title=title)]
            if ref == '50':
                breadcrumbs += [dict(ref_id='50', title='Slides')]
            body = dict(container_ref_id=ref, title='Slides' if ref == '50' else title,
                        is_enrolled=True if course == '42' and ref == '42' else None,
                        breadcrumbs=breadcrumbs, items=[item('50', 'Slides', 'fold')] if ref != '50' else [],
                        sections=[], blocks=[], sessions=[], logs=[], rich_text_blocks=[], fetched_at='2026-10-23T12:00:00Z')
        else:
            body = dict(logs=[], total_pages=1, current_page=1)
        route.fulfill(status=200, content_type='application/json', body=json.dumps(body))

    try:
        with playwright.sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            page = browser.new_page()
            errors = []
            page.on('pageerror', lambda err: errors.append(str(err)))
            page.route('**/api/**', respond)
            page.goto(base + '/?semester=HS2026')
            page.get_by_role('button', name='Magazin', exact=True).click()
            for title in ['Faculty', 'Subject', 'FS2020', 'Vorlesung']:
                page.get_by_role('button', name=title, exact=True).click()
            playwright.expect(page.get_by_role('button', name='Locked course', exact=False)).to_be_disabled()
            page.get_by_role('button', name='Preview course', exact=True).click()
            breadcrumb = page.get_by_role('navigation', name='Breadcrumb', exact=True)
            breadcrumb.get_by_role('button', name='FS2020', exact=True).click()
            playwright.expect(page).to_have_url(base + '/?repository=12')
            page.go_back()
            playwright.expect(breadcrumb.get_by_role('button', name='Preview course', exact=True)).to_be_visible()
            page.go_forward()
            playwright.expect(page).to_have_url(base + '/?repository=12')
            page.go_back()
            playwright.expect(breadcrumb.get_by_role('button', name='Preview course', exact=True)).to_be_visible()
            page.go_back()
            page.get_by_role('button', name='Enrolled course', exact=True).click()
            playwright.expect(breadcrumb.get_by_role('button', name='FS2020', exact=True)).to_have_attribute('title', 'Meine Kurse im FS2020')
            playwright.expect(breadcrumb.get_by_role('button', name='Faculty', exact=True)).to_have_count(0)
            breadcrumb.get_by_role('button', name='Vollständigen Pfad anzeigen').click()
            playwright.expect(breadcrumb.get_by_role('button', name='Faculty', exact=True)).to_be_visible()
            page.reload()
            playwright.expect(breadcrumb.get_by_role('button', name='Vollständigen Pfad anzeigen')).to_be_visible()
            breadcrumb.get_by_role('button', name='Vollständigen Pfad anzeigen').click()
            breadcrumb.get_by_role('button', name='Faculty', exact=True).click()
            playwright.expect(page).to_have_url(base + '/?repository=10')
            page.go_back()
            breadcrumb.get_by_role('button', name='FS2020', exact=True).click()
            playwright.expect(page).to_have_url(base + '/?semester=FS2020')
            playwright.expect(page.locator('select')).to_have_value('FS2020')
            assert 'FS2020' in visited_semesters
            # Direct folder URLs resolve enrollment from the course root.
            page.evaluate('localStorage.clear()')
            page.goto(base + '/?course=42&folder=50')
            playwright.expect(breadcrumb.get_by_role('button', name='FS2020', exact=True)).to_have_attribute('title', 'Meine Kurse im FS2020')
            breadcrumb.get_by_role('button', name='Enrolled course', exact=True).click()
            playwright.expect(page).to_have_url(base + '/?course=42')
            # A repository deep link must override the last-opened course cache.
            page.goto(base + '/?repository=11')
            playwright.expect(page.get_by_role('heading', name='Subject', exact=True)).to_be_visible()
            page.reload()
            playwright.expect(page.get_by_role('heading', name='Subject', exact=True)).to_be_visible()

            # An uncached child already has a title and a usable path from its parent.
            page.evaluate('localStorage.clear()')
            page.goto(base + '/?repository=1')
            held_repository.add('10')
            with page.expect_request('**/api/repository/10'):
                page.get_by_role('button', name='Faculty', exact=True).click()
            path = page.get_by_role('navigation', name='Magazin-Pfad', exact=True)
            playwright.expect(page.get_by_role('heading', name='Faculty', exact=True)).to_be_visible()
            playwright.expect(path.get_by_role('button', name='Faculty', exact=True)).to_be_visible()
            playwright.expect(page.get_by_role('heading', name='Magazin', exact=True)).to_have_count(0)
            # Navigate away while the child is pending; its late response must not replace the root.
            path.get_by_role('button', name='Magazin öffnen', exact=True).click()
            held_repository.remove('10')
            respond(pending_repository.pop('10'))
            playwright.expect(page.get_by_role('heading', name='Repository', exact=True)).to_be_visible()
            page.get_by_role('button', name='Faculty', exact=True).click()
            playwright.expect(page.get_by_role('button', name='Subject', exact=True)).to_be_visible()

            # A failed background refresh keeps the cached listing, heading and breadcrumbs.
            failed_repository.add('10')
            page.get_by_role('button', name='Magazin aktualisieren', exact=True).click()
            playwright.expect(page.get_by_role('alert')).to_contain_text('Temporarily unavailable')
            playwright.expect(page.get_by_role('button', name='Subject', exact=True)).to_be_visible()
            playwright.expect(path.get_by_role('button', name='Faculty', exact=True)).to_be_visible()
            page.reload()
            playwright.expect(page.get_by_role('alert')).to_be_visible()
            playwright.expect(page.get_by_role('heading', name='Faculty', exact=True)).to_be_visible()
            playwright.expect(page.get_by_role('button', name='Subject', exact=True)).to_be_visible()
            failed_repository.clear()

            # Course ancestors also supply context before that repository page has been fetched.
            page.evaluate('localStorage.clear()')
            page.goto(base + '/?course=42')
            breadcrumb.get_by_role('button', name='Vollständigen Pfad anzeigen').click()
            held_repository.add('11')
            with page.expect_request('**/api/repository/11'):
                breadcrumb.get_by_role('button', name='Subject', exact=True).click()
            playwright.expect(page.get_by_role('heading', name='Subject', exact=True)).to_be_visible()
            playwright.expect(path.get_by_role('button', name='Faculty', exact=True)).to_be_visible()
            held_repository.remove('11')
            respond(pending_repository.pop('11'))
            playwright.expect(page.get_by_role('button', name='FS2020', exact=True)).to_be_visible()
            assert not errors
            browser.close()
    finally:
        server.shutdown()
        server.server_close()
