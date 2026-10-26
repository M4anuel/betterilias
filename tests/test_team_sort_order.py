"""Original team order comes from additions, never the actor or creation event."""
from contextlib import asynccontextmanager
from html import escape
from unittest.mock import MagicMock
from urllib.parse import parse_qs

import httpx
import pytest

from backend.scrapers.submissions import parse_team_first_added_member, first_added_surname
from backend.services.ilias_client import IliasClient, SessionExpiredError


def log_html(events):
    return '<table><tbody>' + ''.join(
        f'<tr><td>{date}</td><td>Unrelated Actor</td><td>{escape(details)}</td></tr>'
        for date, details in events
    ) + '</tbody></table>'


@pytest.mark.parametrize('creation_first', [False, True])
@pytest.mark.parametrize('reverse', [False, True])
def test_creation_order_and_table_direction_do_not_change_first_added(creation_first, reverse):
    events = [('10. Oct 2026, 11:09', 'Added member Nicola Sebastian Example.')]
    events.insert(0 if creation_first else 1, ('10. Oct 2026, 11:09', 'Team created.'))
    events.append(('10. Oct 2026, 11:10', 'Added member Claudio Other.'))
    if reverse:
        events.reverse()
    assert parse_team_first_added_member(log_html(events)) == 'Nicola Sebastian Example'


def test_german_additions_and_numeric_dates_across_months():
    events = [('01.11.2026 08:00', 'Mitglied Andere Person hinzugefügt.'),
              ('31.10.2026 23:00', 'Team erstellt.'),
              ('31.10.2026 23:01', 'Mitglied Anna von Beispiel hinzugefügt.')]
    name = parse_team_first_added_member(log_html(events))
    assert name == 'Anna von Beispiel'
    assert first_added_surname(name, ['Person, Andere', 'von Beispiel, Anna']) == 'von Beispiel'


def test_non_additions_and_actor_are_ignored():
    assert parse_team_first_added_member(log_html([
        ('10. Oct 2026, 11:09', 'Team created.'),
        ('10. Oct 2026, 11:10', 'Removed member First Person.'),
    ])) is None
    assert first_added_surname('Former Member', ['Another, Person']) == 'Member'


@pytest.mark.asyncio
async def test_log_navigation_is_opt_in_uses_native_links_and_requests_ascending():
    requests = []

    async def handle(request):
        query = parse_qs(request.url.query.decode())
        requests.append(query)
        assert request.headers.get('cookie') == 'PHPSESSID=this-session'
        if query.get('cmd') == ['showTeamLog']:
            assert query['cmdNode'] == ['native:team:node']
            assert query['_table_nav'] == ['tstamp:asc:0']
            return httpx.Response(200, text=log_html([
                ('10. Oct 2026, 11:09', 'Team created.'),
                ('10. Oct 2026, 11:09', 'Added member Zoe von Example.'),
                ('10. Oct 2026, 11:10', 'Added member Anna Alpha.'),
            ]))
        return httpx.Response(200, text='''<select name="ass_id"><option selected value="55">One</option></select>
          <table id="exc_mem"><thead><tr><th>Team</th><th>Actions</th></tr></thead><tbody><tr>
          <td><input type="checkbox" name="id[]" value="11">Alpha, Anna<br>von Example, Zoe<br>(123)</td>
          <td><button data-action="/ilias.php?cmdClass=ilExSubmissionTeamGUI&amp;cmd=showTeamLog&amp;cmdNode=native:team:node&amp;ref_id=42&amp;ass_id=55&amp;member_id=11">Team-Protokoll</button></td>
          </tr></tbody></table>''')

    manager = MagicMock()
    manager.has_cookies.return_value = True

    @asynccontextmanager
    async def http_client():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handle), cookies={'PHPSESSID': 'this-session'}) as client:
            yield client

    manager.get_http_client.side_effect = http_client
    service = IliasClient(manager)
    ordinary = await service.get_exercise_submissions('42', '55')
    assert ordinary.submissions[0].first_added_surname is None
    assert len(requests) == 1
    enriched = await service.get_exercise_submissions('42', '55', include_team_order=True)
    assert enriched.submissions[0].first_added_surname == 'von Example'
    assert len(requests) == 3


@pytest.mark.asyncio
async def test_team_log_session_loss_is_not_reported_as_a_missing_member():
    from backend.schemas import ExerciseSubmissionsResponse, ExerciseInfo, SubmissionItem
    from backend.config import settings
    result = ExerciseSubmissionsResponse(exercise=ExerciseInfo(ref_id='42', title='Test'), submissions=[
        SubmissionItem(member_id='11', student_name='Test', submission_status='submitted',
                       team_log_url=settings.ilias_base_url + '/ilias.php?cmd=showTeamLog'),
    ])
    service = IliasClient(MagicMock())
    async with httpx.AsyncClient(transport=httpx.MockTransport(
        lambda request: httpx.Response(401, text='Session expired')
    )) as client:
        with pytest.raises(SessionExpiredError):
            await service._load_team_sort_names(client, result)
