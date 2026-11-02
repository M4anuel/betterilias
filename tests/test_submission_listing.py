"""Stateful native-table regressions: default filters and 800-row paging."""
import asyncio
from contextlib import asynccontextmanager
from html import escape
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock
from urllib.parse import parse_qs

import httpx
import pytest
from fastapi.testclient import TestClient

from backend.api.deps import get_ilias_client
from backend.config import settings
from backend.main import app
from backend.scrapers.submission_listing import NAV, parse_submission_listing
from backend.services.ilias_client import IliasClient, SessionExpiredError
from backend.services.submission_listing import SubmissionListingError
from backend.services.ta_allocation import compute_distribution_fingerprint


class NativeTable:
    def __init__(self, count=50, rows=40, offset=0, filters=None):
        self.count, self.rows, self.offset = count, rows, offset
        self.filters = dict(flt_name='', flt_status='', flt_subm='', flt_subm_after='', flt_subm_before='')
        self.filters.update(filters or {})
        self.requests = []
        self.fail_page = None
        self.repeat_page = False
        self.ignore_reset = False
        self.reset_get_supported = True

    def render(self):
        ids = list(range(1, self.count + 1))
        if self.filters['flt_status']:
            ids = [i for i in ids if (i % 2 == 0) == (self.filters['flt_status'] == 'passed')]
        if self.filters['flt_subm']:
            ids = [i for i in ids if (i % 3 != 0) == (self.filters['flt_subm'] == 'y')]
        if self.filters['flt_name'] or self.filters['flt_subm_after'] or self.filters['flt_subm_before']:
            ids = []
        total = len(ids)
        offset = 0 if self.repeat_page or self.offset >= total else self.offset
        visible = ids[offset:offset + self.rows]
        fields = ''.join(f'<input name="{k}" value="{escape(v, quote=True)}">' for k, v in self.filters.items())
        options = ''.join(f'<option value="name:asc:{n}" {"selected" if n == offset else ""}>{n // self.rows + 1}</option>'
                          for n in range(0, total, self.rows))
        navigation = (f'<input type="hidden" name="{NAV}" value="name:asc:{offset}">'
                      f'<select name="{NAV}1">{options}</select>') if total > self.rows else ''
        rows = ''.join(f'''<tr><td><input type="checkbox" name="sel_part_ids[]" value="{i}">
            <input type="hidden" name="listed_part_ids[]" value="{i}">Student {i:04d}</td>
            <td>{'28.10.2026 11:50' if i % 3 else 'Not submitted'}</td>
            <td><select name="status[{i}]"><option selected value="{'passed' if i % 2 == 0 else 'notgraded'}">Grade</option></select></td>
            <td><input name="mark[{i}]" value="{'5.5' if i % 2 == 0 else ''}"></td>
            <td><input name="notice[{i}]" value="Keep note {i}"></td></tr>''' for i in visible)
        return f'''<h1>Exercises</h1><select name="ass_id"><option selected value="55">One</option></select>
            <form action="/ilias.php?cmdClass=ilExerciseManagementGUI&amp;cmdNode=native:node&amp;cmd=post&amp;fallbackCmd=saveStatusAll&amp;ref_id=42&amp;ass_id=55&amp;rtoken=token">
            <input type="hidden" name="csrf_token" value="fresh-token">{fields}
            <input name="cmd[membersReset]" type="submit" value="Reset Filter">
            <input name="cmd[membersApply]" type="submit" value="Apply Filter">
            <div class="ilTableNav"><span class="ilTableFootLight">({offset + 1 if total else 0} - {offset + len(visible)} of {total})</span>{navigation}</div>
            <table id="exc_mem"><thead><tr><th>Name</th><th>Submitted on</th><th>Grade</th><th>Mark</th><th>Note for tutors</th></tr></thead>
            <tbody>{rows}</tbody></table></form>'''

    async def handle(self, request):
        await asyncio.sleep(0)  # Exercise interleaving between two native-view reads.
        self.requests.append(request)
        assert request.headers.get('cookie') == 'PHPSESSID=this-session'
        query = parse_qs(request.url.query.decode())
        if 'exc_mem_trows' in query:
            assert query['exc_mem_trows'] == ['800']
            self.rows = 800
        if request.method == 'POST':
            data = parse_qs(request.content.decode(), keep_blank_values=True)
            assert set(data) == {'csrf_token', 'cmd[membersReset]'}
            assert data['csrf_token'] == ['fresh-token']
            if 'cmd[membersReset]' in data and not self.ignore_reset:
                self.filters = dict.fromkeys(self.filters, '')
            self.offset = 0
        elif query.get('cmd') == ['membersReset'] and self.reset_get_supported:
            if not self.ignore_reset:
                self.filters = dict.fromkeys(self.filters, '')
            self.offset = 0
        elif NAV in query:
            self.offset = int(query[NAV][0].rsplit(':', 1)[1])
            if self.fail_page is not None and self.offset == self.rows:
                return httpx.Response(self.fail_page, text='Error')
        return httpx.Response(200, text=self.render())

    def service(self, session='listing-test'):
        manager = MagicMock()
        manager.has_cookies.return_value = True
        manager.session_id = session

        @asynccontextmanager
        async def client():
            async with httpx.AsyncClient(transport=httpx.MockTransport(self.handle),
                                         cookies={'PHPSESSID': 'this-session'}, follow_redirects=True) as http:
                yield http
        manager.get_http_client.side_effect = client
        return IliasClient(manager)


