from unittest.mock import AsyncMock, MagicMock
from urllib.parse import parse_qs

import httpx
import html
import pytest
from fastapi.testclient import TestClient

from backend.api.deps import get_ilias_client
from backend.config import settings
from backend.main import app
from backend.schemas import ExerciseInfo, ExerciseSubmissionsResponse, SubmissionItem
from backend.services.ilias_client import IliasClient
from backend.services.ta_allocation import (
    allocation_notice_parts, format_ta_marker, validate_allocation_notice,
    compute_distribution_fingerprint,
    parse_ta_marker,
)


@pytest.mark.parametrize('control', ['input','textarea'])
def test_native_notice_parser_preserves_human_whitespace(control):
    from backend.scrapers.submissions import parse_exercise_submissions
    human = '  Original & human note  '
    value = html.escape(human, quote=True)
    field = f'<input name="notice[101]" value="{value}">' if control == 'input' else f'<textarea name="notice[101]">{value}</textarea>'
    page = f'<table id="exc_mem"><thead><tr><th>Selection</th><th>Name</th><th>Note for tutors</th></tr></thead><tbody><tr><td><input type="checkbox" name="sel_part_ids[]" value="101"></td><td>Student</td><td>{field}</td></tr></tbody></table>'
    assert parse_exercise_submissions(page,'100').submissions[0].notice == human


@pytest.mark.parametrize('human', ['', '  preserve spaces  ', 'Keep\nline breaks\t', 'Text [BI:ta1|Ada] in the middle', '😀' * 30])
def test_allocation_suffix_preserves_exact_human_text(human):
    before = format_ta_marker(human, 'ta1', 'Ada')
    assert allocation_notice_parts(before) == ('ta1', 'Ada', human)
    after = format_ta_marker(allocation_notice_parts(before)[2], 'ta2', 'Bob')
    validate_allocation_notice(before, after)
    assert allocation_notice_parts(after)[2] == human
    assert parse_ta_marker(after) == ('ta2', 'Bob', human)
    with pytest.raises(ValueError):
        validate_allocation_notice(before, format_ta_marker('discarded note', 'ta2', 'Bob'))


def test_exact_notice_boundary_and_oversized_marker():
    marker = format_ta_marker('', 'ta1', 'A')
    human = '😀' * (200 - len(marker) - 1)
    assert len(format_ta_marker(human, 'ta1', 'A')) == 200
    with pytest.raises(ValueError):
        format_ta_marker(human + 'x', 'ta1', 'A')
    with pytest.raises(ValueError):
        format_ta_marker('', 'ta1', 'A' * 200)


@pytest.mark.parametrize('name', ['', ' ', 'Ada|Bob', '[Ada]', 'Ada\nBob'])
def test_ambiguous_or_empty_names_are_rejected(name):
    with pytest.raises(ValueError):
        format_ta_marker('', 'ta1', name)


@pytest.fixture
def allocation_api(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, 'coordination_dir', str(tmp_path / 'coordination'))
    fake = IliasClient(manager=MagicMock())
    fake.session_manager.native_view_lock_key = 'allocation-test-view'
    fake.get_exercise_submissions = AsyncMock(return_value=ExerciseSubmissionsResponse(
        exercise=ExerciseInfo(ref_id='100', title='Exercise', total_participants=1, submitted_count=1, graded_count=1),
        submissions=[SubmissionItem(member_id='101', student_name='Student', notice='Original human note', submission_status='submitted',
                                    passed_status='passed', mark='5.5')], active_assignment_id='20'))
    fake.apply_ta_allocation_batch = AsyncMock(return_value=(1, []))
    app.dependency_overrides[get_ilias_client] = lambda: fake
    fingerprint = compute_distribution_fingerprint(['101'], ['Original human note'])
    payload = dict(exercise_ref_id='100', ass_id='20', fingerprint=fingerprint,
                   items=[dict(member_id='101', notice='Original human note [BI:ta1|Ada]')])
    try:
        yield TestClient(app), fake, payload
    finally:
        app.dependency_overrides.pop(get_ilias_client, None)


