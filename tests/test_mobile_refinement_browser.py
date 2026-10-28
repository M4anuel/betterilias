"""Compact mobile chrome, control geometry and drafts during parent refreshes."""
import json
import os
from urllib.parse import urlparse

import pytest
from tests.test_localisation_browser import local_site, ROOT

pytestmark = pytest.mark.skipif(os.environ.get('BETTERILIAS_BROWSER_TESTS') != '1', reason='Opt-in browser tests')


def mock_api(route):
    path = urlparse(route.request.url).path
    course = dict(ref_id='42', title='2414-HS2026-0: Human Computer Interaction', item_type='crs', url='', semester='HS2026', subject='Informatik')
    file = dict(ref_id='90', title='Lecture notes.pdf', item_type='file', url='', file_size='1.2 MB', properties={})
    folders = [dict(ref_id='51', title='Folder one', item_type='fold', url='', properties={}),
               dict(ref_id='52', title='Folder two', item_type='fold', url='', properties={})]
    if path.endswith('/status'):
        data = dict(authenticated=True, cookies_present=True, user_name='Test Student')
    elif path.endswith('/semesters'):
        data = dict(active_semester='HS2026', available_semesters=[], courses=[course], grouped_by_category={'Informatik': [course]})
    elif path.endswith('/materials'):
        ref = path.split('/')[3]
        authoring = dict(ref_id=ref, can_manage=True, can_create=True, creatable_types=['file', 'fold'])
        # Exercise all-folder, mixed row and tile render paths, including nested folders.
        items = folders if ref == '42' else [dict(folders[1], ref_id='53', title='Nested folder'), file]
        session = dict(ref_id='70', title='Session one', materials=[file], is_past=False)
        data = dict(container_ref_id=ref, title=course['title'] if ref == '42' else 'Folder one', is_enrolled=True,
                    authoring=authoring, items=items, sections=[], sessions=[session] if ref == '42' else [], logs=[], rich_text_blocks=[],
                    breadcrumbs=[dict(ref_id='42', title=course['title'])] + ([dict(ref_id=ref, title='Folder one')] if ref != '42' else []),
                    blocks=[dict(id='folders', block_type='items', title='Materials', items=items),
                            dict(id='tiles', block_type='items', presentation='tiles', items=[dict(folders[0], ref_id='54', title='Image folder')])] if ref == '42' else [dict(id='nested', block_type='items', items=items)])
        if ref == '42':
            data['blocks'].append(dict(id='sessions', block_type='sessions', sessions=[session]))
    elif path.endswith('/overview'):
        data = dict(exercise_ref_id='200', title='Exercises', has_ta_access=True, breadcrumbs=[], assignments=[
            dict(ass_id='20', title='Assignment one', url='', is_ongoing=True, is_ended=False, properties={})])
    elif path.endswith('/submissions'):
        data = dict(exercise=dict(ref_id='200', title='Exercises', total_participants=1, submitted_count=1, graded_count=0),
                    active_assignment_id='20', available_assignments=[dict(ass_id='20', title='Assignment one', url='#')],
                    submissions=[dict(member_id='1', student_name='Student, Test', submission_status='submitted', files=[])])
    elif path.endswith('/assignment/20'):
        data = dict(exercise_ref_id='200', ass_id='20', title='Assignment one', is_ended=False, is_team_upload=True,
                    team_members=['Test Student'], team_member_details=[], exercise_files=[], submitted_files=[],
                    manage_team_url='https://ilias.unibe.ch/team', delete_team_url='https://ilias.unibe.ch/delete')
    else:
        data = {}
    route.fulfill(status=200, content_type='application/json', body=json.dumps(data))


def assert_no_overflow(page):
    assert page.locator('main').evaluate('e => e.scrollWidth <= e.clientWidth + 1')
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')


