"""Collect a complete assignment without inheriting the native table's filters."""
import logging
import sys
from urllib.parse import parse_qs, urlencode, urlsplit

from backend.i18n import t
from backend.scrapers.submission_listing import members_page_url, parse_submission_listing
from backend.scrapers.submissions import parse_exercise_submissions
from backend.services.ta_allocation import compute_distribution_fingerprint

logger = logging.getLogger(__name__)
MAX_PAGES = 500


class SubmissionListingError(ValueError):
    def __init__(self):
        super().__init__(t('Could not load all submissions from ILIAS. Please refresh and try again.'))


async def collect_submissions(client, response, ref_id, ass_id, check_response):
    """Reset only filters, enumerate native pages, then restore filters and offset.

    membersApply also invokes native grading: its payload MUST exclude every
    listed_part_ids/sel_part_ids/status/mark/notice field, even hidden ones.
    """
    original = parse_submission_listing(response.text, str(response.url))
    if not original.found:
        raise SubmissionListingError()
    initial_result = parse_exercise_submissions(response.text, ref_id)
    active_assignment = (ass_id or initial_result.active_assignment_id
                         or parse_qs(urlsplit(original.action_url).query).get('ass_id', [None])[0])
    origin = urlsplit(str(response.url))

    def validate_url(url):
        parts = urlsplit(url)
        query = parse_qs(parts.query)
        if ((parts.scheme, parts.netloc) != (origin.scheme, origin.netloc)
                or query.get('ref_id', [ref_id]) != [ref_id]
                or (active_assignment and query.get('ass_id', [active_assignment]) != [active_assignment])):
            raise SubmissionListingError()

    def checked(resp):
        check_response(resp, str(resp.url))
        if resp.status_code != 200:
            raise SubmissionListingError()

    async def filter_command(page, command, filters=()):
        validate_url(page.action_url)
        resp = await client.post(page.action_url, content=urlencode([*page.security_fields, *filters, command]),
                                 headers={'Content-Type': 'application/x-www-form-urlencoded'})
        checked(resp)
        return resp

    current = original
    restore_filters = False
    restore_offset = False
    restore_navigation = original.navigation
    pages = {}
    try:
        if original.filtered:
            if not original.reset or not original.apply:
                raise SubmissionListingError()
            restore_filters = True  # Also restore after a timeout with an uncertain reset outcome.
            response = await filter_command(original, original.reset)
            current = parse_submission_listing(response.text, str(response.url))
            if not current.found or current.filtered:
                raise SubmissionListingError()
            restore_navigation = restore_navigation or current.navigation

        pending = []
        seen_ids = set()
        expected_total = current.total
        result = None
        while True:
            checked(response)
            if not current.found or current.filtered or len(pages) >= MAX_PAGES:
                raise SubmissionListingError()
            parsed = parse_exercise_submissions(response.text, ref_id)
            native_assignment = (parsed.active_assignment_id
                                 or parse_qs(urlsplit(current.action_url).query).get('ass_id', [None])[0])
            if active_assignment and native_assignment != active_assignment:
                raise SubmissionListingError()
            parsed.active_assignment_id = native_assignment
            if current.offset in pages or (expected_total is not None and current.total != expected_total):
                raise SubmissionListingError()
            ids = [item.member_id for item in parsed.submissions]
            if seen_ids.intersection(ids) or len(set(ids)) != len(ids):
                raise SubmissionListingError()
            seen_ids.update(ids)
            pages[current.offset] = parsed.submissions
            result = result or parsed
            pending.extend((offset, url) for offset, url in current.pages if offset not in pages)
            pending = sorted({offset: url for offset, url in pending if offset not in pages}.items())
            if not pending:
                break
            offset, url = pending.pop(0)
            validate_url(url)
            restore_offset = True
            response = await client.get(url)
            checked(response)
            current = parse_submission_listing(response.text, str(response.url))
            if current.offset != offset:
                raise SubmissionListingError()

        result.submissions = [item for offset in sorted(pages) for item in pages[offset]]
        if min(pages) != 0 or (expected_total is not None and len(result.submissions) != expected_total):
            raise SubmissionListingError()
        result.exercise.total_participants = len(result.submissions)
        result.exercise.submitted_count = sum(s.submission_status in ('submitted', 'late') for s in result.submissions)
        result.exercise.graded_count = sum(bool(s.passed_status in ('passed', 'failed') or (s.mark and s.mark.strip()))
                                          for s in result.submissions)
        result.fingerprint = compute_distribution_fingerprint(
            [s.member_id for s in result.submissions], [s.notice or '' for s in result.submissions])
        result.listing_complete = True
        return result
    finally:
        had_error = sys.exc_info()[0] is not None
        try:
            if restore_filters:
                # Use the latest tokens, but only the original filter values.
                restored = await filter_command(current if current.found else original,
                                                original.apply, original.filters)
                restored_page = parse_submission_listing(restored.text, str(restored.url))
                if sorted(restored_page.filters) != sorted(original.filters):
                    raise SubmissionListingError()
            if (restore_filters or restore_offset) and restore_navigation:
                url = members_page_url(original.action_url, restore_navigation)
                validate_url(url)
                restored = await client.get(url)
                checked(restored)
        except Exception:
            logger.warning('Could not restore the native submission table view for exercise %s', ref_id)
            if not had_error:
                raise SubmissionListingError()
