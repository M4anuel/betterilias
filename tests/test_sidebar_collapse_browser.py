"""Track sidebar geometry throughout real CSS transitions, not only endpoints."""
import json
import os
from urllib.parse import urlparse

import pytest
from tests.test_localisation_browser import local_site, ROOT
from tests.test_mobile_refinement_browser import mock_api

pytestmark = pytest.mark.skipif(os.environ.get('BETTERILIAS_BROWSER_TESTS') != '1', reason='Opt-in Chromium checks')


def sidebar_response(route):
    if urlparse(route.request.url).path.endswith('/semesters'):
        courses = [dict(ref_id=ref, title=title, item_type='crs', url='', semester='HS2026', subject=subject)
            for ref, title, subject in [('42', '2414: Human Computer Interaction', 'Informatik'),
                                       ('43', 'Mathematics', 'Mathematik')]]
        route.fulfill(content_type='application/json', body=json.dumps(dict(active_semester='HS2026',
            available_semesters=[], courses=courses, grouped_by_category={'Informatik': courses[:1], 'Mathematik': courses[1:]})))
    else:
        mock_api(route)


@pytest.mark.parametrize('language,scheme', [('de', 'dark'), ('en', 'light')])
@pytest.mark.parametrize('custom', [False, True])
@pytest.mark.parametrize('height', [800, 390])
def test_sidebar_icons_and_rows_stay_fixed_through_collapse(local_site, language, scheme, custom, height):
    pw = pytest.importorskip('playwright.sync_api')
    tr = json.loads((ROOT / 'locales' / f'{language}.json').read_text(encoding='utf8')).__getitem__
    with pw.sync_playwright() as p:
        browser = p.chromium.launch(headless=True, channel=os.environ.get('BETTERILIAS_BROWSER_CHANNEL'))
        page = browser.new_page(viewport=dict(width=1280, height=height), color_scheme=scheme)
        page.add_init_script(f"localStorage.setItem('betterilias_language', '{language}');")
        if custom:
            page.add_init_script("""localStorage.setItem('ilias_sidebar_order_HS2026', JSON.stringify([
                {id:'first',type:'section',title:'My lectures'}, {id:'42',type:'course'},
                {id:'second',type:'section',title:'Other lectures'}, {id:'43',type:'course'}]));""")
        page.route('**/api/**', sidebar_response)
        page.goto(local_site + '/?semester=HS2026')
        sidebar = page.locator('aside')
        pw.expect(sidebar.locator('nav button')).to_have_count(6)
        page.wait_for_function('''() => new Set([...document.querySelectorAll('aside nav button:not([aria-current])')]
            .map(button => getComputedStyle(button).color)).size === 1''')
        # Unselected icons and labels all inherit the same primary foreground.
        colours = sidebar.locator('nav button:not([aria-current])').evaluate_all('''buttons => buttons.map(button => ({
            row:getComputedStyle(button).color, icon:getComputedStyle(button.querySelector('.sidebar-icon svg') || button.querySelector('.sidebar-icon')).color,
            label:getComputedStyle(button.querySelector('span:last-child')).color
        }))''')
        assert len({item['row'] for item in colours}) == 1
        assert all(item['row'] == item['icon'] == item['label'] for item in colours)
        for collapsing in [True, False, True, False]:
            frames = page.evaluate('''async collapsing => {
                const sidebar = document.querySelector('aside');
                const frames = [];
                const sample = () => ({width:sidebar.getBoundingClientRect().width,
                    header:sidebar.firstElementChild.getBoundingClientRect().height,
                    icons:[...sidebar.querySelectorAll('nav .sidebar-icon')].map(icon => {
                      const r=(icon.querySelector('svg') || icon).getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};
                    })});
                frames.push(sample());
                sidebar.querySelector('button').click();
                const started=performance.now();
                await new Promise(resolve => {
                    function tick() { frames.push(sample());
                        if(performance.now()-started<280) requestAnimationFrame(tick);else resolve(); }
                    requestAnimationFrame(tick);
                });
                return frames;
            }''', collapsing)
            assert abs(frames[-1]['width'] - (64 if collapsing else 256)) <= 1
            assert all(abs(frame['header'] - 56) <= 1 for frame in frames)
            for index in range(6):
                for axis in ['x', 'y']:
                    positions = [frame['icons'][index][axis] for frame in frames]
                    assert max(positions) - min(positions) <= 1, (index, axis, positions)
        assert sidebar.get_by_text(tr('Meine Vorlesungen'), exact=True).evaluate('e => e.scrollHeight <= e.clientHeight + 1')
        artifacts = ROOT / 'scratch' / 'sidebar-collapse-checks'
        artifacts.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(artifacts / f'{language}-{custom}-{height}-expanded.png'))
        sidebar.get_by_role('button', name=tr('Seitenleiste einklappen'), exact=True).click()
        pw.expect(sidebar).to_have_attribute('data-sidebar-collapsed', 'true')
        # Square hit areas and centered icons apply to every rail action.
        geometry = sidebar.locator('button').evaluate_all('''buttons => buttons.map(button => {
            const r=button.getBoundingClientRect(), i=button.querySelector('svg').getBoundingClientRect();
            const aside=button.closest('aside').getBoundingClientRect();
            return {w:r.width,h:r.height,dx:(i.x+i.width/2)-(r.x+r.width/2),
                dy:(i.y+i.height/2)-(r.y+r.height/2),rail:(r.x+r.width/2)-(aside.x+aside.width/2)};
        })''')
        assert all(abs(r['w']-44)<=1 and abs(r['h']-44)<=1 and abs(r['dx'])<=1 and abs(r['dy'])<=1 and abs(r['rail'])<=1 for r in geometry), geometry
        page.wait_for_timeout(250)
        page.screenshot(path=str(artifacts / f'{language}-{custom}-{height}-collapsed.png'))
        # The editor remains reachable by keyboard in the compact rail.
        sidebar.get_by_role('button', name=tr('Vorlesungen anpassen'), exact=True).focus()
        page.keyboard.press('Enter')
        pw.expect(page.locator('.app-overlay')).to_be_visible()
        browser.close()


@pytest.mark.parametrize('width,height', [(320, 740), (390, 844), (430, 900), (768, 1024), (844, 390)])
def test_sidebar_drawer_titles_and_rows_do_not_wrap(local_site, width, height):
    pw = pytest.importorskip('playwright.sync_api')
    with pw.sync_playwright() as p:
        browser = p.chromium.launch(headless=True, channel=os.environ.get('BETTERILIAS_BROWSER_CHANNEL'))
        page = browser.new_page(viewport=dict(width=width, height=height), locale='de-CH', color_scheme='dark')
        page.route('**/api/**', sidebar_response)
        page.goto(local_site + '/?semester=HS2026')
        page.get_by_role('button', name='Sidebar umschalten', exact=True).click()
        sidebar = page.locator('aside')
        pw.expect(sidebar).to_be_visible()
        pw.expect(sidebar.locator('nav button')).to_have_count(6)
        assert sidebar.get_by_text('Meine Vorlesungen', exact=True).evaluate('e => e.scrollHeight <= e.clientHeight + 1')
        assert sidebar.locator('nav button').evaluate_all('buttons => buttons.every(button => Math.abs(button.getBoundingClientRect().height-44)<1)')
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        artifacts = ROOT / 'scratch' / 'sidebar-collapse-checks'
        artifacts.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(artifacts / f'drawer-{width}-{height}.png'))
        page.keyboard.press('Escape')
        pw.expect(page.locator('#course-navigation')).not_to_be_visible()
        browser.close()