@pytest.mark.parametrize('language,scheme', [('de', 'dark'), ('en', 'light')])
@pytest.mark.parametrize('width', [320, 430])
def test_compact_settings_semesters_materials_and_exercises(local_site, language, scheme, width):
    pw = pytest.importorskip('playwright.sync_api')
    tr = json.loads((ROOT / 'locales' / f'{language}.json').read_text(encoding='utf8')).__getitem__
    with pw.sync_playwright() as p:
        browser = p.chromium.launch(headless=True, channel=os.environ.get('BETTERILIAS_BROWSER_CHANNEL'))
        page = browser.new_page(viewport=dict(width=width, height=740), is_mobile=True, has_touch=True, color_scheme=scheme)
        page.set_default_timeout(10000)
        page.add_init_script(f"localStorage.setItem('betterilias_language', '{language}');")
        page.route('**/api/**', mock_api)
        page.goto(local_site + '/?semester=HS2026')
        semester = page.get_by_role('combobox', name=tr('semester.choose'))
        semester.select_option('FS2023')
        assert_no_overflow(page)
        assert all(len(text) < 12 for text in semester.locator('option').all_text_contents())
        gear = page.get_by_role('button', name=tr('Design & Einstellungen'), exact=True)
        assert page.locator('button:has(> svg:only-child):visible').evaluate_all("""buttons => buttons.every(button => {
            const a = button.getBoundingClientRect(), b = button.querySelector('svg').getBoundingClientRect();
            return Math.abs((a.left + a.right) / 2 - (b.left + b.right) / 2) < 1 &&
                   Math.abs((a.top + a.bottom) / 2 - (b.top + b.bottom) / 2) < 1;
        })""")
        gear.click()
        settings = page.get_by_role('dialog', name=tr('Einstellungen & Design'))
        pw.expect(settings).to_be_visible()
        rect = settings.bounding_box()
        assert abs(rect['width'] - width) < 1 and abs(rect['height'] - 740) < 1
        switch = settings.get_by_role('switch')
        track = switch.locator('> span').bounding_box()
        assert track['width'] > track['height'] * 1.5
        settings.evaluate('e => e.scrollTop = e.scrollHeight')
        pw.expect(settings.get_by_role('button', name=tr('Design & Einstellungen'), exact=True)).to_be_in_viewport()
        settings.get_by_role('button', name=tr('Design & Einstellungen'), exact=True).click()
        pw.expect(settings).to_have_count(0)
        gear.click()
        page.keyboard.press('Escape')
        pw.expect(gear).to_be_focused()

        page.goto(local_site + '/?course=42')
        pw.expect(page.get_by_role('heading', name='Human Computer Interaction', exact=True)).to_be_visible()
        root = page.locator('[data-mobile-folder]').filter(has_text='Folder one')
        tile = page.locator('[data-mobile-folder]').filter(has_text='Image folder')
        pw.expect(root).to_be_visible()
        assert root.bounding_box()['height'] <= 68 and tile.bounding_box()['height'] <= 68
        pw.expect(page.get_by_role('button', name=tr('Alle ausklappen'), exact=True)).to_be_hidden()
        root.click()
        nested = page.locator('[data-mobile-folder]').filter(has_text='Nested folder')
        pw.expect(nested).to_be_visible()
        assert nested.bounding_box()['height'] <= 68
        download = page.get_by_role('link', name=tr('Download'), exact=True)
        pw.expect(download).to_be_visible()
        assert download.bounding_box()['width'] <= 48
        pw.expect(page.get_by_text('1.2 MB', exact=True)).to_be_hidden()
        assert_no_overflow(page)
        page.screenshot(path=f'.pytest_cache/refined-course-{width}-{language}.png')

        page.goto(local_site + '/?course=42&exercise=200')
        views = page.get_by_role('combobox', name=tr('mobile.exercise_view'))
        pw.expect(views).to_be_visible()
        title = page.get_by_role('heading', name='Exercises', exact=True).bounding_box()
        assert abs(title['y'] - views.bounding_box()['y']) < 44
        filters = page.locator('.single-row-filters').first
        assert filters.evaluate('e => e.scrollHeight <= e.clientHeight + 1')
        page.get_by_role('button', name=tr('Details & Abgabe'), exact=False).click()
        team = page.locator('.team-actions')
        pw.expect(team).to_be_visible()
        actions = team.locator('button').all()
        assert len(actions) == 2
        assert abs(actions[0].bounding_box()['y'] - actions[1].bounding_box()['y']) < 1
        pw.expect(page.get_by_text(tr('Drücke Esc zum Schließen'), exact=True)).to_be_hidden()
        page.keyboard.press('Escape')
        views.select_option('submissions')
        pw.expect(page.get_by_text('Student, Test', exact=True)).to_be_visible()
        toolbar = page.locator('.grading-toolbar')
        assert toolbar.bounding_box()['height'] <= 140
        page.get_by_title(tr('Filter-, Sortier- & Kursansicht-Einstellungen öffnen'), exact=True).click()
        grading = page.get_by_role('dialog', name=tr('Filter- & Anzeige-Einstellungen'))
        pw.expect(grading.get_by_role('heading', name=tr('mobile.submission_filters'))).to_be_visible()
        pw.expect(grading.get_by_role('button', name=tr('Kommentar'), exact=True)).to_be_visible()
        assert grading.evaluate('e => e.scrollWidth <= e.clientWidth + 1')
        track = grading.get_by_role('switch').locator('> span').bounding_box()
        assert track['width'] > track['height'] * 1.5
        page.screenshot(path=f'.pytest_cache/refined-grading-{width}-{language}.png')
        browser.close()


