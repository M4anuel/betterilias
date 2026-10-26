"""ILIAS sorting follows the evaluation-file recipient, independently of team history."""
from contextlib import asynccontextmanager
from pathlib import Path
from unittest.mock import MagicMock
from urllib.parse import parse_qs

import httpx
import pytest

from backend.config import settings
from backend.schemas import ExerciseSubmissionsResponse, ExerciseInfo, SubmissionItem
from backend.scrapers.feedback_files import parse_feedback_files
from backend.services.ilias_client import IliasClient, SessionExpiredError


@pytest.mark.parametrize('filename', ['upload_1.html', 'upload_1_dialog.html', 'uploaded_now_remove.html'])
def test_saved_evaluation_pages_identify_the_same_recipient(filename):
    html = (Path(__file__).parent / 'fixtures/evaluation_by_file' / filename).read_text(encoding='utf-8')
    assert parse_feedback_files(html).student_name == 'Flückiger, Manuel'


@pytest.mark.parametrize('heading', ['Evaluation Files', 'Feedback Files', 'Korrektur-Dateien', 'Korrekturdateien'])
def test_recipient_comes_from_the_heading_in_either_language(heading):
    html = f'<h1>Exercises</h1><p>Someone Else</p><h2>{heading}: <span>von Example, Zoe</span></h2>'
    assert parse_feedback_files(html).student_name == 'von Example, Zoe'


@pytest.mark.asyncio
async def test_recipient_navigation_is_opt_in_and_uses_native_evaluation_links():
    requests = []

    async def handle(request):
        query = parse_qs(request.url.query.decode())
        requests.append(query)
        assert request.headers.get('cookie') == 'PHPSESSID=this-session'
        assert query.get('cmd') != ['showTeamLog']
        if query.get('cmdClass') == ['ilResourceCollectionGUI']:
            assert query['cmdNode'] == ['native:feedback:node']
            assert query['member_id'] == ['99']  # Follow native recipient, not the row's ID.
            return httpx.Response(200, text='<h2>Evaluation Files: von Example, Zoe</h2>')
        return httpx.Response(200, text='''<select name="ass_id"><option selected value="55">One</option></select>
          <table id="exc_mem"><thead><tr><th>Team</th><th>Actions</th></tr></thead><tbody><tr>
          <td><input type="checkbox" name="id[]" value="11">Alpha, Anna<br>von Example, Zoe<br>(123)</td>
          <td><button data-action="/ilias.php?cmdClass=ilExSubmissionTeamGUI&amp;cmd=showTeamLog&amp;ref_id=42&amp;ass_id=55&amp;member_id=11">Team log</button>
          <button data-action="/ilias.php?cmdClass=ilResourceCollectionGUI&amp;cmdNode=native:feedback:node&amp;ref_id=42&amp;ass_id=55&amp;member_id=99">Evaluation by file</button></td>
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
    assert ordinary.submissions[0].feedback_recipient_surname is None
    assert len(requests) == 1
    enriched = await service.get_exercise_submissions('42', '55', include_ilias_order=True)
    assert enriched.submissions[0].feedback_recipient_surname == 'von Example'
    assert len(requests) == 3


def result_with_recipient():
    return ExerciseSubmissionsResponse(exercise=ExerciseInfo(ref_id='42', title='Test'), submissions=[
        SubmissionItem(member_id='11', student_name='Alpha, Anna', team_id='123', submission_status='submitted',
                       evaluation_by_file_url=settings.ilias_base_url + '/ilias.php?cmdClass=ilResourceCollectionGUI'),
    ])


@pytest.mark.asyncio
@pytest.mark.parametrize(('status', 'exception'), [(401, SessionExpiredError), (500, httpx.HTTPStatusError)])
async def test_evaluation_page_errors_are_not_reported_as_missing_recipients(status, exception):
    result = result_with_recipient()
    service = IliasClient(MagicMock())
    async with httpx.AsyncClient(transport=httpx.MockTransport(
        lambda request: httpx.Response(status, text='Error')
    )) as client:
        with pytest.raises(exception):
            await service._load_ilias_sort_names(client, result)


@pytest.mark.asyncio
async def test_unknown_recipient_does_not_fall_back_to_first_team_member():
    result = result_with_recipient()
    service = IliasClient(MagicMock())
    async with httpx.AsyncClient(transport=httpx.MockTransport(
        lambda request: httpx.Response(200, text='<h2>Exercises</h2>')
    )) as client:
        await service._load_ilias_sort_names(client, result)
    assert result.submissions[0].feedback_recipient_surname is None


@pytest.mark.asyncio
async def test_no_evaluation_link_uses_individual_surname_but_never_guesses_a_team_recipient():
    result = result_with_recipient()
    result.submissions[0].evaluation_by_file_url = None
    result.submissions.append(SubmissionItem(member_id='22', student_name='von Example, Zoe', submission_status='not_submitted'))
    service = IliasClient(MagicMock())
    async with httpx.AsyncClient(transport=httpx.MockTransport(
        lambda request: pytest.fail('No evaluation link should mean no request')
    )) as client:
        await service._load_ilias_sort_names(client, result)
    assert result.submissions[0].feedback_recipient_surname is None
    assert result.submissions[1].feedback_recipient_surname == 'von Example'
