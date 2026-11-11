"""Fault-injection regressions for persisted workflow transitions and write certainty."""
import asyncio
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest

from backend.auth.session import SessionManager
from backend.config import settings
from backend.outbound_budget import OutboundUnavailable
from backend.schemas import CourseCalendarInfo, CourseItem, CourseScheduleRuleInput, FeedbackFileItem, FeedbackFilesResponse, FeedbackImportCommitRequest
from backend.services import feedback_import
from backend.services.assignment_creation import AssignmentCreationUncertain
from backend.services.calendar_service import CalendarService
from backend.services.ilias_client import IliasClient
from tests.test_ta_assignment_save import CreationScenario
from fastapi.testclient import TestClient
from backend.main import app
from backend.api.deps import get_ilias_client


@pytest.fixture(autouse=True)
def private_state(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, 'coordination_dir', str(tmp_path / 'locks'))
    monkeypatch.setattr(feedback_import, 'STAGING_ROOT', tmp_path / 'stage')


@pytest.mark.asyncio
@pytest.mark.parametrize('failure', [None, RuntimeError, asyncio.CancelledError])
async def test_calendar_progress_preserves_concurrent_rule_and_subscription(tmp_path, failure):
    service = CalendarService(tmp_path / 'calendar')
    async def import_course(client, course):
        if course.ref_id == '1':
            service.create_rule('tenant', CourseScheduleRuleInput(course_ref_id='1', course_title='Course', semester='HS2026',
                weekdays=[0], start_time='10:00', end_time='11:00', start_date='2026-09-14', end_date='2026-12-31'))
            service.rotate_subscription_token('tenant')
            service.update_course_color('tenant', '1', '#2563EB')
            service.update_course_ignored_missing_schedule('tenant', '1', True)
            service.update_hidden_courses('tenant', ['1'])
        elif failure:
            raise failure()
        return CourseCalendarInfo(course_ref_id=course.ref_id, course_title=course.title, color='#0AACA5', status='valid_empty'), []
    service._import_single_course = import_course
    courses = [CourseItem(ref_id=str(i), title=f'Course {i}', semester='HS2026') for i in [1, 2]]
    job = service.sync_semester_calendar('tenant', SimpleNamespace(), courses=courses, force_refresh=True)
    if failure:
        with pytest.raises(failure): await job
    else:
        await job
    state = service._load_tenant_state('tenant')
    assert len(state['rules']) == 1
    assert state['subscription_token']
    assert state['hidden_courses'] == ['1']
    assert state['courses']['1']['color'] == '#2563EB'
    assert state['courses']['1']['ignored_missing_schedule'] is True
    assert state['sync_progress']['is_syncing'] is False
    assert service.get_feed_by_token(state['subscription_token']) is not None


class FeedbackStore:
    def __init__(self):
        self.files = [FeedbackFileItem(id='old', title='feedback.pdf')]
        self.fail_upload = self.lose_upload_response = self.fail_delete = self.ignore_delete = False
        self.uploads = self.deletes = 0
        self.calls = []

    async def get_exercise_submissions(self, **kwargs):
        return SimpleNamespace(submissions=[SimpleNamespace(member_id='1', team_id=None, evaluation_by_file_url='https://example.invalid/feedback')])

    async def get_submission_feedback_files(self, **kwargs):
        return FeedbackFilesResponse(member_id='1', files=list(self.files))

    async def upload_submission_feedback_file(self, **kwargs):
        self.uploads += 1; self.calls.append('upload')
        if self.fail_upload: raise httpx.ReadTimeout('No confirmation')
        self.files.append(FeedbackFileItem(id=f'new-{self.uploads}', title=kwargs['filename']))
        if self.lose_upload_response: raise httpx.ReadTimeout('Saved but response lost')
        return await self.get_submission_feedback_files()

    async def delete_submission_feedback_file(self, **kwargs):
        self.deletes += 1; self.calls.append('delete')
        if self.fail_delete: raise httpx.ReadTimeout('Deletion unavailable')
        if not self.ignore_delete: self.files = [item for item in self.files if item.id != kwargs['file_id']]
        return await self.get_submission_feedback_files()