@pytest.mark.parametrize('change,status', [
    ('truncate', 409), ('missing_fingerprint', 422), ('stale_fingerprint', 200),
    ('unknown_member', 400), ('duplicate_member', 400), ('wrong_assignment', 400), ('long_notice', 409),
])
def test_invalid_allocation_never_reaches_native_write(allocation_api, change, status):
    api, fake, payload = allocation_api
    if change == 'truncate':
        payload['items'][0]['notice'] = 'Original... [BI:ta1|Ada]'
    elif change == 'missing_fingerprint':
        payload['fingerprint'] = ''
    elif change == 'stale_fingerprint':
        payload['fingerprint'] = '0' * 16
    elif change == 'unknown_member':
        payload['items'][0]['member_id'] = '999'
    elif change == 'duplicate_member':
        payload['items'].append(dict(payload['items'][0]))
    elif change == 'wrong_assignment':
        payload['ass_id'] = '21'
    else:
        payload['items'][0]['notice'] = 'Original human note [BI:ta1|' + 'A' * 200 + ']'
    response = api.post('/api/exercises/100/assignments/20/allocation/apply', json=payload)
    assert response.status_code == status
    if change == 'stale_fingerprint':
        assert response.json()['success'] is False
    fake.apply_ta_allocation_batch.assert_not_awaited()


def test_valid_allocation_passes_current_fingerprint_and_grades(allocation_api):
    api, fake, payload = allocation_api
    response = api.post('/api/exercises/100/assignments/20/allocation/apply', json=payload)
    assert response.status_code == 200 and response.json()['success']
    fake.apply_ta_allocation_batch.assert_awaited_once_with(exercise_ref_id='100', ass_id='20',
        target_updates=[('101', 'Original human note [BI:ta1|Ada]', 'passed', '5.5')],
        expected_fingerprint=payload['fingerprint'])


@pytest.mark.asyncio
@pytest.mark.parametrize('concurrent_change', [False, True])
async def test_batch_rechecks_notes_and_preserves_fresh_native_grades(tmp_path, monkeypatch, concurrent_change):
    monkeypatch.setattr(settings, 'coordination_dir', str(tmp_path))
    note, posts = ['Original human note' if not concurrent_change else 'Changed by another tutor'], []
    def page():
        return f'''<form id="form_exc_mem" action="https://ilias.unibe.ch/ilias.php?cmd=saveStatusAll">
        <table id="exc_mem"><thead><tr><th>Selection</th><th>Name</th><th>Note for tutors</th><th>Status</th><th>Mark</th></tr></thead><tbody>
        <tr><td><input type="checkbox" name="sel_part_ids[]" value="101"></td><td>Student (student)</td>
        <td><input name="notice[101]" value="{note[0]}"></td>
        <td><select name="status[101]"><option value="passed" selected>Passed</option></select></td>
        <td><input name="mark[101]" value="5.5"></td></tr></tbody></table></form>'''
    def respond(request):
        if request.method == 'POST':
            values = parse_qs(request.content.decode())
            posts.append(values)
            note[0] = values['notice[101]'][0]
        return httpx.Response(200, text=page())
    manager = MagicMock()
    manager.native_view_lock_key = 'batch-allocation-test'
    manager.get_http_client.side_effect = lambda: httpx.AsyncClient(transport=httpx.MockTransport(respond))
    client = IliasClient(manager=manager)
    result, errors = await client.apply_ta_allocation_batch('100', '20',
        [('101', 'Original human note [BI:ta1|Ada]', 'failed', '1.0')],
        expected_fingerprint=compute_distribution_fingerprint(['101'], ['Original human note']))
    if concurrent_change:
        assert result == 0 and errors and not posts
        assert note[0] == 'Changed by another tutor'
    else:
        assert result == 1 and not errors
        assert posts[0]['status[101]'] == ['passed']
        assert posts[0]['mark[101]'] == ['5.5']