@pytest.mark.parametrize('language', ['de', 'en'])
def test_sidebar_draft_survives_parent_refresh_and_last_section_restores_subjects(local_site, language):
    pw = pytest.importorskip('playwright.sync_api')
    tr = json.loads((ROOT / 'locales' / f'{language}.json').read_text(encoding='utf8')).__getitem__
    with pw.sync_playwright() as p:
        browser = p.chromium.launch(headless=True, channel=os.environ.get('BETTERILIAS_BROWSER_CHANNEL'))
        page = browser.new_page(viewport=dict(width=320, height=740))
        page.set_default_timeout(10000)
        page.add_init_script(f"""localStorage.setItem('betterilias_language', '{language}');
            localStorage.setItem('ilias_sidebar_order', JSON.stringify([
                {{id:'section-one',type:'section',title:'Original section'}},{{id:'42',type:'course'}}]));""")
        page.route('**/api/**', mock_api)
        page.goto(local_site + '/?semester=HS2026')
        toggle = page.get_by_role('button', name=tr('Sidebar umschalten'), exact=True)
        toggle.click()
        page.get_by_role('button', name=tr('Vorlesungen anpassen'), exact=True).click()
        editor = page.locator('.app-overlay')
        pw.expect(editor.get_by_text('Human Computer Interaction', exact=True)).to_be_visible()
        assert editor.locator('.sidebar-course-title').evaluate('e => e.clientWidth > 180 && e.scrollHeight <= e.clientHeight + 1')
        pw.expect(editor.get_by_role('button', name=tr('+ TA (Teaching Assistant)'), exact=True)).to_have_count(0)
        editor.get_by_placeholder(tr('Abschnittsname'), exact=True).fill('Draft section')
        # The real focus event refreshes auth and rerenders App/courses.
        page.evaluate("window.dispatchEvent(new Event('focus'))")
        page.wait_for_timeout(750)
        pw.expect(editor.get_by_placeholder(tr('Abschnittsname'), exact=True)).to_have_value('Draft section')
        editor.get_by_role('button', name=tr('Abschnitt hinzuf\u00fcgen'), exact=True).click()
        editor.get_by_placeholder(tr('Abschnittsname'), exact=True).first.fill('Added section')
        page.evaluate("window.dispatchEvent(new Event('focus'))")
        page.wait_for_timeout(750)
        assert editor.get_by_placeholder(tr('Abschnittsname'), exact=True).evaluate_all('fields => fields.map(field => field.value)') == ['Added section', 'Draft section']
        editor.get_by_role('button', name=tr('Abschnitt entfernen'), exact=True).first.click()
        editor.get_by_role('button', name=tr('Abschnitt entfernen'), exact=True).first.click()
        page.evaluate("window.dispatchEvent(new Event('focus'))")
        page.wait_for_timeout(750)
        pw.expect(editor.get_by_placeholder(tr('Abschnittsname'), exact=True)).to_have_count(0)
        editor.get_by_role('button', name=tr('Änderungen speichern'), exact=True).click()
        toggle.click()
        drawer = page.get_by_role('dialog', name=tr('Meine Vorlesungen'))
        pw.expect(drawer.get_by_text('Informatik', exact=True)).to_be_visible()
        pw.expect(drawer.get_by_text('Original section', exact=True)).to_have_count(0)
        browser.close()


def test_desktop_settings_gear_toggles_and_rotates(local_site):
    pw = pytest.importorskip('playwright.sync_api')
    with pw.sync_playwright() as p:
        browser = p.chromium.launch(headless=True, channel=os.environ.get('BETTERILIAS_BROWSER_CHANNEL'))
        page = browser.new_page(viewport=dict(width=1280, height=800))
        page.add_init_script("localStorage.setItem('betterilias_language', 'en')")
        page.route('**/api/**', mock_api)
        page.goto(local_site + '/?semester=HS2026')
        gear = page.get_by_role('button', name='Appearance & settings', exact=True)
        gear.click()
        pw.expect(page.get_by_role('dialog', name='Settings & appearance')).to_be_visible()
        assert gear.locator('svg').evaluate('e => e.style.transform') == 'rotate(180deg)'
        gear.click()
        pw.expect(page.get_by_role('dialog')).to_have_count(0)
        assert gear.locator('svg').evaluate('e => e.style.transform') == 'rotate(360deg)'
        browser.close()
