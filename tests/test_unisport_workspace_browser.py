"""Test the four Unisport views together using the browser fixture and synthetic data."""
import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlsplit

import pytest

from tests.test_state_machine_browser import workflow_site, workflow_browser, workflow_page, language
from tests.test_unisport_catalogue_browser import offer

pytestmark = pytest.mark.skipif(os.environ.get('BETTERILIAS_BROWSER_TESTS') != '1', reason='Opt-in Chromium emulation')
ROOT = Path(__file__).resolve().parents[1]


@pytest.mark.parametrize('width,height', [(320, 740), (390, 844), (430, 844), (768, 850), (1280, 900), (844, 390)])
@pytest.mark.parametrize('code,scheme', [('en', 'light'), ('de', 'dark')])
def test_explore_schedule_conflicts_and_opening_reminders(workflow_page, width, height, code, scheme):
    page = workflow_page
    page.set_viewport_size({'width': width, 'height': height})
    tr = language(page, code, scheme)
    screenshots = ROOT / 'scratch' / 'unisport-redesign-checks'
    screenshots.mkdir(parents=True, exist_ok=True)
    now = datetime.now(timezone.utc)
    start = (now + timedelta(days=2)).replace(hour=17, minute=30, second=0, microsecond=0)
    end = start + timedelta(minutes=75)
    reg_open = (now + timedelta(minutes=5)).isoformat()
    registered = {**offer(), 'title': 'Volley evening', 'sport': 'Volleyball',
                  'begin': start.isoformat(), 'end': end.isoformat(), 'registration_state': 1, 'opens': ''}
    opening = {**offer(2), 'title': 'Flow training', 'sport': 'Yoga', 'opens': reg_open,
               'begin': (start + timedelta(hours=2)).isoformat(), 'end': (end + timedelta(hours=2)).isoformat(),
               'registration_state': 2, 'offer_type': 'training'}
    drop_in = {**offer(3), 'title': 'Drop-in climbing', 'sport': 'Climbing', 'opens': '',
               'begin': (start - timedelta(hours=3)).isoformat(), 'end': (end - timedelta(hours=3)).isoformat(),
               'registration_state': 7, 'offer_type': 'training'}
    application = {**registered, 'status': 8, 'registration': 'Confirmed by provider'}

    def mock(route):
        path = urlsplit(route.request.url).path
        assert route.request.method == 'GET'
        if path.endswith('/connection'):
            data = {'phase': 'connected', 'affiliation': 'student', 'scope': 'a' * 64}
        elif path.endswith('/catalogue'):
            data = {'items': [registered, opening, drop_in], 'sports': ['Volleyball', 'Yoga', 'Climbing'],
                    'fetched_at': now.timestamp(), 'stale': False}
        elif path.endswith('/applications'):
            data = {'items': [application], 'fetched_at': now.timestamp()}
        elif path.endswith('/bookmarks'):
            data = {'items': []}
        elif path.endswith('/calendar'):
            assert route.request.headers.get('x-session-id') == 's' * 43
            data = {'events': [{'uid': 'lecture-1', 'title': 'Applied statistics', 'kind': 'lecture',
                                'start_iso': (start - timedelta(minutes=15)).isoformat(),
                                'end_iso': (start + timedelta(minutes=45)).isoformat()}]}
        else:
            raise AssertionError(path)
        route.fulfill(content_type='application/json', body=json.dumps(data))

    page.route('**/api/unisport/**', mock)
    page.route('**/api/calendar?**', mock)
    page.evaluate('''async () => {
      localStorage.setItem('betterilias_session_id', 's'.repeat(43));
      const {UnisportView} = await import('/src/components/UnisportView.tsx');
      mountAudit(UnisportView, {});
    }''')
    nav = page.get_by_role('navigation', name=tr['unisport.title'])
    page.get_by_role('heading', name='Volley evening').wait_for()
    page.get_by_role('timer').wait_for()
    page.get_by_role('button', name=tr['unisport.save_reminder'], exact=True).click()

    nav.get_by_role('button', name=tr['unisport.explore'], exact=True).click()
    category = page.get_by_label(tr['unisport.sport_category'], exact=True)
    category.select_option('wellbeing')
    assert not page.get_by_role('button', name='Volleyball', exact=True).is_visible()
    page.get_by_role('button', name=tr['unisport.favourite_named'].format(name='Yoga'), exact=True).click()

    nav.get_by_role('button', name=tr['unisport.schedule'], exact=True).click()
    date = page.get_by_label(tr['unisport.date'], exact=True)
    if not date.input_value() == start.date().isoformat():
        date.fill(start.date().isoformat())
    page.get_by_role('heading', name='Drop-in climbing').wait_for()
    page.get_by_role('button', name=tr['unisport.state_drop_in'], exact=True).click()
    assert not page.get_by_role('heading', name='Volley evening').is_visible()
    page.get_by_role('button', name=tr['unisport.state_drop_in'], exact=True).click()
    page.get_by_role('button', name=tr['unisport.show_timetable'], exact=True).click()
    page.get_by_text(tr['unisport.timetable_conflict'], exact=True).wait_for()
    page.get_by_role('heading', name=tr['unisport.schedule'], exact=True).scroll_into_view_if_needed()
    page.screenshot(path=str(screenshots / f'agenda-{width}-{height}-{code}-{scheme}.png'))
    page.get_by_role('button', name=tr['unisport.week'], exact=True).click()
    week = page.get_by_role('region', name=tr['unisport.week'])
    week.get_by_text('Applied statistics', exact=True).wait_for()
    week.get_by_text('Volley evening', exact=False).first.wait_for()
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    assert page.evaluate('document.documentElement.scrollHeight <= innerHeight')
    page.screenshot(path=str(screenshots / f'week-{width}-{height}-{code}-{scheme}.png'))

    nav.get_by_role('button', name=tr['unisport.my_sport'], exact=True).click()
    page.get_by_role('heading', name='Flow training').wait_for()
    page.get_by_role('button', name='Yoga', exact=True).wait_for()
    with page.expect_download() as event:
        page.get_by_role('button', name=tr['unisport.add_calendar'], exact=True).click()
    calendar = Path(event.value.path()).read_text(encoding='utf-8')
    assert 'BEGIN:VALARM' in calendar and 'TRIGGER:-PT5M' in calendar and 'Flow training' in calendar
