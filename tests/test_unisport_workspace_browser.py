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
    reg_open = (start - timedelta(days=1, hours=3)).isoformat()
    registered = {**offer(), 'title': 'Volley evening', 'sport': 'Volleyball',
                  'begin': start.isoformat(), 'end': end.isoformat(), 'registration_state': 1, 'opens': ''}
    opening = {**offer(2), 'title': 'Flow training', 'sport': 'Yoga', 'opens': reg_open,
               'closes': (start + timedelta(hours=1)).isoformat(),
               'level': 'N2–N4', 'free_places': '1 place',
               'begin': (start + timedelta(hours=2)).isoformat(), 'end': (end + timedelta(hours=2)).isoformat(),
               'registration_state': 2, 'offer_type': 'training'}
    drop_in = {**offer(3), 'title': 'Drop-in climbing', 'sport': 'Climbing', 'opens': '',
               'begin': (start - timedelta(hours=3)).isoformat(), 'end': (end - timedelta(hours=3)).isoformat(),
               'registration_state': 7, 'offer_type': 'training'}
    full = {**offer(4), 'title': 'Full workshop', 'sport': 'Yoga', 'opens': reg_open,
            'begin': (start + timedelta(days=1)).isoformat(), 'end': (end + timedelta(days=1)).isoformat(),
            'closes': end.isoformat(), 'registration_state': 2, 'offer_type': 'dated', 'free_places': '0'}
    tennis_title = 'Tennis Freies Spiel' if code == 'de' else 'Tennis Individual game'
    tennis = {**offer(5), 'title': tennis_title, 'sport': 'Tennis', 'opens': '', 'offer_type': 'dated',
              'begin': (start - timedelta(hours=6)).isoformat(), 'end': (start - timedelta(hours=5)).isoformat(),
              'registration_state': 6, 'free_places': 'Ausgebucht' if code == 'de' else 'Fully booked'}
    next_tennis = {**tennis, 'id': 6, 'begin': (start + timedelta(days=7)).isoformat(),
                   'end': (end + timedelta(days=7)).isoformat(), 'free_places': '1 freie Platz',
                   'registration_state': 1}
    open_tennis = {**next_tennis, 'id': 7}
    application = {**registered, 'status': 8, 'registration': 'Confirmed by provider'}
    tennis_applications = [{**tennis, 'status': 8}, {**tennis, 'id': 6, 'status': 8, 'freePlaces': '0',
                           'begin': (start - timedelta(hours=5)).isoformat(),
                           'end': (start - timedelta(hours=4)).isoformat()}]

    def mock(route):
        path = urlsplit(route.request.url).path
        assert route.request.method == 'GET'
        if path.endswith('/connection'):
            data = {'phase': 'connected', 'affiliation': 'student', 'scope': 'a' * 64}
        elif path.endswith('/catalogue'):
            data = {'items': [registered, opening, drop_in, full, tennis, next_tennis, open_tennis],
                    'sports': ['Volleyball', 'Yoga', 'Climbing', 'Tennis'],
                    'fetched_at': now.timestamp(), 'stale': False}
        elif path.endswith('/applications'):
            data = {'items': [application, *tennis_applications], 'fetched_at': now.timestamp()}
        elif path.endswith('/offers/2'):
            data = {'offer': opening, 'fetched_at': now.timestamp()}
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
    opening_card = page.get_by_role('article', name='Flow training', exact=True)
    opening_card.get_by_text(tr['unisport.card_type_daily'], exact=True).wait_for()
    opening_card.get_by_text(tr['unisport.card_one_place'], exact=True).wait_for()
    assert not opening_card.get_by_text(tr['unisport.card_opening_later'], exact=True).is_visible()
    assert opening_card.get_by_text(tr['unisport.registration_closes'].split('{time}')[0], exact=False).count() == 0
    tennis_cards = page.get_by_role('article', name=tennis_title, exact=True)
    assert tennis_cards.count() == 4  # Two booked occurrences and two open slots.
    for card in tennis_cards.all():
        card.get_by_text(tr['unisport.card_type_daily'], exact=True).wait_for()
        if card.get_by_role('button', name=tr['unisport.card_cancel'], exact=True).is_visible():
            assert card.get_by_text(tr['unisport.card_capacity_full'], exact=True).is_visible()
            assert card.get_attribute('data-registration') == 'registered'
        else:
            assert card.get_by_text(tr['unisport.card_one_place'], exact=True).is_visible()
            assert not card.get_by_text(tr['unisport.state_available'], exact=True).is_visible()
            assert card.get_attribute('data-registration') == 'open'
    full_card = page.get_by_role('article', name='Full workshop', exact=True)
    full_card.get_by_text(tr['unisport.card_capacity_full'], exact=True).wait_for()
    assert full_card.get_by_role('button', name=tr['unisport.card_register'], exact=True).is_disabled()
    opens_y = full_card.get_by_text(tr['unisport.registration_opens'].split('{time}')[0], exact=False).bounding_box()['y']
    closes_y = full_card.get_by_text(tr['unisport.registration_closes'].split('{time}')[0], exact=False).bounding_box()['y']
    assert (opens_y == closes_y) if width >= 1024 else (opens_y < closes_y)
    assert opening_card.get_by_text('N2–N4', exact=True).locator('span[style]').count() == 3
    auto = opening_card.get_by_role('button', name=tr['unisport.autosign_in'], exact=True)
    assert not auto.is_visible()
    page.evaluate("""async () => {
        const {cache} = await import('/src/lib/cache.ts');
        window.toggleAutoSignIn = enabled => cache.setUnisportAutoSignInEnabled(enabled);
        toggleAutoSignIn(true);
    }""")
    auto.focus()
    page.keyboard.press('Space')
    assert auto.get_attribute('aria-pressed') == 'true'
    auto.locator('.unisport-autosign-check').wait_for()
    once_label = f"{tr['unisport.autosign_preview']} · {tr['unisport.autosign_once']}"
    weekly_label = f"{tr['unisport.autosign_preview']} · {tr['unisport.autosign_weekly']}"
    assert auto.get_by_text(once_label, exact=True).is_visible()
    page.evaluate('toggleAutoSignIn(false)')
    assert not auto.is_visible()
    page.evaluate('toggleAutoSignIn(true)')
    assert auto.get_attribute('aria-pressed') == 'true'
    favourite = opening_card.get_by_role('button', name=tr['unisport.favourite_named'].format(name='Flow training'), exact=True)
    favourite.click()
    assert favourite.get_attribute('aria-pressed') == 'true'
    assert auto.get_by_text(weekly_label, exact=True).is_visible()
    auto.click()
    auto.click()
    assert auto.get_by_text(weekly_label, exact=True).is_visible()
    favourite.click()
    assert auto.get_by_text(once_label, exact=True).is_visible()
    favourite.click()
    register = opening_card.get_by_role('button', name=tr['unisport.card_register'], exact=True)
    register.click()
    dialog = page.get_by_role('dialog')
    dialog.get_by_text(tr['unisport.card_reminder_question'], exact=True).wait_for()
    dialog.get_by_role('button', name=tr['unisport.save_reminder'], exact=True).click()
    assert register.evaluate('(button) => button === document.activeElement')
    page.screenshot(path=str(screenshots / f'cards-{width}-{height}-{code}-{scheme}.png'))

    # Click non-interactive card content instead of the title.
    capacity = opening_card.get_by_text(tr['unisport.card_one_place'], exact=True)
    capacity.scroll_into_view_if_needed()
    box = capacity.bounding_box()
    page.mouse.click(box['x'] + box['width'] / 2, box['y'] + box['height'] / 2)
    details = page.get_by_role('dialog', name='Flow training')
    details.get_by_role('button', name=tr['unisport.card_register'], exact=True).wait_for()
    assert details.get_by_role('button', name=tr['unisport.autosign_in'], exact=True).get_attribute('aria-pressed') == 'true'
    assert details.get_by_role('button', name=tr['unisport.favourite_named'].format(name='Flow training')).get_attribute('aria-pressed') == 'true'
    page.screenshot(path=str(screenshots / f'offer-dialog-{width}-{height}-{code}-{scheme}.png'))
    page.keyboard.press('Escape')
    details.wait_for(state='hidden')
    sport_link = opening_card.get_by_role('link', name='Yoga', exact=True)
    assert 'sportView=explore&sport=Yoga' in sport_link.get_attribute('href')
    sport_link.click()
    page.get_by_role('heading', name='Yoga', exact=True).wait_for()
    assert nav.get_by_role('button', name=tr['unisport.explore'], exact=True).get_attribute('aria-current') == 'page'
    page.get_by_role('button', name=tr['unisport.back_to_sports'], exact=True).click()
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
    page.get_by_role('article', name='Flow training', exact=True).get_by_role('button', name=tr['unisport.autosign_in'], exact=True).wait_for()
    page.get_by_role('listitem').get_by_role('button', name='Yoga', exact=True).wait_for()
    with page.expect_download() as event:
        page.get_by_role('button', name=tr['unisport.add_calendar'], exact=True).click()
    calendar = Path(event.value.path()).read_text(encoding='utf-8')
    assert 'BEGIN:VALARM' in calendar and 'TRIGGER:-PT5M' in calendar and 'Flow training' in calendar
    opening.update(begin=(start + timedelta(days=7, hours=2)).isoformat(), end=(end + timedelta(days=7, hours=2)).isoformat(),
                   location='Next week hall')
    page.get_by_role('button', name=tr['unisport.refresh'], exact=True).click()
    updated = page.get_by_role('article', name='Flow training', exact=True).filter(has_text='Next week hall')
    updated.get_by_role('button', name=tr['unisport.autosign_in'], exact=True).get_by_text(weekly_label, exact=True).wait_for()
