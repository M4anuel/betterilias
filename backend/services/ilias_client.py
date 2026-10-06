import logging
import urllib.parse
from typing import AsyncGenerator, Dict, Optional, Tuple

import httpx

from backend.auth.session import SessionManager, session_manager
from backend.config import settings
from backend.schemas import (
    AuthStatus,
    CourseLogsResponse,
    CourseMaterialsResponse,
    DashboardResponse,
    ExerciseOverviewResponse,
    ExerciseSubmissionsResponse,
    GradeSubmissionRequest,
    GradeSubmissionResponse,
    PodcastSeriesResponse,
    SemesterScreenResponse,
)
from backend.scrapers import (
    extract_grading_form,
    parse_course_logs,
    parse_course_materials,
    parse_dashboard,
    parse_exercise_overview,
    parse_exercise_submissions,
    parse_podcast_series,
    parse_semester_courses,
    verify_grading_success,
)

logger = logging.getLogger("ilias.service")


class SessionExpiredError(Exception):
    """Raised when an ILIAS request detects that the user session is expired or invalid."""
    pass


class IliasClient:
    """High-level async client for interacting with Uni Bern ILIAS."""

    def __init__(self, manager: Optional[SessionManager] = None):
        self.session_manager = manager or session_manager

    def _ensure_authenticated(self):
        """Check if cookies exist."""
        if not self.session_manager.has_cookies():
            raise SessionExpiredError("No active ILIAS session found. Please log in.")

    def _check_response_for_session_loss(self, response: httpx.Response, requested_url: str):
        """Detect if ILIAS redirected to a login page instead of the expected target."""
        final_url = str(response.url).lower()
        if any(token in final_url for token in ["login.php", "wayf", "eduid", "aai", "shibboleth"]):
            raise SessionExpiredError(
                f"Session expired or unauthorized. Redirected to login page from {requested_url}."
            )
        # Check for HTML login form in response
        if "<input" in response.text and "name=\"username\"" in response.text and "name=\"password\"" in response.text:
            raise SessionExpiredError("Session expired: ILIAS login form encountered.")

    async def get_auth_status(self) -> AuthStatus:
        """Check current authentication status."""
        has_cookies = self.session_manager.has_cookies()
        if not has_cookies:
            return AuthStatus(
                authenticated=False,
                client_id=settings.ilias_client_id,
                cookies_present=False,
                message="No cookies stored.",
            )

        is_valid, user_or_msg = await self.session_manager.verify_session()
        return AuthStatus(
            authenticated=is_valid,
            client_id=settings.ilias_client_id,
            cookies_present=True,
            user_name=user_or_msg if is_valid else None,
            message=user_or_msg,
        )

    async def get_dashboard(self) -> DashboardResponse:
        """Fetch and parse Personal Desktop courses."""
        self._ensure_authenticated()
        url = f"{settings.ilias_base_url}/ilias.php?baseClass=ilPersonalDesktopGUI&cmd=jumpToSelectedItems"

        async with self.session_manager.get_http_client() as client:
            resp = await client.get(url)
            self._check_response_for_session_loss(resp, url)
            courses = parse_dashboard(resp.text)
            return DashboardResponse(courses=courses)

    async def get_semester_courses(self, semester: Optional[str] = None) -> SemesterScreenResponse:
        """Fetch and parse courses grouped by semester (Uni Bern iliLubModsSemesterGUI)."""
        self._ensure_authenticated()

        # Semesters going back to 2021 (Supports studies starting in 2022 and beyond)
        sem_list = [
            "FS2027", "HS2026", "FS2026", "HS2025", "FS2025",
            "HS2024", "FS2024", "HS2023", "FS2023", "HS2022",
            "FS2022", "HS2021"
        ]
        target_sem = semester or "HS2026"
        if target_sem not in sem_list:
            sem_list.insert(0, target_sem)

        semesters_str = "_".join(sem_list)
        url = (
            f"{settings.ilias_base_url}/ilias.php?"
            f"baseClass=iluipluginroutergui&cmdNode=15n:179&cmdClass=iliLubModsSemesterGUI&cmd=show"
            f"&semesters={semesters_str}&semester={target_sem}&default={target_sem}"
        )
        async with self.session_manager.get_http_client() as client:
            resp = await client.get(url)
            self._check_response_for_session_loss(resp, url)
            parsed = parse_semester_courses(resp.text)
            if not parsed.active_semester:
                parsed.active_semester = target_sem
            return parsed

    async def get_course_materials(self, ref_id: str) -> CourseMaterialsResponse:
        """Fetch and parse course or folder repository contents."""
        self._ensure_authenticated()
        # ILIAS supports baseClass=ilRepositoryGUI&ref_id=X or goto_ilias3_unibe_crs_X.html
        url = f"{settings.ilias_base_url}/ilias.php?baseClass=ilRepositoryGUI&ref_id={ref_id}"

        async with self.session_manager.get_http_client() as client:
            resp = await client.get(url)
            self._check_response_for_session_loss(resp, url)
            return parse_course_materials(resp.text, container_ref_id=ref_id)

    async def get_podcast_series(self, ref_id: str) -> PodcastSeriesResponse:
        """
        Fetch and parse Opencast / Mediacast podcast series.
        Automatically traverses pagination (e.g. page 0, page 1),
        merges episodes, and ensures recorded/available episodes are listed first.
        """
        self._ensure_authenticated()
        base_podcast_url = (
            f"{settings.ilias_base_url}/ilias.php?"
            f"baseClass=ilobjplugindispatchgui&cmdClass=xoctEventGUI&ref_id={ref_id}"
        )
        fallback_repo_url = (
            f"{settings.ilias_base_url}/ilias.php?baseClass=ilRepositoryGUI&ref_id={ref_id}"
        )

        async with self.session_manager.get_http_client() as client:
            resp = await client.get(base_podcast_url)
            self._check_response_for_session_loss(resp, base_podcast_url)
            if "xoct" not in resp.text and "c-entity" not in resp.text:
                resp = await client.get(fallback_repo_url)
                self._check_response_for_session_loss(resp, fallback_repo_url)

            series_data = parse_podcast_series(resp.text, ref_id=ref_id)

            if series_data.pages_available:
                all_episodes = list(series_data.episodes)
                seen_ids = {e.id for e in all_episodes}
                for page_url in series_data.pages_available:
                    if str(resp.url) == page_url:
                        continue
                    try:
                        p_resp = await client.get(page_url)
                        self._check_response_for_session_loss(p_resp, page_url)
                        sub_data = parse_podcast_series(p_resp.text, ref_id=ref_id)
                        for ep in sub_data.episodes:
                            if ep.id not in seen_ids:
                                all_episodes.append(ep)
                                seen_ids.add(ep.id)
                    except Exception as e:
                        logger.warning(f"Error fetching podcast page {page_url}: {e}")

                available_eps = [e for e in all_episodes if e.status == "available"]
                scheduled_eps = [e for e in all_episodes if e.status == "scheduled"]
                sorted_eps = available_eps + scheduled_eps

                series_data.episodes = sorted_eps
                series_data.total_episodes = len(sorted_eps)
                series_data.recorded_count = len(available_eps)
                series_data.scheduled_count = len(scheduled_eps)

            return series_data

    async def get_course_logs(self, course_id: str, page: int = 1) -> CourseLogsResponse:
        """
        Fetch and parse course activity logs (news) from the dedicated showNews view.
        Supports news_page pagination.
        """
        self._ensure_authenticated()
        url = (
            f"{settings.ilias_base_url}/ilias.php?"
            f"baseClass=ilrepositorygui&cmdClass=ilNewsForContextBlockGUI&cmd=showNews"
            f"&ref_id={course_id}&col_side=right&block_type=news&news_page={page}"
        )
        async with self.session_manager.get_http_client() as client:
            resp = await client.get(url)
            self._check_response_for_session_loss(resp, url)
            return parse_course_logs(resp.text, course_id=course_id)

    async def get_exercise_submissions(self, ref_id: str) -> ExerciseSubmissionsResponse:
        """Fetch and parse exercise participant submissions list."""
        self._ensure_authenticated()
        # Tries standard Exercise GUI links (including modern Uni Bern ilexercisemanagementgui)
        urls_to_try = [
            f"{settings.ilias_base_url}/ilias.php?baseClass=ilexercisehandlergui&cmdClass=ilexercisemanagementgui&cmd=members&ref_id={ref_id}",
            f"{settings.ilias_base_url}/ilias.php?baseClass=ilExerciseHandlerGUI&ref_id={ref_id}&cmd=viewMembers",
            f"{settings.ilias_base_url}/ilias.php?cmdClass=ilobjexercisegui&cmd=viewMembers&ref_id={ref_id}",
            f"{settings.ilias_base_url}/ilias.php?ref_id={ref_id}&cmd=viewMembers",
            f"{settings.ilias_base_url}/ilias.php?baseClass=ilExerciseHandlerGUI&ref_id={ref_id}",
        ]

        async with self.session_manager.get_http_client() as client:
            last_resp = None
            for url in urls_to_try:
                resp = await client.get(url)
                self._check_response_for_session_loss(resp, url)
                last_resp = resp
                # If we hit a page with exercise content or table
                if "tbl_il_exc" in resp.text or "viewMembers" in resp.text or "Teilnehmer" in resp.text:
                    return parse_exercise_submissions(resp.text, exercise_ref_id=ref_id)

            if last_resp:
                return parse_exercise_submissions(last_resp.text, exercise_ref_id=ref_id)

            raise ValueError(f"Failed to fetch exercise with ref_id {ref_id}")

    async def get_exercise_overview(self, ref_id: str) -> ExerciseOverviewResponse:
        """Fetch and parse exercise overview and sub-assignments (showOverview)."""
        self._ensure_authenticated()
        url = (
            f"{settings.ilias_base_url}/ilias.php?"
            f"baseClass=ilexercisehandlergui&cmdNode=dc:o5&cmdClass=ilObjExerciseGUI&cmd=showOverview&ref_id={ref_id}"
        )
        async with self.session_manager.get_http_client() as client:
            resp = await client.get(url)
            self._check_response_for_session_loss(resp, url)
            return parse_exercise_overview(resp.text, exercise_ref_id=ref_id)

    async def grade_student_submission(
        self, exercise_ref_id: str, grade_data: GradeSubmissionRequest
    ) -> GradeSubmissionResponse:
        """
        Phase 3: The Write-Path for TAs.
        Navigates to grading page, scrapes hidden fields / CSRF tokens, constructs POST, and submits.
        """
        self._ensure_authenticated()
        exercise_url = (
            f"{settings.ilias_base_url}/ilias.php?"
            f"cmdClass=ilobjexercisegui&cmd=viewMembers&ref_id={exercise_ref_id}"
        )

        async with self.session_manager.get_http_client() as client:
            # 1. Fetch current grading / participant page
            resp = await client.get(exercise_url)
            self._check_response_for_session_loss(resp, exercise_url)

            # 2. Extract form structure and hidden tokens
            form_data = extract_grading_form(resp.text, member_id=grade_data.member_id)

            # 3. Construct POST payload
            payload: Dict[str, str] = dict(form_data.hidden_fields)

            # Map status (passed, failed, not_graded)
            status_val = grade_data.status
            if status_val == "passed":
                status_val = "passed"
            elif status_val == "failed":
                status_val = "failed"
            elif status_val == "not_graded":
                status_val = "not_graded"

            if form_data.status_field_name and status_val:
                payload[form_data.status_field_name] = status_val

            if form_data.mark_field_name and grade_data.mark is not None:
                payload[form_data.mark_field_name] = str(grade_data.mark)

            if form_data.feedback_field_name and grade_data.feedback is not None:
                payload[form_data.feedback_field_name] = grade_data.feedback

            if form_data.notice_field_name and grade_data.notice is not None:
                payload[form_data.notice_field_name] = grade_data.notice

            if form_data.submit_button_name:
                payload[form_data.submit_button_name] = form_data.submit_button_value or "Speichern"

            # Ensure command is saveStatus or saveStatusAll
            if "cmd[saveStatus]" not in payload and "cmd[saveStatusAll]" not in payload:
                payload["cmd[saveStatus]"] = "Speichern"

            target_action = form_data.action_url or exercise_url

            # 4. Send POST request
            post_resp = await client.post(target_action, data=payload)
            self._check_response_for_session_loss(post_resp, target_action)

            # 5. Verify success
            success, message = verify_grading_success(post_resp.text)
            if not success:
                logger.warning(f"Grading submission for member {grade_data.member_id} may not have verified: {message}")

            return GradeSubmissionResponse(
                success=success,
                message=message,
                member_id=grade_data.member_id,
            )

    async def stream_download(
        self, download_url: str
    ) -> Tuple[AsyncGenerator[bytes, None], Dict[str, str], int]:
        """
        Stream a file download from ILIAS through the authenticated client.
        Returns (stream_generator, headers_dict, status_code).
        """
        self._ensure_authenticated()
        client = self.session_manager.get_http_client()

        # Build full URL if relative
        full_url = urllib.parse.urljoin(settings.ilias_base_url, download_url)

        req = client.build_request("GET", full_url)
        resp = await client.send(req, stream=True)

        if resp.status_code >= 400:
            await resp.aclose()
            await client.aclose()
            raise ValueError(f"ILIAS returned error {resp.status_code} for download {full_url}")

        filtered_headers = {
            "Content-Type": resp.headers.get("content-type", "application/octet-stream"),
            "Content-Disposition": resp.headers.get(
                "content-disposition", 'attachment; filename="downloaded_file"'
            ),
        }
        if "content-length" in resp.headers:
            filtered_headers["Content-Length"] = resp.headers["content-length"]

        async def file_generator() -> AsyncGenerator[bytes, None]:
            try:
                async for chunk in resp.aiter_bytes(chunk_size=65536):
                    yield chunk
            finally:
                await resp.aclose()
                await client.aclose()

        return file_generator(), filtered_headers, resp.status_code


# Default singleton instance
ilias_client = IliasClient()