def test_saved_native_fixture_exposes_active_filter_and_safe_controls():
    html = (Path(__file__).parent / 'fixtures/evaluation_by_file/submissions_and_grades_view.html').read_text(encoding='utf8')
    page = parse_submission_listing(html, settings.ilias_base_url + '/ilias.php')
    assert page.filtered and ('flt_status', 'failed') in page.filters
    assert page.reset[0] == 'cmd[membersReset]'
    assert 'rtoken=' in page.action_url
    assert not any('part_ids' in key or 'status[' in key for key, _ in page.security_fields)


@pytest.mark.asyncio
@pytest.mark.parametrize('filters', [dict(flt_status='passed'), dict(flt_subm='y'),
                                   dict(flt_status='notgraded', flt_subm='n'),
                                   dict(flt_name='Nobody', flt_subm_after='2026-11-01', flt_subm_before='2026-11-02')])
async def test_native_filters_are_reset_with_one_request(filters):
    native = NativeTable(filters=filters)
    result = await native.service().get_exercise_submissions('42', '55')
    assert result.listing_complete and len(result.submissions) == 50
    assert [s.member_id for s in result.submissions] == [str(i) for i in range(1, 51)]
    assert result.exercise.total_participants == 50 and result.exercise.graded_count == 25
    assert result.exercise.submitted_count == 34
    assert result.fingerprint == compute_distribution_fingerprint(
        [s.member_id for s in result.submissions], [s.notice or '' for s in result.submissions])
    assert not any(native.filters.values()) and native.rows == 800 and native.offset == 0
    assert len(native.requests) == 1 and native.requests[0].method == 'GET'


@pytest.mark.asyncio
@pytest.mark.parametrize('rows,count,offset', [(40, 50, 0), (40, 90, 40), (5, 50, 0), (800, 805, 0)])
async def test_800_row_pages_replace_saved_row_limit_and_offset(rows, count, offset):
    native = NativeTable(rows=rows, count=count, offset=offset)
    result = await native.service().get_exercise_submissions('42', '55')
    assert [s.member_id for s in result.submissions] == [str(i) for i in range(1, count + 1)]
    assert native.offset == (800 if count > 800 else 0) and native.rows == 800
    assert len(native.requests) == (2 if count > 800 else 1)
    assert all(r.method == 'GET' for r in native.requests)


@pytest.mark.asyncio
@pytest.mark.parametrize('status,exception', [(500, SubmissionListingError), (401, SessionExpiredError)])
async def test_failed_later_page_never_returns_a_partial_success(status, exception):
    native = NativeTable(count=805, filters=dict(flt_status='passed'))
    native.fail_page = status
    with pytest.raises(exception):
        await native.service().get_exercise_submissions('42', '55')
    assert not any(native.filters.values())
    assert len(native.requests) == 2


@pytest.mark.asyncio
async def test_repeated_page_is_rejected():
    native = NativeTable(count=805)
    native.repeat_page = True
    with pytest.raises(SubmissionListingError):
        await native.service().get_exercise_submissions('42', '55')


@pytest.mark.asyncio
async def test_filter_reset_must_be_verified():
    native = NativeTable(filters=dict(flt_status='passed'))
    native.ignore_reset = True
    with pytest.raises(SubmissionListingError):
        await native.service().get_exercise_submissions('42', '55')
    assert native.filters['flt_status'] == 'passed'


@pytest.mark.asyncio
@pytest.mark.parametrize('count', [0, 1])
async def test_complete_empty_and_single_page_assignments_need_no_filter_writes(count):
    native = NativeTable(count=count)
    result = await native.service().get_exercise_submissions('42', '55')
    assert result.listing_complete and len(result.submissions) == count
    assert len(native.requests) == 1


@pytest.mark.asyncio
async def test_concurrent_reads_share_a_lock_even_across_client_instances():
    native = NativeTable(count=805, filters=dict(flt_status='passed'))
    first, second = native.service(), native.service()
    results = await asyncio.gather(first.get_exercise_submissions('42', '55'), second.get_exercise_submissions('42', '55'))
    assert all(len(result.submissions) == 805 for result in results)
    commands = [parse_qs(r.url.query.decode())['cmd'][0] for r in native.requests]
    assert commands == ['membersReset', 'members'] * 2


@pytest.mark.asyncio
async def test_legacy_route_resets_filters_without_sending_grading_fields():
    native = NativeTable(filters=dict(flt_status='passed'))
    native.reset_get_supported = False
    result = await native.service().get_exercise_submissions('42', '55')
    assert len(result.submissions) == 50 and not any(native.filters.values())
    assert [r.method for r in native.requests] == ['GET', 'POST']


@pytest.mark.asyncio
async def test_each_read_resets_filters_changed_in_ilias_again():
    native = NativeTable(filters=dict(flt_status='passed'))
    service = native.service()
    await service.get_exercise_submissions('42', '55')
    native.filters['flt_subm'] = 'n'
    result = await service.get_exercise_submissions('42', '55')
    assert len(result.submissions) == 50 and not any(native.filters.values())
    assert len(native.requests) == 2


@pytest.mark.parametrize('language', ['de', 'en'])
def test_incomplete_listing_has_a_localised_api_error(language):
    service = MagicMock()
    async def fail(**kw):
        raise SubmissionListingError()
    service.get_exercise_submissions = AsyncMock(side_effect=fail)
    app.dependency_overrides[get_ilias_client] = lambda: service
    try:
        response = TestClient(app).get('/api/exercises/42/submissions', headers={'Accept-Language': language})
        assert response.status_code == 502 and response.json()['code'] == 'SUBMISSIONS_INCOMPLETE'
        assert ('vollständig' in response.json()['detail']) == (language == 'de')
    finally:
        app.dependency_overrides.pop(get_ilias_client, None)