def stage_import(manual=False):
    folder = feedback_import.STAGING_ROOT / 'tenant' / 'job'
    unit = folder / ('_unmatched' if manual else 'user_1'); unit.mkdir(parents=True)
    (unit / 'feedback.pdf').write_bytes(b'new feedback')
    meta = {'snapshot_token': 'snapshot', 'exercise_ref_id': '200', 'ass_id': '20', 'units': []}
    if manual:
        meta.update(unmatched_files_meta={'feedback.pdf': {'filename': 'feedback.pdf', 'stored_filename': 'feedback.pdf'}},
                    existing_feedback_cache={'user:1': {'feedback.pdf': 'old'}})
        if manual == 'uncached': meta.pop('existing_feedback_cache')
    else:
        meta['units'] = [{'unit_id': 'user:1', 'member_id': '1', 'files': [{'filename': 'feedback.pdf', 'existing_file_id': 'old', 'action': 'overwrite'}]}]
    (folder / 'meta.json').write_text(json.dumps(meta), encoding='utf8')
    request = FeedbackImportCommitRequest(staged_import_id='job', snapshot_token='snapshot',
        manual_mappings={'feedback.pdf': 'user:1'} if manual else {}, conflict_actions={'user:1:feedback.pdf': 'overwrite'})
    return folder, request


@pytest.mark.asyncio
@pytest.mark.parametrize('manual', [False, True, 'uncached'])
async def test_failed_feedback_upload_never_deletes_original(manual):
    store = FeedbackStore(); store.fail_upload = True
    folder, request = stage_import(manual)
    result = await feedback_import.commit_feedback_import('200', '20', 'tenant', request, store)
    assert not result.success and result.failed_count == 1
    assert [item.id for item in store.files] == ['old']
    assert store.deletes == 0 and folder.exists()


@pytest.mark.asyncio
@pytest.mark.parametrize('manual', [False, True, 'uncached'])
@pytest.mark.parametrize('mode', ['fail_delete', 'ignore_delete', 'lose_upload_response'])
async def test_partial_feedback_retry_reconciles_without_uploading_twice(manual, mode):
    store = FeedbackStore(); setattr(store, mode, True)
    folder, request = stage_import(manual)
    first = await feedback_import.commit_feedback_import('200', '20', 'tenant', request, store)
    assert not first.success and first.failed_count == 1 and folder.exists()
    assert store.files[0].id == 'old' and store.uploads == 1
    setattr(store, mode, False)
    second = await feedback_import.commit_feedback_import('200', '20', 'tenant', request, store)
    assert second.success and not folder.exists()
    assert store.uploads == 1 and [item.id for item in store.files] == ['new-1']
    assert store.calls.index('upload') < store.calls.index('delete')


@pytest.mark.asyncio
async def test_receipted_creation_reconciles_lost_native_response_without_second_post():
    scenario = CreationScenario()
    scenario.manager.session_id = 'receipt-owner'
    native = scenario.handle
    def lost_response(request):
        response = native(request)
        if request.method == 'POST' and scenario.created:
            raise httpx.ReadTimeout('Creation response lost', request=request)
        return response
    scenario.manager.get_http_client.side_effect = lambda: httpx.AsyncClient(
        transport=httpx.MockTransport(lost_response), cookies={'PHPSESSID': 'tenant'}, follow_redirects=True)
    operation = 'stable-operation-123456'
    with pytest.raises(AssignmentCreationUncertain): await scenario.save(operation_id=operation)
    posts = len(scenario.posts)
    confirmed = await scenario.save(operation_id=operation)
    assert confirmed.ass_id == '99' and len(scenario.posts) == posts
    with pytest.raises(AssignmentCreationUncertain): await scenario.save(operation_id=operation, title='Changed draft')
    assert len(scenario.posts) == posts
    # Another worker/client reads the same persisted receipt.
    second = IliasClient(scenario.manager)
    scenario.client = second
    assert (await scenario.save(operation_id=operation)).ass_id == '99'
    assert len(scenario.posts) == posts


def test_http_creation_requires_a_stable_operation_id_before_dispatch():
    client = SimpleNamespace(save_ta_assignment=AsyncMock())
    app.dependency_overrides[get_ilias_client] = lambda: client
    try:
        response = TestClient(app).post('/api/exercises/200/ta/assignment-detail', json={'title': 'New assignment'})
        assert response.status_code == 422
        client.save_ta_assignment.assert_not_awaited()
    finally:
        app.dependency_overrides.pop(get_ilias_client, None)


@pytest.mark.asyncio
@pytest.mark.parametrize('status', [500, 502, 504])
async def test_upstream_server_failure_does_not_revoke_authentication(status):
    class UnavailableSession(SessionManager):
        def __init__(self): pass
        def has_cookies(self): return True
        def get_http_client(self):
            return httpx.AsyncClient(transport=httpx.MockTransport(lambda request: httpx.Response(status, request=request)))
    with pytest.raises(OutboundUnavailable):
        await IliasClient(UnavailableSession()).get_auth_status()
