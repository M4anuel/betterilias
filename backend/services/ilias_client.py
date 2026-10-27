import asyncio
from backend.i18n import t
import logging
import re
import urllib.parse
from contextlib import nullcontext
from typing import Any, AsyncGenerator, Dict, List, Optional, Tuple

from bs4 import BeautifulSoup
import httpx

from backend.auth.session import SessionManager, session_manager
from backend.config import settings
from backend.services.assignment_multipart import encode_assignment_form
from backend.services.authoring import AuthoringMixin
from backend.services.management import ManagementMixin
from backend.scrapers.dumper import dump_failed_html
from backend.schemas import RepositoryResponse
from backend.scrapers.repository import parse_repository
from backend.schemas import MembershipFormResponse, MembershipRequest, MembershipResult
from backend.scrapers.membership import membership_link, parse_membership, prepare_membership_form
from backend.scrapers.materials import _extract_breadcrumbs
from backend.scrapers.submissions import parse_student_submission_navigation, parse_student_upload_errors, parse_native_file_upload_form
from backend.scrapers.exercise_editor import (
    build_ta_assignment_payload, validate_ta_assignment_request, parse_ta_assignment_error,
    parse_ta_assignment_delete_form,
)
from backend.schemas import (
    AuthStatus,
    CourseLogsResponse,
    CourseMaterialsResponse,
    CourseUserCandidate,
    DashboardResponse,
    ExerciseOverviewResponse,
    ExerciseSubmissionsResponse,
    ExerciseInfoResponse,
    GradeSubmissionRequest,
    GradeSubmissionResponse,
    MaterialItem,
    PodcastSeriesResponse,
    SemesterScreenResponse,
    StudentAssignmentDetail,
    FeedbackFilesResponse,
    TeamCandidatesResponse,
    TeamMemberInfo,
    TAAssignmentDetailResponse,
    TAAssignmentListItem,
    TAAssignmentListResponse,
    TAInstructionFileItem,
    AssignmentOrderUpdateRequest,
    SaveTAAssignmentRequest,
)
from backend.scrapers import (
    extract_grading_form,
    extract_feedback_modal_form,
    parse_course_logs,
    parse_course_materials,
    parse_course_users_list_screen,
    parse_dashboard,
    parse_exercise_info,
    parse_exercise_overview,
    parse_exercise_submissions,
    parse_feedback_files,
    parse_podcast_series,
    parse_remove_team_confirmation_screen,
    parse_semester_courses,
    parse_student_assignment_detail,
    parse_student_submitted_files_screen,
    parse_student_upload_form,
    parse_team_management_screen,
    ParsedTeamManagementScreen,
    verify_grading_success,
    parse_ta_assignments_list,
    parse_ta_assignment_form,
    parse_instruction_files,
)
from backend.services.semester_utils import (
    generate_semester_list,
    get_current_semester,
)

logger = logging.getLogger("ilias.service")


class SessionExpiredError(Exception):
    """Raised when an ILIAS request detects that the user session is expired or invalid."""
    pass


class AssignmentDeletionError(Exception):
    def __init__(self, message: str, status_code: int = 502):
        super().__init__(message)
        self.status_code = status_code


class StudentUploadError(Exception):
    """An upload failed or could not be confirmed; never report it as success."""
    def __init__(self, message: str, status_code: int = 502):
        super().__init__(message)
        self.status_code = status_code


class IliasClient(AuthoringMixin, ManagementMixin):
    """High-level async client for interacting with Uni Bern ILIAS."""

    # Class-level cache of course participants per exercise_ref_id for enriching team member names
    _course_user_cache: Dict[str, List[CourseUserCandidate]] = {}
    # Class-level cache of exercise cmdNode prefix per ref_id
    _exercise_cmd_nodes: Dict[str, str] = {}

    def _get_exercise_base_node(self, ref_id: str) -> str:
        """Returns the cached ILIAS cmdNode prefix for an exercise ref_id, defaulting to 'dc:o5'."""
        return self._exercise_cmd_nodes.get(ref_id, "dc:o5")

    def _cache_exercise_cmd_nodes_from_html(self, ref_id: str, html: str, url: Optional[str] = None):
        """Scrapes and caches the cmdNode prefix for an exercise from its page HTML or URL."""
        if url:
            m = re.search(r'''cmdNode=([^&"']+).*?cmdClass=ilObjExerciseGUI''', url)
            if m:
                self._exercise_cmd_nodes[ref_id] = m.group(1)
                return
        m_show = re.search(r'''cmdNode=([^&"']+).*?cmdClass=ilObjExerciseGUI.*?cmd=showOverview''', html)
        if m_show:
            self._exercise_cmd_nodes[ref_id] = m_show.group(1)
            return
        m_obj = re.search(r'''cmdNode=([^&"']+).*?cmdClass=ilObjExerciseGUI''', html)
        if m_obj:
            self._exercise_cmd_nodes[ref_id] = m_obj.group(1)
            return
        m_eh = re.search(r'''baseClass=ilexercisehandlergui.*?cmdNode=([^:&"']+:[^:&"']+)''', html)
        if m_eh:
            self._exercise_cmd_nodes[ref_id] = m_eh.group(1)

    def __init__(self, manager: Optional[SessionManager] = None):
        self.session_manager = manager or session_manager

    def _ensure_authenticated(self):
        """Check if cookies exist."""
        if not self.session_manager.has_cookies():
            raise SessionExpiredError(t('No active ILIAS session found. Please log in.'))

    def _check_response_for_session_loss(self, response: httpx.Response, requested_url: str):
        """Detect if ILIAS redirected to a login page, expired session, or unauthorized error."""
        # 1. HTTP 401 Unauthorized or 403 Forbidden
        if response.status_code in (401, 403):
            raise SessionExpiredError(
                t('HTTP {p0} Unauthorized for {p1}', p0=response.status_code, p1=requested_url)
            )

        # 2. Redirect to login or IDP endpoints
        final_url = str(response.url).lower()
        login_url_tokens = [
            "login.php",
            "wayf",
            "eduid",
            "aai",
            "shibboleth",
            "cmd=force_login",
            "shib_login",
        ]
        if any(token in final_url for token in login_url_tokens):
            raise SessionExpiredError(
                t('Session expired or unauthorized. Redirected to login ({p0}) from {p1}.', p0=response.url, p1=requested_url)
            )

        # 3. HTML text & link markers
        text_lower = response.text.lower()

        # Explicit force_login command or login prompt target in HTML
        if (
            "cmd=force_login" in text_lower
            or "login.php?client_id=" in text_lower
            or "login.php?target=" in text_lower
            or "shib_login.php" in text_lower
        ):
            raise SessionExpiredError(
                t('Session expired: ILIAS login prompt detected for {p0}.', p0=requested_url)
            )

        # Check for HTML login form or startup section
        if "<input" in response.text and 'name="username"' in response.text and 'name="password"' in response.text:
            raise SessionExpiredError(t('Session expired: ILIAS login form encountered.'))
        if "ilstartupsection" in text_lower or "ilstartupframe" in text_lower:
            raise SessionExpiredError(t('Session expired: ILIAS startup screen encountered.'))

        # 4. Check for positive indicators of an authenticated ILIAS session FIRST
        soup = BeautifulSoup(response.text, "html.parser")
        has_auth_indicator = bool(
            soup.select_one(".il-maincontrols-metabar a.il-user-avatar")
            or soup.select_one("#il_mbt_usr")
            or soup.select_one(".ilTopTitle")
            or soup.select_one("span.il-avatar-initials")
            or soup.select_one("a.il-user-avatar")
            or soup.select_one(".il-view-content")
            or soup.select_one("#il_mbt_pdesk")
            or soup.select_one("#ilTab")
            or soup.find(id="mainspace")
            or soup.select_one(".il-item-group")
        )

        if has_auth_indicator:
            # User is authenticated! Do not treat course badges / archived notices as session loss.
            return

        # 5. If no auth indicator exists, check for explicit error page markers
        og_title = soup.find("meta", property="og:title")
        og_title_content = og_title.get("content", "").lower() if og_title else ""

        unauth_phrases = [
            "kein zugriffsrecht",
            "sitzung abgelaufen",
            "ihre sitzung ist abgelaufen",
            "sie sind nicht angemeldet",
            "session expired",
            "your session has expired",
            "you are not logged in",
        ]
        if "kein zugriffsrecht" in og_title_content or any(phrase in text_lower for phrase in unauth_phrases):
            raise SessionExpiredError(
                t('Session expired or unauthorized detected for {p0}.', p0=requested_url)
            )

    async def get_auth_status(self) -> AuthStatus:
        """Check current authentication status."""
        has_cookies = self.session_manager.has_cookies()
        if not has_cookies:
            return AuthStatus(
                authenticated=False,
                client_id=settings.ilias_client_id,
                cookies_present=False,
                message=t('No cookies stored.'),
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

        current_sem = get_current_semester()
        target_sem = semester or current_sem
        sem_list = generate_semester_list(target_sem=target_sem, current_sem=current_sem)

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

    async def get_repository(self, ref_id: str) -> RepositoryResponse:
        self._ensure_authenticated()
        url = f"{settings.ilias_base_url}/ilias.php?baseClass=ilRepositoryGUI&ref_id={ref_id}"
        async with self.session_manager.get_http_client() as client:
            resp = await client.get(url)
            self._check_response_for_session_loss(resp, url)
            resp.raise_for_status()
            return parse_repository(resp.text, container_ref_id=ref_id)

    async def get_course_materials(self, ref_id: str) -> CourseMaterialsResponse:
        """Fetch and parse course or folder repository contents."""
        self._ensure_authenticated()
        # ILIAS supports baseClass=ilRepositoryGUI&ref_id=X or goto_ilias3_unibe_crs_X.html
        # Append crs_prev_sess=1 so ILIAS returns ALL sessions (previous and current/upcoming)
        url = f"{settings.ilias_base_url}/ilias.php?baseClass=ilRepositoryGUI&ref_id={ref_id}&crs_prev_sess=1"

        async with self.session_manager.get_http_client() as client:
            resp = await client.get(url)
            self._check_response_for_session_loss(resp, url)
            html_content = resp.text
            if "streamVideo" in html_content or "xoctPlayerGUI" in html_content:
                html_content = await self._resolve_opencast_videos_in_html(html_content, client, ref_id)
            parsed = parse_course_materials(html_content, container_ref_id=ref_id)
            # Some unjoined courses expose Join only in their parent category.
            if not parsed.items and not parsed.membership.can_join and not parsed.membership.can_leave:
                parent = next((b for b in reversed(parsed.breadcrumbs) if b.ref_id != ref_id and b.url and '/go/cat/' in b.url), None)
                if parent:
                    listing = await client.get(f"{settings.ilias_base_url}/ilias.php?baseClass=ilRepositoryGUI&ref_id={parent.ref_id}")
                    self._check_response_for_session_loss(listing, str(listing.url))
                    listing.raise_for_status()
                    parsed.membership = parse_membership(BeautifulSoup(listing.text, 'lxml'), ref_id)
                    parsed.is_enrolled = parsed.membership.is_enrolled
            return parsed


    async def resolve_video_stream(self, video_url: str) -> dict:
        """Resolve an Opencast streamVideo / Paella URL to MP4 stream and metadata."""
        self._ensure_authenticated()
        full_url = video_url if video_url.startswith("http") else f"{settings.ilias_base_url}/{video_url.lstrip('/')}"
        async with self.session_manager.get_http_client() as client:
            try:
                resp = await client.get(full_url)
                mp4_m = re.search(r'"src":"(https?:\\/\\/[^"]+?\.mp4)"', resp.text)
                prev_m = re.search(r'"preview":"(https?:\\/\\/[^"]+?)"', resp.text)
                title_m = re.search(r'"title":"([^"]+)"', resp.text)
                dur_m = re.search(r'"duration":(\d+)', resp.text)

                mp4_url = mp4_m.group(1).replace(r"\/", "/") if mp4_m else None
                preview_url = prev_m.group(1).replace(r"\/", "/") if prev_m else None
                title = title_m.group(1) if title_m else None
                duration = int(dur_m.group(1)) // 1000 if dur_m else None

                return {
                    "mp4_url": mp4_url,
                    "preview_url": preview_url,
                    "title": title,
                    "duration": duration,
                    "video_url": video_url,
                    "fallback_url": full_url,
                }
            except Exception as e:
                logger.warning(f"Failed to resolve video stream {video_url}: {e}")
                return {
                    "mp4_url": None,
                    "preview_url": None,
                    "title": None,
                    "duration": None,
                    "video_url": video_url,
                    "fallback_url": full_url,
                }

    async def _resolve_opencast_videos_in_html(self, html_content: str, client: httpx.AsyncClient, container_ref_id: str) -> str:
        """Pre-resolve all Opencast streamVideo iframes concurrently into native video player elements."""
        soup = BeautifulSoup(html_content, "html.parser")
        stream_iframes = [
            ifr for ifr in soup.find_all("iframe")
            if ifr.get("src") and ("streamVideo" in ifr.get("src") or "xoctPlayerGUI" in ifr.get("src"))
        ]
        if not stream_iframes:
            return html_content

        ilias_folder_url = (
            f"{settings.ilias_base_url}/ilias.php?baseClass=ilrepositorygui&cmdNode=yv:oj&cmdClass=ilobjfoldergui&ref_id={container_ref_id}&item_ref_id=0"
            if container_ref_id
            else settings.ilias_base_url
        )

        async def fetch_video_data(ifr):
            src = ifr.get("src")
            full_src = src if src.startswith("http") else f"{settings.ilias_base_url}/{src.lstrip('/')}"
            try:
                r = await client.get(full_src)
                mp4_m = re.search(r'"src":"(https?:\\/\\/[^"]+?\.mp4)"', r.text)
                prev_m = re.search(r'"preview":"(https?:\\/\\/[^"]+?)"', r.text)
                title_m = re.search(r'"title":"([^"]+)"', r.text)
                dur_m = re.search(r'"duration":(\d+)', r.text)
                if mp4_m:
                    return (
                        ifr,
                        mp4_m.group(1).replace(r"\/", "/"),
                        prev_m.group(1).replace(r"\/", "/") if prev_m else None,
                        title_m.group(1) if title_m else None,
                        int(dur_m.group(1)) // 1000 if dur_m else None,
                    )
            except Exception as e:
                logger.warning(f"Error pre-resolving video {src}: {e}")
            return (ifr, None, None, None, None)

        results = await asyncio.gather(*[fetch_video_data(ifr) for ifr in stream_iframes])
        for ifr, mp4_url, preview_url, title, duration in results:
            target_container = ifr.parent if ifr.parent and "ocpc-container" in ifr.parent.get("class", []) else ifr
            if mp4_url:
                poster_attr = f'poster="{preview_url}"' if preview_url else ""
                dur_str = f"{duration // 60:02d}:{duration % 60:02d}" if duration else ""
                title_text = f"{title} ({dur_str})" if (title and dur_str) else (title or t('video.tutorial'))
                unsupported_txt = t('video.unsupported')
                view_txt = t('video.view_on_ilias')
                player_html = f'''<div class="betterilias-video-player-container my-3" style="max-width: 960px;">
  <video controls playsinline preload="metadata" {poster_attr} class="w-full aspect-video rounded-xl bg-black shadow-md border border-slate-800">
    <source src="{mp4_url}" type="video/mp4" />
    {unsupported_txt}
  </video>
  <div class="betterilias-video-caption flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 mt-2 px-1">
    <span class="font-medium truncate">{title_text}</span>
    <a href="{ilias_folder_url}" target="_blank" rel="noreferrer" class="inline-flex items-center gap-1 text-sky-600 hover:text-sky-500 font-semibold hover:underline shrink-0">
      <span>{view_txt}</span>
      <svg class="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
    </a>
  </div>
</div>'''
                target_container.replace_with(BeautifulSoup(player_html, "html.parser").div)
            else:
                src = ifr.get("src", "")
                full_src = src if src.startswith("http") else f"{settings.ilias_base_url}/{src.lstrip('/')}"
                title_txt = t('video.tutorial')
                desc_txt = t('video.opencast_player')
                open_txt = t('video.open_on_ilias')
                card_html = f'''<div class="betterilias-video-player-container my-3" data-video-stream-url="{full_src}" style="max-width: 960px;">
  <div class="betterilias-video-placeholder ocpc-video-card" data-video-url="{full_src}">
    <div class="betterilias-video-inner">
      <div class="betterilias-video-play-btn">
        <svg viewBox="0 0 24 24" fill="currentColor" width="28" height="28"><polygon points="6 4 20 12 6 20 6 4"></polygon></svg>
      </div>
      <div class="betterilias-video-info">
        <span class="betterilias-video-title">{title_txt}</span>
        <span class="betterilias-video-desc">{desc_txt}</span>
      </div>
      <a href="{ilias_folder_url}" target="_blank" rel="noreferrer" class="betterilias-video-btn">
        <span>{open_txt}</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
      </a>
    </div>
  </div>
</div>'''
                target_container.replace_with(BeautifulSoup(card_html, "html.parser").div)

        return str(soup)

    def _validate_membership_url(self, url: str, ref_id: str):
        base = urllib.parse.urlparse(settings.ilias_base_url)
        target = urllib.parse.urlparse(url)
        if (target.scheme, target.netloc) != (base.scheme, base.netloc):
            raise ValueError(t('Ungültiges ILIAS-Kursziel'))
        if urllib.parse.parse_qs(target.query).get('ref_id') != [ref_id]:
            raise ValueError(t('Die Kursaktion gehört nicht zum ausgewählten Kurs'))

    async def _prepare_course_membership(self, client, ref_id: str, action: str):
        root_url = f"{settings.ilias_base_url}/ilias.php?baseClass=ilRepositoryGUI&ref_id={ref_id}"
        response = await client.get(root_url)
        self._check_response_for_session_loss(response, root_url)
        response.raise_for_status()
        prepared = prepare_membership_form(response.text, ref_id, action)
        if prepared:
            self._validate_membership_url(prepared.url, ref_id)
            return prepared, root_url
        soup = BeautifulSoup(response.text, 'lxml')
        link = membership_link(soup, ref_id, action)
        if not link and action == 'join':
            parent = next((b for b in reversed(_extract_breadcrumbs(soup)) if b.ref_id != ref_id and b.url and '/go/cat/' in b.url), None)
            if parent:
                listing_url = f"{settings.ilias_base_url}/ilias.php?baseClass=ilRepositoryGUI&ref_id={parent.ref_id}"
                listing = await client.get(listing_url)
                self._check_response_for_session_loss(listing, listing_url)
                listing.raise_for_status()
                link = membership_link(BeautifulSoup(listing.text, 'lxml'), ref_id, action)
        if not link:
            raise ValueError(t('ILIAS bietet diese Kursaktion aktuell nicht an. Die Anmeldung wird möglicherweise über KSL verwaltet.'))
        self._validate_membership_url(link, ref_id)
        response = await client.get(link)
        self._check_response_for_session_loss(response, link)
        response.raise_for_status()
        prepared = prepare_membership_form(response.text, ref_id, action)
        if prepared:
            self._validate_membership_url(prepared.url, ref_id)
        return prepared, link

    async def get_membership_form(self, ref_id: str, action: str) -> MembershipFormResponse:
        self._ensure_authenticated()
        async with self.session_manager.get_http_client() as client:
            prepared, source = await self._prepare_course_membership(client, ref_id, action)
        available = bool(prepared and prepared.supported)
        message = prepared.message if prepared else ''
        if not available:
            message = t('Bitte schliesse diese Kursaktion direkt in ILIAS ab.')
        return MembershipFormResponse(
            action=action, available=available, message=message,
            fields=prepared.fields if available else [], ilias_url=source,
        )

    async def change_course_membership(self, ref_id: str, request: MembershipRequest) -> MembershipResult:
        self._ensure_authenticated()
        async with self.session_manager.get_http_client() as client:
            # Fetch fresh form tokens and recheck that ILIAS still allows the action.
            prepared, _ = await self._prepare_course_membership(client, ref_id, request.action)
            if not prepared or not prepared.supported:
                raise ValueError(t('Diese Kursaktion muss direkt in ILIAS abgeschlossen werden.'))
            allowed = {f.name for f in prepared.fields}
            if set(request.values) - allowed:
                raise ValueError(t('Unbekannte Felder in der Kursanmeldung'))
            payload = dict(prepared.payload)
            for field in prepared.fields:
                value = request.values.get(field.name, '')
                if field.required and not value:
                    raise ValueError(t('Bitte fülle das Feld «{p0}» aus.', p0=field.label))
                if field.field_type == 'checkbox':
                    if value:
                        payload[field.name] = field.value
                else:
                    payload[field.name] = value
            response = await client.post(prepared.url, data=payload)
            self._check_response_for_session_loss(response, prepared.url)
            response.raise_for_status()
            result_soup = BeautifulSoup(response.text, 'lxml')
            error = result_soup.select_one('.alert-danger, .il-failure, .ilFailureMessage')
            if error:
                raise ValueError(error.get_text(' ', strip=True))
            success = result_soup.select_one('.alert-success, .il-success, .ilSuccessMessage')
            # Leaving may immediately revoke read access to the course. The native
            # success message confirms the action without another protected read.
            if request.action == 'leave' and success is not None:
                return MembershipResult(success=True, is_enrolled=False, message=success.get_text(' ', strip=True))
            root_url = f"{settings.ilias_base_url}/ilias.php?baseClass=ilRepositoryGUI&ref_id={ref_id}"
            root = await client.get(root_url)
            self._check_response_for_session_loss(root, root_url)
            root.raise_for_status()
            state = parse_membership(BeautifulSoup(root.text, 'lxml'), ref_id)
            expected = request.action == 'join'
            if state.is_enrolled is not expected and success is None:
                raise ValueError(t('ILIAS hat die Kursaktion nicht bestätigt. Bitte prüfe den Kurs in ILIAS.'))
            return MembershipResult(
                success=True, is_enrolled=state.is_enrolled,
                message=success.get_text(' ', strip=True) if success else (t('Kurs beigetreten.') if expected else t('Kurs verlassen.')),
            )

    async def get_session_materials(
        self,
        course_ref_id: str,
        session_ref_id: str,
        expand_id: Optional[str] = None,
    ) -> List[MaterialItem]:
        """
        Fetch materials attached to a specific session (especially when collapsed on ILIAS by default).
        Uses the expand=<expand_id> parameter or session infoScreen.
        """
        self._ensure_authenticated()
        async with self.session_manager.get_http_client() as client:
            # Strategy 1: Expand session directly on course view
            if expand_id:
                clean_expand = expand_id.lstrip("-")
                url = (
                    f"{settings.ilias_base_url}/ilias.php?"
                    f"baseClass=ilRepositoryGUI&ref_id={course_ref_id}&expand={clean_expand}&crs_prev_sess=1"
                )
                resp = await client.get(url)
                self._check_response_for_session_loss(resp, url)
                parsed = parse_course_materials(resp.text, container_ref_id=course_ref_id)
                for sess in parsed.sessions or []:
                    if sess.ref_id == session_ref_id or (sess.expand_id and sess.expand_id.lstrip("-") == clean_expand):
                        if sess.materials:
                            return sess.materials

            # Strategy 2: Fetch session infoScreen / direct session repo page
            session_urls = [
                f"{settings.ilias_base_url}/ilias.php?baseClass=ilrepositorygui&cmd=infoScreen&ref_id={session_ref_id}",
                f"{settings.ilias_base_url}/ilias.php?baseClass=ilRepositoryGUI&ref_id={session_ref_id}",
            ]
            for s_url in session_urls:
                try:
                    resp = await client.get(s_url)
                    self._check_response_for_session_loss(resp, s_url)
                    parsed = parse_course_materials(resp.text, container_ref_id=session_ref_id)
                    if parsed.items:
                        return parsed.items
                except Exception:
                    continue

            return []


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

    async def get_exercise_submissions(self, ref_id: str, ass_id: Optional[str] = None, include_ilias_order: bool = False) -> ExerciseSubmissionsResponse:
        """Fetch and parse exercise participant submissions list (TA grading view)."""
        self._ensure_authenticated()
        extra = f"&ass_id={ass_id}&member_id=0&part_id=0" if ass_id else ""
        urls_to_try = [
            f"{settings.ilias_base_url}/ilias.php?baseClass=ilexercisehandlergui&cmdNode=dc:o5:dd&cmdClass=ilExerciseManagementGUI&cmd=members&ref_id={ref_id}{extra}",
            f"{settings.ilias_base_url}/ilias.php?baseClass=ilexercisehandlergui&cmdNode=dc:o5:dd&cmdClass=ilexercisemanagementgui&cmd=members&ref_id={ref_id}{extra}",
            f"{settings.ilias_base_url}/ilias.php?baseClass=ilexercisehandlergui&cmdClass=ilexercisemanagementgui&cmd=members&ref_id={ref_id}{extra}",
            f"{settings.ilias_base_url}/ilias.php?baseClass=ilExerciseHandlerGUI&ref_id={ref_id}&cmd=viewMembers{extra}",
            f"{settings.ilias_base_url}/ilias.php?cmdClass=ilobjexercisegui&cmd=viewMembers&ref_id={ref_id}{extra}",
            f"{settings.ilias_base_url}/ilias.php?ref_id={ref_id}&cmd=viewMembers{extra}",
        ]

        async with self.session_manager.get_http_client() as client:
            last_resp = None
            for url in urls_to_try:
                resp = await client.get(url)
                self._check_response_for_session_loss(resp, url)
                last_resp = resp
                # If we hit the members submissions table
                if "exc_mem" in resp.text:
                    result = parse_exercise_submissions(resp.text, exercise_ref_id=ref_id)
                    if include_ilias_order:
                        await self._load_ilias_sort_names(client, result)
                    return result

            if last_resp:
                result = parse_exercise_submissions(last_resp.text, exercise_ref_id=ref_id)
                if include_ilias_order:
                    await self._load_ilias_sort_names(client, result)
                return result

            raise ValueError(t('Failed to fetch exercise with ref_id {p0}', p0=ref_id))

    async def _load_ilias_sort_names(self, client: httpx.AsyncClient, result: ExerciseSubmissionsResponse) -> None:
        """Use the native evaluation-file recipient, which can differ from the first team member."""
        # Limit requests to avoid flooding ILIAS for large assignment tables.
        semaphore = asyncio.Semaphore(4)

        async def load(submission):
            if not submission.evaluation_by_file_url:
                if not submission.team_id:
                    submission.feedback_recipient_surname = submission.student_name.partition(",")[0].strip()
                return
            url = urllib.parse.urlparse(submission.evaluation_by_file_url)
            base_url = urllib.parse.urlparse(settings.ilias_base_url)
            if (url.scheme, url.netloc) != (base_url.scheme, base_url.netloc):
                raise ValueError("Unexpected evaluation-by-file origin")
            async with semaphore:
                response = await client.get(submission.evaluation_by_file_url)
                self._check_response_for_session_loss(response, submission.evaluation_by_file_url)
                response.raise_for_status()
                recipient = parse_feedback_files(response.text).student_name
                if recipient and "," in recipient:
                    submission.feedback_recipient_surname = recipient.partition(",")[0].strip() or None

        await asyncio.gather(*(load(submission) for submission in result.submissions))

    async def get_exercise_overview(self, ref_id: str, mode: str = "all") -> ExerciseOverviewResponse:
        """Fetch and parse exercise overview and sub-assignments (showOverview) with mode=all by default."""
        self._ensure_authenticated()
        base_node = self._get_exercise_base_node(ref_id)
        url = (
            f"{settings.ilias_base_url}/ilias.php?"
            f"baseClass=ilexercisehandlergui&cmdNode={base_node}&cmdClass=ilObjExerciseGUI&cmd=showOverview&ref_id={ref_id}&mode={mode}&from_overview=1"
        )
        async with self.session_manager.get_http_client() as client:
            resp = await client.get(url)
            self._check_response_for_session_loss(resp, url)
            # If default node failed or showed nothing, attempt canonical resolution via goto.php
            if resp.status_code != 200 or ("showOverview" not in resp.text and "ilObjExerciseGUI" not in resp.text):
                goto_url = f"{settings.ilias_base_url}/goto.php?target=exc_{ref_id}"
                goto_resp = await client.get(goto_url)
                if goto_resp.status_code == 200:
                    resp = goto_resp
                    url = str(goto_resp.url)
            self._cache_exercise_cmd_nodes_from_html(ref_id, resp.text, url=str(resp.url))
            return parse_exercise_overview(resp.text, exercise_ref_id=ref_id)

    async def get_exercise_info(self, ref_id: str) -> ExerciseInfoResponse:
        """Fetch and parse exercise info screen (showSummary)."""
        self._ensure_authenticated()
        base_node = self._get_exercise_base_node(ref_id)
        url = (
            f"{settings.ilias_base_url}/ilias.php?"
            f"baseClass=ilexercisehandlergui&cmdNode={base_node}:ft&cmdClass=ilinfoscreengui&cmd=showSummary&ref_id={ref_id}"
        )
        async with self.session_manager.get_http_client() as client:
            resp = await client.get(url)
            self._check_response_for_session_loss(resp, url)
            return parse_exercise_info(resp.text, ref_id=ref_id)

    async def get_student_assignment_detail(
        self, ref_id: str, ass_id: str, *, presentation_url: Optional[str] = None,
        http_client: Optional[httpx.AsyncClient] = None,
    ) -> StudentAssignmentDetail:
        """Fetch and parse the student assignment presentation screen, team details, and submitted files screen."""
        self._ensure_authenticated()
        base_node = self._get_exercise_base_node(ref_id)
        url = presentation_url or (
            f"{settings.ilias_base_url}/ilias.php?"
            f"baseClass=ilexercisehandlergui&cmdNode={base_node}:5n&cmdClass=ilAssignmentPresentationGUI&ref_id={ref_id}&ass_id={ass_id}&mode=all&from_overview=1"
        )
        async with (nullcontext(http_client) if http_client is not None else self.session_manager.get_http_client()) as client:
            resp = await client.get(url)
            self._check_response_for_session_loss(resp, url)
            self._cache_exercise_cmd_nodes_from_html(ref_id, resp.text, url=str(resp.url))
            detail = parse_student_assignment_detail(resp.text, exercise_ref_id=ref_id, ass_id=ass_id)

            # Enrich team_member_details with ILIAS user IDs from submissionScreenTeam if a team exists
            if detail.manage_team_url or detail.team_members:
                team_url = detail.manage_team_url or (
                    f"{settings.ilias_base_url}/ilias.php?"
                    f"baseClass=ilexercisehandlergui&cmdNode={base_node}:5n:d2:d4&cmdClass=ilExSubmissionTeamGUI&cmd=submissionScreenTeam"
                    f"&ref_id={ref_id}&ass_id={ass_id}"
                )
                try:
                    team_resp = await client.get(team_url)
                    self._check_response_for_session_loss(team_resp, team_url)
                    if team_resp.status_code == 200:
                        team_screen = parse_team_management_screen(team_resp.text, base_url=settings.ilias_base_url)
                        if team_screen.members:
                            detail.team_member_details = team_screen.members
                            detail.team_members = [m.login for m in team_screen.members]
                except SessionExpiredError:
                    raise
                except Exception as te:
                    logger.debug(f"Could not fetch team management screen for {ref_id}/{ass_id}: {te}")

            # Enrich member full names from cached course user directory if available
            cached_candidates = self._course_user_cache.get(ref_id)
            if cached_candidates and detail.team_member_details:
                by_uid = {c.user_id: c for c in cached_candidates if c.user_id}
                by_login = {c.login.lower(): c for c in cached_candidates if c.login}
                for m in detail.team_member_details:
                    cand = (by_uid.get(m.user_id) if m.user_id else None) or by_login.get(m.login.lower())
                    if cand:
                        if not m.name and cand.full_name:
                            m.name = cand.full_name
                        if not m.user_id and cand.user_id:
                            m.user_id = cand.user_id
                        if cand.is_self:
                            m.is_self = True

            # Check if there is an active submissionScreen with direct download links
            sub_url = detail.submission_screen_url or (
                f"{settings.ilias_base_url}/ilias.php?"
                f"baseClass=ilexercisehandlergui&cmdNode={base_node}:5n:d2:d1&cmdClass=ilExSubmissionFileGUI&cmd=submissionScreen"
                f"&ref_id={ref_id}&ass_id={ass_id}&mode=all&from_overview=1"
            )
            try:
                sub_resp = await client.get(sub_url)
                self._check_response_for_session_loss(sub_resp, sub_url)
                if sub_resp.status_code == 200:
                    sub_files, last_sub = parse_student_submitted_files_screen(sub_resp.text, base_url=settings.ilias_base_url)
                    detail.submitted_files = sub_files
                    if sub_files:
                        detail.submission_status = "submitted"
                        if last_sub:
                            detail.last_submission = last_sub
            except SessionExpiredError:
                raise
            except Exception as e:
                logger.debug(f"Could not fetch student submission screen: {e}")

            return detail

    async def upload_student_assignment_file(
        self,
        exercise_ref_id: str,
        ass_id: str,
        filename: str,
        file_bytes: bytes,
        content_type: str = "application/octet-stream",
    ) -> StudentAssignmentDetail:
        """Follow live assignment links and reproduce ILIAS's two-stage upload."""
        import uuid

        self._ensure_authenticated()

        def validated_url(url: str) -> str:
            expected = urllib.parse.urlparse(settings.ilias_base_url)
            target = urllib.parse.urlparse(url)
            query = urllib.parse.parse_qs(target.query)
            if ((target.scheme, target.netloc) != (expected.scheme, expected.netloc)
                    or query.get('ref_id') != [exercise_ref_id] or query.get('ass_id') != [ass_id]):
                raise StudentUploadError(t('upload.invalid_target'))
            return url

        def check_response(response: httpx.Response, url: str):
            self._check_response_for_session_loss(response, url)
            if not response.is_success:
                raise StudentUploadError(t('upload.http_error', status=response.status_code))

        async with self.session_manager.get_http_client() as client:
            # Controller nodes belong to the current user's navigation context,
            # not to the course's folder path. Never gate discovery on the shared cache.
            exercise_url = f"{settings.ilias_base_url}/goto.php?" + urllib.parse.urlencode({'target': f'exc_{exercise_ref_id}'})
            response = await client.get(exercise_url)
            check_response(response, exercise_url)
            links = parse_student_submission_navigation(response.text, exercise_ref_id, ass_id, str(response.url))
            presentation_url = links.get('presentation')
            if presentation_url:
                response = await client.get(validated_url(presentation_url))
                check_response(response, presentation_url)
                links.update(parse_student_submission_navigation(response.text, exercise_ref_id, ass_id, str(response.url)))
            if 'upload' not in links and 'submission' in links:
                response = await client.get(validated_url(links['submission']))
                check_response(response, links['submission'])
                links.update(parse_student_submission_navigation(response.text, exercise_ref_id, ass_id, str(response.url)))
            presentation_url = presentation_url or links.get('presentation')
            if not links.get('upload'):
                raise StudentUploadError(parse_student_upload_errors(response.text) or t('upload.unavailable'), 409)

            form_resp = await client.get(validated_url(links['upload']))
            check_response(form_resp, links['upload'])
            if error := parse_student_upload_errors(form_resp.text):
                raise StudentUploadError(error, 400)
            form = parse_student_upload_form(form_resp.text, base_url=str(form_resp.url))
            if not all((form.upload_url, form.form_action, form.token_input_name, form.file_identifier)):
                raise StudentUploadError(t('upload.form_missing'))
            upload_url, form_action = validated_url(form.upload_url), validated_url(form.form_action)
            if form.disabled or (form.max_files is not None and form.current_files >= form.max_files):
                raise StudentUploadError(t('upload.unavailable'), 409)
            if form.max_size is not None and len(file_bytes) > form.max_size:
                raise StudentUploadError(t('upload.too_large', limit=form.max_size), 400)
            if form.chunked and (not form.chunk_size or form.chunk_size <= 0):
                raise StudentUploadError(t('upload.form_missing'))

            # ILIAS/Dropzone sends file[0] for multi-file inputs, file for single
            # or chunked inputs. A successful HTTP response alone is insufficient.
            chunk_size = form.chunk_size if form.chunked else max(1, len(file_bytes))
            chunk_count = max(1, (len(file_bytes) + chunk_size - 1) // chunk_size)
            upload_id, file_token = str(uuid.uuid4()), None
            for index in range(chunk_count):
                chunk_data = {}
                if form.chunked:
                    chunk_data = {'dzuuid': upload_id, 'dzchunkindex': str(index),
                                  'dztotalfilesize': str(len(file_bytes)), 'dzchunksize': str(chunk_size),
                                  'dztotalchunkcount': str(chunk_count), 'dzchunkbyteoffset': str(index * chunk_size)}
                upload_resp = await client.post(upload_url, data=chunk_data,
                    files={form.file_field: (filename, file_bytes[index * chunk_size:(index + 1) * chunk_size], content_type)},
                    headers={'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'Referer': str(form_resp.url)})
                check_response(upload_resp, upload_url)
                try:
                    result = upload_resp.json()
                except ValueError as exc:
                    raise StudentUploadError(t('upload.invalid_response')) from exc
                if not isinstance(result, dict):
                    raise StudentUploadError(t('upload.invalid_response'))
                if type(result.get('status')) is not int or result['status'] != 1:
                    message = result.get('message')
                    raise StudentUploadError(message if isinstance(message, str) and message.strip() else t('upload.rejected'), 400)
                file_token = result.get(form.file_identifier)
            if not isinstance(file_token, str) or not file_token.strip():
                raise StudentUploadError(t('upload.invalid_response'))

            # This is the dynamic hidden input populated by ILIAS's file widget.
            # Do not also send a scalar, bare [], or another copy of the binary.
            save_data = {**form.hidden_inputs, form.token_input_name: file_token}
            save_resp = await client.post(form_action, data=save_data, headers={'Referer': str(form_resp.url)})
            check_response(save_resp, form_action)
            if error := parse_student_upload_errors(save_resp.text):
                raise StudentUploadError(error, 400)

            detail = await self.get_student_assignment_detail(
                exercise_ref_id, ass_id, presentation_url=presentation_url, http_client=client)
            expected_names = {filename, file_token} if form.file_identifier == 'filename' else {filename}
            if not any(item.filename in expected_names and item.download_url for item in detail.submitted_files):
                raise StudentUploadError(t('upload.unconfirmed'), 409)
            return detail

    async def delete_student_assignment_file(
        self,
        exercise_ref_id: str,
        ass_id: str,
        delivered_id: str,
    ) -> StudentAssignmentDetail:
        """
        Deletes a student submission file from ILIAS.
        Executes the ILIAS deletion flow:
        1. Access the student submission screen (cmd=submissionScreen).
        2. Post cmd[confirmDeleteDelivered] with delivered[]: delivered_id.
        3. If confirmation screen is presented, submit cmd[deleteDelivered] to finalize deletion.
        4. Re-fetch and return updated student assignment details.
        """
        self._ensure_authenticated()
        base_node = self._get_exercise_base_node(exercise_ref_id)
        sub_url = (
            f"{settings.ilias_base_url}/ilias.php?"
            f"baseClass=ilexercisehandlergui&cmdNode={base_node}:5n:d2:d1&cmdClass=ilExSubmissionFileGUI&cmd=submissionScreen"
            f"&ref_id={exercise_ref_id}&ass_id={ass_id}&mode=all&from_overview=1"
        )
        async with self.session_manager.get_http_client() as client:
            resp = await client.get(sub_url)
            self._check_response_for_session_loss(resp, sub_url)

            soup = BeautifulSoup(resp.text, "lxml")
            table_form = soup.find("form", action=lambda a: bool(a and "ilExSubmissionFileGUI" in a)) or soup.find(
                "form", action=lambda a: bool(a and "cmd=post" in a)
            )
            form_action = (
                urllib.parse.urljoin(settings.ilias_base_url, table_form["action"])
                if table_form and table_form.has_attr("action")
                else (
                    f"{settings.ilias_base_url}/ilias.php?"
                    f"baseClass=ilexercisehandlergui&cmdNode=dc:o5:5n:d2:d1&cmdClass=ilExSubmissionFileGUI&cmd=post"
                    f"&ref_id={exercise_ref_id}&ass_id={ass_id}&mode=all"
                )
            )

            # Step 1: Request delete confirmation
            step1_data: Dict[str, Any] = {
                "delivered[]": str(delivered_id),
                "cmd[confirmDeleteDelivered]": "Delete",
            }
            if table_form:
                for inp in table_form.find_all("input", type="hidden"):
                    name = inp.get("name")
                    if name:
                        step1_data[name] = inp.get("value", "")

            logger.info(f"Submitting confirmDeleteDelivered for delivered_id {delivered_id} to {form_action}")
            step1_resp = await client.post(form_action, data=step1_data)
            logger.info(f"confirmDeleteDelivered response status: {step1_resp.status_code}")

            # Step 2: Confirm deletion if confirmation screen is returned
            step2_soup = BeautifulSoup(step1_resp.text, "lxml")
            confirm_form = step2_soup.find("form", action=lambda a: bool(a and "cmd=post" in a)) or step2_soup.find(
                "form", action=lambda a: bool(a and "ilExSubmissionFileGUI" in a)
            )
            if confirm_form:
                step2_action = (
                    urllib.parse.urljoin(settings.ilias_base_url, confirm_form["action"])
                    if confirm_form.has_attr("action")
                    else form_action
                )
                step2_data: Dict[str, Any] = {
                    "delivered[]": str(delivered_id),
                    "cmd[deleteDelivered]": "Delete",
                }
                for inp in confirm_form.find_all("input", type="hidden"):
                    name = inp.get("name")
                    if name:
                        step2_data[name] = inp.get("value", "")

                logger.info(f"Submitting final deleteDelivered to {step2_action}")
                step2_resp = await client.post(step2_action, data=step2_data)
                logger.info(f"final deleteDelivered status: {step2_resp.status_code}")
            else:
                direct_data = {
                    "delivered[]": str(delivered_id),
                    "cmd[deleteDelivered]": "Delete",
                }
                await client.post(form_action, data=direct_data)

        return await self.get_student_assignment_detail(exercise_ref_id, ass_id)

    async def create_student_team(
        self, exercise_ref_id: str, ass_id: str
    ) -> StudentAssignmentDetail:
        """
        Creates a student team for an exercise assignment in ILIAS (cmd=createTeam).
        Resolves the dynamic create_team_url from the assignment presentation page or uses the standard fallback,
        executes the team creation request, and returns the updated StudentAssignmentDetail.
        """
        self._ensure_authenticated()
        pres_url = (
            f"{settings.ilias_base_url}/ilias.php?"
            f"baseClass=ilexercisehandlergui&cmdNode=dc:o5:5n&cmdClass=ilAssignmentPresentationGUI"
            f"&ref_id={exercise_ref_id}&ass_id={ass_id}&mode=all&from_overview=1"
        )
        default_create_url = (
            f"{settings.ilias_base_url}/ilias.php?"
            f"baseClass=ilexercisehandlergui&cmdNode=dc:o5:5n:d2:d4&cmdClass=ilExSubmissionTeamGUI"
            f"&cmd=createTeam&ref_id={exercise_ref_id}&ass_id={ass_id}"
        )
        async with self.session_manager.get_http_client() as client:
            create_url = default_create_url
            try:
                pres_resp = await client.get(pres_url)
                self._check_response_for_session_loss(pres_resp, pres_url)
                pres_detail = parse_student_assignment_detail(
                    pres_resp.text, exercise_ref_id=exercise_ref_id, ass_id=ass_id
                )
                if pres_detail.create_team_url:
                    create_url = pres_detail.create_team_url
            except SessionExpiredError:
                raise
            except Exception as e:
                logger.debug(f"Using fallback createTeam URL: {e}")

            logger.info(f"Creating student team via {create_url}")
            create_resp = await client.get(create_url)
            self._check_response_for_session_loss(create_resp, create_url)

        return await self.get_student_assignment_detail(exercise_ref_id, ass_id)

    async def get_team_candidates(
        self, exercise_ref_id: str, ass_id: str
    ) -> TeamCandidatesResponse:
        """
        Fetches the current team members and the full list of course participants (candidates)
        from ilRepositorySearchGUI&cmd=listUsers (expanding up to 800 rows via _trows=800).
        """
        self._ensure_authenticated()
        team_url = (
            f"{settings.ilias_base_url}/ilias.php?"
            f"baseClass=ilexercisehandlergui&cmdNode=dc:o5:5n:d2:d4&cmdClass=ilExSubmissionTeamGUI"
            f"&cmd=submissionScreenTeam&ref_id={exercise_ref_id}&ass_id={ass_id}"
        )
        async with self.session_manager.get_http_client() as client:
            team_resp = await client.get(team_url)
            self._check_response_for_session_loss(team_resp, team_url)
            team_screen = parse_team_management_screen(team_resp.text, base_url=settings.ilias_base_url)

            list_users_url = team_screen.list_users_url or (
                f"{settings.ilias_base_url}/ilias.php?"
                f"baseClass=ilexercisehandlergui&cmdNode=dc:o5:5n:d2:d4:z0&cmdClass=ilRepositorySearchGUI"
                f"&cmd=listUsers&ref_id={exercise_ref_id}&ass_id={ass_id}"
            )

            list_resp = await client.get(list_users_url)
            self._check_response_for_session_loss(list_resp, list_users_url)
            course_screen = parse_course_users_list_screen(list_resp.text, base_url=settings.ilias_base_url)

            # If there are more than 40 participants, expand table to 800 rows to get full course directory
            if course_screen.has_next_page and course_screen.max_rows_url:
                try:
                    full_resp = await client.get(course_screen.max_rows_url)
                    if full_resp.status_code == 200:
                        expanded_screen = parse_course_users_list_screen(
                            full_resp.text, base_url=settings.ilias_base_url
                        )
                        if expanded_screen.candidates:
                            course_screen = expanded_screen
                except Exception as e:
                    logger.warning(f"Failed to expand course user list to 800 rows: {e}")

            current_uid = course_screen.current_user_id
            team_uids = {m.user_id for m in team_screen.members if m.user_id}
            team_logins = {m.login.lower() for m in team_screen.members if m.login}

            by_uid: Dict[str, CourseUserCandidate] = {}
            by_login: Dict[str, CourseUserCandidate] = {}

            for cand in course_screen.candidates:
                if (cand.user_id and cand.user_id in team_uids) or (
                    cand.login and cand.login.lower() in team_logins
                ):
                    cand.in_team = True
                if current_uid and cand.user_id == current_uid:
                    cand.is_self = True
                if cand.user_id:
                    by_uid[cand.user_id] = cand
                if cand.login:
                    by_login[cand.login.lower()] = cand

            # Enrich team members with full names and self status from course directory
            for m in team_screen.members:
                matched = (by_uid.get(m.user_id) if m.user_id else None) or by_login.get(m.login.lower())
                if matched:
                    if not m.name and matched.full_name:
                        m.name = matched.full_name
                    if not m.user_id and matched.user_id:
                        m.user_id = matched.user_id
                    if matched.is_self:
                        m.is_self = True
                elif current_uid and m.user_id == current_uid:
                    m.is_self = True

            # Cache course candidates for this exercise
            if course_screen.candidates:
                self._course_user_cache[exercise_ref_id] = course_screen.candidates

            return TeamCandidatesResponse(
                exercise_ref_id=exercise_ref_id,
                ass_id=ass_id,
                current_user_id=current_uid,
                team_members=team_screen.members,
                candidates=course_screen.candidates,
            )

    async def add_student_team_members(
        self,
        exercise_ref_id: str,
        ass_id: str,
        user_ids: Optional[List[str]] = None,
        user_logins: Optional[List[str]] = None,
    ) -> StudentAssignmentDetail:
        """
        Adds one or more course participants to the student's team:
        - By user_ids: submits user[] + cmd[addUser] to ilRepositorySearchGUI&cmd=post.
        - By user_logins: submits user_login + cmd[addUserFromAutoComplete] to toolbar form.
        Returns the refreshed StudentAssignmentDetail.
        """
        self._ensure_authenticated()
        user_ids = [str(u).strip() for u in (user_ids or []) if str(u).strip()]
        user_logins = [str(l).strip("[] ") for l in (user_logins or []) if str(l).strip("[] ")]

        team_url = (
            f"{settings.ilias_base_url}/ilias.php?"
            f"baseClass=ilexercisehandlergui&cmdNode=dc:o5:5n:d2:d4&cmdClass=ilExSubmissionTeamGUI"
            f"&cmd=submissionScreenTeam&ref_id={exercise_ref_id}&ass_id={ass_id}"
        )
        async with self.session_manager.get_http_client() as client:
            team_resp = await client.get(team_url)
            self._check_response_for_session_loss(team_resp, team_url)
            team_screen = parse_team_management_screen(team_resp.text, base_url=settings.ilias_base_url)

            # 1. Add by numeric ILIAS user_ids via ilRepositorySearchGUI course user list form
            if user_ids:
                list_users_url = team_screen.list_users_url or (
                    f"{settings.ilias_base_url}/ilias.php?"
                    f"baseClass=ilexercisehandlergui&cmdNode=dc:o5:5n:d2:d4:z0&cmdClass=ilRepositorySearchGUI"
                    f"&cmd=listUsers&ref_id={exercise_ref_id}&ass_id={ass_id}"
                )
                list_resp = await client.get(list_users_url)
                self._check_response_for_session_loss(list_resp, list_users_url)
                course_screen = parse_course_users_list_screen(
                    list_resp.text, base_url=settings.ilias_base_url
                )

                # If course has >40 members and any requested user_id is not on page 1, expand to 800 rows
                visible_uids = {c.user_id for c in course_screen.candidates}
                if (
                    course_screen.has_next_page
                    and course_screen.max_rows_url
                    and not all(uid in visible_uids for uid in user_ids)
                ):
                    full_resp = await client.get(course_screen.max_rows_url)
                    if full_resp.status_code == 200:
                        course_screen = parse_course_users_list_screen(
                            full_resp.text, base_url=settings.ilias_base_url
                        )

                if course_screen.candidates:
                    self._course_user_cache[exercise_ref_id] = course_screen.candidates

                action_url = course_screen.add_user_form_action or team_screen.add_autocomplete_action
                if action_url:
                    post_data: Dict[str, Any] = dict(course_screen.hidden_fields)
                    post_data["user[]"] = user_ids
                    post_data["cmd[addUser]"] = "Add"
                    logger.info(f"Adding team members {user_ids} via {action_url}")
                    add_resp = await client.post(action_url, data=post_data)
                    self._check_response_for_session_loss(add_resp, action_url)

            # 2. Add by user_login via toolbar form (cmd[addUserFromAutoComplete])
            if user_logins:
                auto_action = team_screen.add_autocomplete_action or (
                    f"{settings.ilias_base_url}/ilias.php?"
                    f"baseClass=ilexercisehandlergui&cmdNode=dc:o5:5n:d2:d4:z0&cmdClass=ilRepositorySearchGUI"
                    f"&cmd=post&ref_id={exercise_ref_id}&ass_id={ass_id}"
                )
                for login_str in user_logins:
                    post_data = {
                        "user_login": login_str,
                        "cmd[addUserFromAutoComplete]": "Add",
                    }
                    logger.info(f"Adding team member by login '{login_str}' via {auto_action}")
                    login_resp = await client.post(auto_action, data=post_data)
                    self._check_response_for_session_loss(login_resp, auto_action)

        return await self.get_student_assignment_detail(exercise_ref_id, ass_id)

    async def _remove_team_member_ids_in_session(
        self,
        client: httpx.AsyncClient,
        exercise_ref_id: str,
        ass_id: str,
        member_ids: List[str],
        team_screen: Optional[ParsedTeamManagementScreen] = None,
    ) -> None:
        """
        Internal helper to execute ILIAS's 2-step team member removal flow:
        1. POST id[] + cmd[confirmRemoveTeamMember] = 'Remove' to submissionScreenTeam table form.
        2. Parse confirmation dialog and POST id[] + cmd[removeTeamMember] = 'Remove'.
        """
        team_url = (
            f"{settings.ilias_base_url}/ilias.php?"
            f"baseClass=ilexercisehandlergui&cmdNode=dc:o5:5n:d2:d4&cmdClass=ilExSubmissionTeamGUI"
            f"&cmd=submissionScreenTeam&ref_id={exercise_ref_id}&ass_id={ass_id}"
        )
        if team_screen is None:
            team_resp = await client.get(team_url)
            self._check_response_for_session_loss(team_resp, team_url)
            team_screen = parse_team_management_screen(team_resp.text, base_url=settings.ilias_base_url)

        # Resolve any login strings to numeric ILIAS user_ids
        login_to_uid = {m.login.lower(): m.user_id for m in team_screen.members if m.user_id and m.login}
        resolved_ids: List[str] = []
        for raw_id in member_ids:
            clean = str(raw_id).strip("[] ")
            if clean in login_to_uid.values():
                resolved_ids.append(clean)
            elif clean.lower() in login_to_uid and login_to_uid[clean.lower()]:
                resolved_ids.append(str(login_to_uid[clean.lower()]))
            elif clean.isdigit():
                resolved_ids.append(clean)

        if not resolved_ids:
            return

        form_action = team_screen.remove_form_action or (
            f"{settings.ilias_base_url}/ilias.php?"
            f"baseClass=ilexercisehandlergui&cmdNode=dc:o5:5n:d2:d4&cmdClass=ilExSubmissionTeamGUI"
            f"&cmd=post&fallbackCmd=submissionScreenTeam&ref_id={exercise_ref_id}&ass_id={ass_id}"
        )
        step1_data: Dict[str, Any] = dict(team_screen.remove_hidden_fields)
        step1_data["id[]"] = resolved_ids
        step1_data["cmd[confirmRemoveTeamMember]"] = "Remove"

        logger.info(f"Submitting confirmRemoveTeamMember for {resolved_ids} to {form_action}")
        step1_resp = await client.post(form_action, data=step1_data)
        self._check_response_for_session_loss(step1_resp, form_action)

        confirm_screen = parse_remove_team_confirmation_screen(
            step1_resp.text, base_url=settings.ilias_base_url
        )
        step2_action = confirm_screen.action_url or form_action
        step2_data: Dict[str, Any] = dict(confirm_screen.hidden_fields)
        step2_data["id[]"] = confirm_screen.member_ids or resolved_ids
        step2_data[confirm_screen.confirm_cmd_name] = confirm_screen.confirm_cmd_value

        logger.info(f"Submitting final {confirm_screen.confirm_cmd_name} for {step2_data['id[]']} to {step2_action}")
        step2_resp = await client.post(step2_action, data=step2_data)
        self._check_response_for_session_loss(step2_resp, step2_action)

    async def remove_student_team_members(
        self, exercise_ref_id: str, ass_id: str, member_ids: List[str]
    ) -> StudentAssignmentDetail:
        """
        Removes one or more members from the student's team and returns the updated assignment detail.
        """
        self._ensure_authenticated()
        async with self.session_manager.get_http_client() as client:
            await self._remove_team_member_ids_in_session(
                client=client,
                exercise_ref_id=exercise_ref_id,
                ass_id=ass_id,
                member_ids=member_ids,
            )
        return await self.get_student_assignment_detail(exercise_ref_id, ass_id)

    async def delete_student_team(
        self, exercise_ref_id: str, ass_id: str
    ) -> StudentAssignmentDetail:
        """
        Deletes the student's entire team for an exercise assignment.
        Handles ILIAS's constraint where a team cannot be deleted while it has >1 member:
        1. Inspects submissionScreenTeam to get all current team members.
        2. If >1 member exists, identifies the current logged-in user (self) and first removes
           all other members via confirmRemoveTeamMember -> removeTeamMember.
        3. Once only the current user remains, triggers confirmDeleteTeam and confirms deletion.
        4. Returns the refreshed StudentAssignmentDetail.
        """
        self._ensure_authenticated()
        team_url = (
            f"{settings.ilias_base_url}/ilias.php?"
            f"baseClass=ilexercisehandlergui&cmdNode=dc:o5:5n:d2:d4&cmdClass=ilExSubmissionTeamGUI"
            f"&cmd=submissionScreenTeam&ref_id={exercise_ref_id}&ass_id={ass_id}"
        )
        confirm_delete_url = (
            f"{settings.ilias_base_url}/ilias.php?"
            f"baseClass=ilexercisehandlergui&cmdNode=dc:o5:5n:d2:d4&cmdClass=ilExSubmissionTeamGUI"
            f"&cmd=confirmDeleteTeam&ref_id={exercise_ref_id}&ass_id={ass_id}"
        )
        async with self.session_manager.get_http_client() as client:
            team_resp = await client.get(team_url)
            self._check_response_for_session_loss(team_resp, team_url)
            team_screen = parse_team_management_screen(team_resp.text, base_url=settings.ilias_base_url)

            # Step 1: If >1 member in team, remove all members except self first
            if len(team_screen.members) > 1:
                self_uid = next((m.user_id for m in team_screen.members if m.is_self and m.user_id), None)

                # Check cached course users for self_uid if not yet resolved
                if not self_uid and exercise_ref_id in self._course_user_cache:
                    self_uid = next(
                        (c.user_id for c in self._course_user_cache[exercise_ref_id] if c.is_self),
                        None,
                    )

                # If still unknown, fetch listUsers once to get rep_search_<current_user_id>
                if not self_uid and team_screen.list_users_url:
                    try:
                        lu_resp = await client.get(team_screen.list_users_url)
                        if lu_resp.status_code == 200:
                            lu_screen = parse_course_users_list_screen(
                                lu_resp.text, base_url=settings.ilias_base_url
                            )
                            self_uid = lu_screen.current_user_id
                    except Exception as e:
                        logger.debug(f"Could not resolve self_uid from listUsers: {e}")

                all_uids = [m.user_id for m in team_screen.members if m.user_id]
                if self_uid and self_uid in all_uids:
                    other_uids = [uid for uid in all_uids if uid != self_uid]
                else:
                    # Fallback: keep first member, remove the rest
                    other_uids = all_uids[1:]

                if other_uids:
                    logger.info(
                        f"Team has {len(all_uids)} members; removing teammates {other_uids} before deleting team"
                    )
                    await self._remove_team_member_ids_in_session(
                        client=client,
                        exercise_ref_id=exercise_ref_id,
                        ass_id=ass_id,
                        member_ids=other_uids,
                        team_screen=team_screen,
                    )

            # Step 2: Now only 1 member remains — call confirmDeleteTeam and submit confirmation
            del_resp = await client.get(confirm_delete_url)
            self._check_response_for_session_loss(del_resp, confirm_delete_url)
            confirm_screen = parse_remove_team_confirmation_screen(
                del_resp.text, base_url=settings.ilias_base_url
            )

            if confirm_screen.action_url:
                post_data: Dict[str, Any] = dict(confirm_screen.hidden_fields)
                if confirm_screen.member_ids:
                    post_data["id[]"] = confirm_screen.member_ids
                post_data[confirm_screen.confirm_cmd_name] = confirm_screen.confirm_cmd_value
                logger.info(f"Confirming team deletion via {confirm_screen.action_url}")
                final_resp = await client.post(confirm_screen.action_url, data=post_data)
                self._check_response_for_session_loss(final_resp, confirm_screen.action_url)
            else:
                # Fallback: check if 1 member is still on submissionScreenTeam and remove them via table form
                rem_resp = await client.get(team_url)
                rem_screen = parse_team_management_screen(rem_resp.text, base_url=settings.ilias_base_url)
                rem_uids = [m.user_id for m in rem_screen.members if m.user_id]
                if rem_uids:
                    await self._remove_team_member_ids_in_session(
                        client=client,
                        exercise_ref_id=exercise_ref_id,
                        ass_id=ass_id,
                        member_ids=rem_uids,
                        team_screen=rem_screen,
                    )

        return await self.get_student_assignment_detail(exercise_ref_id, ass_id)

    async def grade_student_submission(
        self, exercise_ref_id: str, grade_data: GradeSubmissionRequest
    ) -> GradeSubmissionResponse:
        """
        Phase 3: The Write-Path for TAs.
        Navigates to grading page, scrapes hidden fields / CSRF tokens, constructs POST, and submits.
        Persists status, mark, and tutor-internal notes to the submissions table,
        and persists student-visible feedback / evaluation statement via ilExerciseSubmissionFeedbackGUI.
        """
        self._ensure_authenticated()
        ass_param = f"&ass_id={grade_data.ass_id}" if grade_data.ass_id else ""
        exercise_url = (
            f"{settings.ilias_base_url}/ilias.php?"
            f"baseClass=ilexercisehandlergui&cmdNode=dc:o5:dd&cmdClass=ilExerciseManagementGUI&cmd=members&ref_id={exercise_ref_id}{ass_param}&part_id=0"
        )

        async with self.session_manager.get_http_client() as client:
            # 1. Fetch current grading / participant page
            resp = await client.get(exercise_url)
            self._check_response_for_session_loss(resp, exercise_url)

            # Resolve active ass_id if not explicitly provided
            ass_id = grade_data.ass_id
            if not ass_id:
                m_ass = re.search(
                    r'<select[^>]*name=["\']ass_id["\'][^>]*>.*?<option[^>]*value=["\'](\d+)["\'][^>]*selected',
                    resp.text,
                    re.DOTALL | re.IGNORECASE,
                )
                if m_ass:
                    ass_id = m_ass.group(1)
                else:
                    m_ass2 = re.search(r"ass_id=(\d+)", resp.text)
                    if m_ass2:
                        ass_id = m_ass2.group(1)

            # 2. Extract table form structure and hidden tokens
            form_data = extract_grading_form(resp.text, member_id=grade_data.member_id)

            # 3. Construct POST payload for table grading (Status, Mark, Tutor Notice)
            payload: Dict[str, str] = dict(form_data.hidden_fields)

            # Map status (passed, failed, not_graded)
            status_val = grade_data.status
            if status_val == "passed":
                status_val = "passed"
            elif status_val == "failed":
                status_val = "failed"
            elif status_val == "not_graded":
                status_val = "notgraded"

            # Both modern ILIAS formats: status[<id>] and generic status field
            if status_val:
                payload[f"status[{grade_data.member_id}]"] = status_val
                if form_data.status_field_name:
                    payload[form_data.status_field_name] = status_val

            if grade_data.mark is not None:
                payload[f"mark[{grade_data.member_id}]"] = str(grade_data.mark)
                if form_data.mark_field_name:
                    payload[form_data.mark_field_name] = str(grade_data.mark)

            if grade_data.notice is not None:
                payload[f"notice[{grade_data.member_id}]"] = grade_data.notice
                if form_data.notice_field_name:
                    payload[form_data.notice_field_name] = grade_data.notice

            # Ensure member/part id is listed and selected
            payload["listed_part_ids[]"] = grade_data.member_id
            payload["sel_part_ids[]"] = grade_data.member_id

            # Save command
            payload["cmd[saveStatusAll]"] = "Save All"
            payload["select_cmd"] = "saveStatusSelected"

            target_action = form_data.action_url or exercise_url

            # 4. Send POST request for table form
            post_resp = await client.post(target_action, data=payload)
            self._check_response_for_session_loss(post_resp, target_action)

            # 5. Persist Student-Visible Feedback / Evaluation Statement (ilExerciseSubmissionFeedbackGUI)
            if grade_data.feedback is not None:
                # Resolve cmdNode for ilExerciseSubmissionFeedbackGUI
                cmd_node = "dc:o5:dd:de"
                m_node = re.search(r"cmdNode=([^&\"']+).*?cmdClass=ilExerciseSubmissionFeedbackGUI", resp.text)
                if m_node:
                    cmd_node = m_node.group(1)

                # Locate async showFeedbackForm URL for this specific member in the page
                fb_modal_url = None
                pat = (
                    rf'ilias\.php\?[^"\'\s<>\\]*cmdClass=ilExerciseSubmissionFeedbackGUI'
                    rf'[^"\'\s<>\\]*cmd=showFeedbackForm[^"\'\s<>\\]*member_id={grade_data.member_id}[^"\'\s<>\\]*'
                )
                m_fb = re.search(pat, resp.text)
                if m_fb:
                    raw_fb = m_fb.group(0).replace("&amp;", "&").replace(r"\/", "/")
                    fb_modal_url = urllib.parse.urljoin(settings.ilias_base_url, raw_fb)

                if not fb_modal_url:
                    fb_modal_url = (
                        f"{settings.ilias_base_url}/ilias.php?baseClass=ilexercisehandlergui"
                        f"&cmdNode={cmd_node}&cmdClass=ilExerciseSubmissionFeedbackGUI"
                        f"&cmd=showFeedbackForm&ref_id={exercise_ref_id}&ass_id={ass_id or 0}&vw=1"
                        f"&member_id={grade_data.member_id}&part_id=0&cmdMode=asynch"
                    )

                feedback_saved = False

                # 5a. GET the async feedback modal to scrape exact form action, input names, CSRF tokens
                try:
                    modal_resp = await client.get(fb_modal_url)
                    if modal_resp.status_code in [200, 302]:
                        modal_info = extract_feedback_modal_form(modal_resp.text, base_url=settings.ilias_base_url)
                        modal_action = modal_info.action_url or (
                            f"{settings.ilias_base_url}/ilias.php?baseClass=ilexercisehandlergui"
                            f"&cmdNode={cmd_node}&cmdClass=ilExerciseSubmissionFeedbackGUI"
                            f"&cmd=validateAndSubmitFeedbackForm&ref_id={exercise_ref_id}"
                            f"&ass_id={ass_id or 0}&member_id={grade_data.member_id}&part_id=0&cmdMode=asynch"
                        )
                        modal_payload = dict(modal_info.hidden_fields)
                        modal_payload[modal_info.comment_field_name] = grade_data.feedback
                        modal_payload["comment"] = grade_data.feedback
                        if modal_info.submit_button_name:
                            modal_payload[modal_info.submit_button_name] = modal_info.submit_button_value or "Save"
                        if grade_data.rtoken and "rtoken" not in modal_payload:
                            modal_payload["rtoken"] = grade_data.rtoken

                        fb_post_resp = await client.post(modal_action, data=modal_payload)
                        if fb_post_resp.status_code in [200, 302] and "alert-danger" not in fb_post_resp.text:
                            feedback_saved = True
                except Exception as fb_err:
                    logger.warning(f"Failed submitting feedback modal form: {fb_err}")

                # 5b. Fallback: post directly via saveCommentForLearners
                if not feedback_saved:
                    try:
                        save_url = (
                            f"{settings.ilias_base_url}/ilias.php?baseClass=ilexercisehandlergui"
                            f"&cmdNode={cmd_node}&cmdClass=ilExerciseSubmissionFeedbackGUI"
                            f"&cmd=saveCommentForLearners&ref_id={exercise_ref_id}&ass_id={ass_id or 0}"
                            f"&member_id={grade_data.member_id}&part_id=0"
                        )
                        save_data = {
                            "comment": grade_data.feedback,
                            "member_id": str(grade_data.member_id),
                            "ass_id": str(ass_id or 0),
                        }
                        if grade_data.rtoken:
                            save_data["rtoken"] = grade_data.rtoken
                        await client.post(save_url, data=save_data)
                    except Exception as sl_err:
                        logger.warning(f"Failed fallback saveCommentForLearners: {sl_err}")

            # 6. Verify success
            success, message = verify_grading_success(post_resp.text)
            if not success:
                # If HTTP was 200/302 and no explicit error message, consider it successful
                if post_resp.status_code in [200, 302]:
                    success = True
                    message = t('Bewertung erfolgreich gespeichert.')

            return GradeSubmissionResponse(
                success=success,
                message=message,
                member_id=grade_data.member_id,
                status=grade_data.status,
                feedback=grade_data.feedback,
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
            raise ValueError(t('ILIAS returned error {p0} for download {p1}', p0=resp.status_code, p1=full_url))

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

    def _get_feedback_files_url(
        self,
        exercise_ref_id: str,
        member_id: str,
        ass_id: Optional[str] = None,
        custom_url: Optional[str] = None,
    ) -> str:
        if custom_url and custom_url.startswith("http"):
            return custom_url
        if custom_url and custom_url.startswith("ilias.php"):
            return f"{settings.ilias_base_url}/{custom_url}"

        base_node = self._get_exercise_base_node(exercise_ref_id)
        node_suffix = "z6" if base_node.endswith(":dd") else "dd:z6"
        return (
            f"{settings.ilias_base_url}/ilias.php?"
            f"baseClass=ilexercisehandlergui&cmdNode={base_node}:{node_suffix}&cmdClass=ilResourceCollectionGUI"
            f"&ref_id={exercise_ref_id}&ass_id={ass_id or 0}&vw=1&member_id={member_id}&part_id=0"
        )

    def _get_feedback_files_remove_url(
        self,
        exercise_ref_id: str,
        member_id: str,
        ass_id: Optional[str] = None,
        custom_url: Optional[str] = None,
    ) -> str:
        base_url = self._get_feedback_files_url(exercise_ref_id, member_id, ass_id, custom_url)
        if "cmd=" in base_url:
            return re.sub(r"cmd=[^&]+", "cmd=remove", base_url)
        return f"{base_url}&cmd=remove"

    async def get_submission_feedback_files(
        self,
        exercise_ref_id: str,
        member_id: str,
        ass_id: Optional[str] = None,
        feedback_url: Optional[str] = None,
        *,
        http_client: Optional[httpx.AsyncClient] = None,
    ) -> FeedbackFilesResponse:
        """
        Fetch the ILIAS ilResourceCollectionGUI page for feedback files and parse existing files and upload URL.
        """
        self._ensure_authenticated()
        url = self._get_feedback_files_url(exercise_ref_id, member_id, ass_id, custom_url=feedback_url)
        logger.info(f"Fetching feedback files page: {url}")
        async with (nullcontext(http_client) if http_client is not None else self.session_manager.get_http_client()) as client:
            resp = await client.get(url)
            self._check_response_for_session_loss(resp, url)
            if resp.status_code != 200:
                raise StudentUploadError(f"ILIAS returned HTTP {resp.status_code} for feedback page", 502)
            self._cache_exercise_cmd_nodes_from_html(exercise_ref_id, resp.text, url=str(resp.url))
            return parse_feedback_files(resp.text, base_url=settings.ilias_base_url)

    async def upload_submission_feedback_file(
        self,
        exercise_ref_id: str,
        member_id: str,
        filename: str,
        file_bytes: bytes,
        content_type: str = "application/octet-stream",
        ass_id: Optional[str] = None,
        feedback_url: Optional[str] = None,
        *,
        http_client: Optional[httpx.AsyncClient] = None,
    ) -> FeedbackFilesResponse:
        """
        Upload a feedback file to ILIAS for this submission following the native 2-step Dropzone + postUpload flow.
        """
        self._ensure_authenticated()
        page_url = self._get_feedback_files_url(exercise_ref_id, member_id, ass_id, custom_url=feedback_url)
        logger.info(f"Uploading feedback file {filename} for member {member_id} at {page_url}")

        async with (nullcontext(http_client) if http_client is not None else self.session_manager.get_http_client()) as client:
            page = await client.get(page_url)
            self._check_response_for_session_loss(page, page_url)
            if page.status_code != 200:
                raise StudentUploadError(f"ILIAS returned HTTP {page.status_code} for feedback page", 502)
            self._cache_exercise_cmd_nodes_from_html(exercise_ref_id, page.text, url=str(page.url))

            form = parse_native_file_upload_form(page.text, str(page.url), command='postUpload')
            if not form.upload_url or not form.form_action or not form.token_input_name or not form.file_identifier or form.disabled:
                raise StudentUploadError(t('upload.form_missing'))
            if form.max_size and len(file_bytes) > form.max_size:
                raise StudentUploadError(t('upload.too_large', limit=form.max_size), 400)

            # Step 1: Upload the file payload via Repo standard Dropzone handler
            uploaded = await client.post(
                form.upload_url,
                files={form.file_field: (filename, file_bytes, content_type)},
                headers={'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'Referer': str(page.url)},
            )
            self._check_response_for_session_loss(uploaded, form.upload_url)
            if uploaded.status_code != 200:
                raise StudentUploadError(f"ILIAS rejected Dropzone upload with HTTP {uploaded.status_code}", 502)
            try:
                result = uploaded.json()
            except ValueError as exc:
                raise StudentUploadError(t('upload.invalid_response')) from exc
            if not isinstance(result, dict) or type(result.get('status')) is not int or result['status'] != 1:
                message = result.get('message') if isinstance(result, dict) else None
                raise StudentUploadError(message if isinstance(message, str) and message.strip() else t('upload.rejected'), 400)

            token = result.get(form.file_identifier)
            if not isinstance(token, str) or not token.strip():
                raise StudentUploadError(t('upload.invalid_response'))

            # Step 2: Submit the postUpload form with the returned resource token
            saved = await client.post(
                form.form_action,
                data={**form.hidden_inputs, form.token_input_name: token},
                headers={'Referer': str(page.url)},
            )
            self._check_response_for_session_loss(saved, form.form_action)
            if error := parse_student_upload_errors(saved.text):
                raise StudentUploadError(error, 400)

            parsed = parse_feedback_files(saved.text, base_url=settings.ilias_base_url)
            if any(f.title == filename for f in parsed.files):
                return parsed
            return await self.get_submission_feedback_files(exercise_ref_id, member_id, ass_id, feedback_url=page_url, http_client=client)

    async def delete_submission_feedback_file(
        self,
        exercise_ref_id: str,
        member_id: str,
        file_id: str,
        ass_id: Optional[str] = None,
        feedback_url: Optional[str] = None,
        *,
        http_client: Optional[httpx.AsyncClient] = None,
    ) -> FeedbackFilesResponse:
        """
        Delete a feedback/evaluation file from a student submission (ilResourceCollectionGUI&cmd=remove).
        """
        self._ensure_authenticated()
        remove_url = self._get_feedback_files_remove_url(exercise_ref_id, member_id, ass_id, custom_url=feedback_url)
        logger.info(f"Deleting feedback file {file_id} at {remove_url}")
        async with (nullcontext(http_client) if http_client is not None else self.session_manager.get_http_client()) as client:
            resp = await client.post(
                remove_url,
                data={"interruptive_items[]": file_id, "cmd": "Delete"},
                headers={'Referer': remove_url},
            )
            self._check_response_for_session_loss(resp, remove_url)
            page_url = self._get_feedback_files_url(exercise_ref_id, member_id, ass_id, custom_url=feedback_url)
            return await self.get_submission_feedback_files(exercise_ref_id, member_id, ass_id=ass_id, feedback_url=page_url, http_client=client)



    # ---------------------------------------------------------
    # TA Exercise Editor & Assignment Management
    # ---------------------------------------------------------
    async def get_ta_assignments_list(self, ref_id: str, *, http_client: Optional[httpx.AsyncClient] = None) -> TAAssignmentListResponse:
        """
        Fetch and parse the TA assignments editor list (ilExAssignmentEditorGUI&cmd=listAssignments).
        """
        self._ensure_authenticated()
        base_node = self._get_exercise_base_node(ref_id)
        url = (
            f"{settings.ilias_base_url}/ilias.php?"
            f"baseClass=ilexercisehandlergui&cmdNode={base_node}:cs&cmdClass=ilExAssignmentEditorGUI&cmd=listAssignments"
            f"&ref_id={ref_id}&mode=all&from_overview=1"
        )
        async with (nullcontext(http_client) if http_client is not None else self.session_manager.get_http_client()) as client:
            resp = await client.get(url)
            self._check_response_for_session_loss(resp, url)
            self._cache_exercise_cmd_nodes_from_html(ref_id, resp.text, url=str(resp.url))
            resp.raise_for_status()
            return parse_ta_assignments_list(resp.text, exercise_ref_id=ref_id)

    async def update_ta_assignment_order(
        self, ref_id: str, orders: Dict[str, int]
    ) -> TAAssignmentListResponse:
        """
        Save updated presentation orders for assignments via cmd[saveAssignmentOrder].
        """
        self._ensure_authenticated()
        current = await self.get_ta_assignments_list(ref_id)
        base_node = self._get_exercise_base_node(ref_id)
        action_url = current.form_action_url or (
            f"{settings.ilias_base_url}/ilias.php?"
            f"baseClass=ilexercisehandlergui&cmdNode={base_node}:cs&cmdClass=ilExAssignmentEditorGUI&cmd=post"
            f"&ref_id={ref_id}&mode=all&from_overview=1"
        )
        if current.rtoken and "rtoken=" not in action_url:
            action_url = f"{action_url}&rtoken={current.rtoken}"

        payload = {"cmd[saveAssignmentOrder]": "Save Order"}
        for ass_id, ord_val in orders.items():
            payload[f"order[{ass_id}]"] = str(ord_val)

        async with self.session_manager.get_http_client() as client:
            resp = await client.post(action_url, data=payload)
            self._check_response_for_session_loss(resp, action_url)
            return parse_ta_assignments_list(resp.text, exercise_ref_id=ref_id)

    async def get_ta_assignment_detail(
        self, ref_id: str, ass_id: Optional[str] = None, type_id: int = 1, *,
        http_client: Optional[httpx.AsyncClient] = None,
    ) -> TAAssignmentDetailResponse:
        """
        Fetch assignment details form (editAssignment or addAssignment).
        """
        self._ensure_authenticated()
        async with (nullcontext(http_client) if http_client is not None else self.session_manager.get_http_client()) as client:
            current = await self.get_ta_assignments_list(ref_id, http_client=client)
            if ass_id:
                item = next((item for item in current.assignments if item.ass_id == ass_id), None)
                if item is None or not item.edit_url:
                    raise ValueError(t('editor.assignment_missing'))
                url = item.edit_url
                resp = await client.get(url)
                self._check_response_for_session_loss(resp, url)
            else:
                if not current.add_action_url:
                    raise ValueError(t('editor.form_missing'))
                if type_id not in current.available_types:
                    raise ValueError(t('editor.type_unavailable'))
                add_payload = {'type': str(type_id)}
                if current.add_submit_command:
                    add_payload[current.add_submit_command] = ''
                resp = await client.post(current.add_action_url, data=add_payload)
                self._check_response_for_session_loss(resp, current.add_action_url)
            if not resp.is_success:
                raise ValueError(t('editor.http_error', status=resp.status_code))
            if error := parse_ta_assignment_error(resp.text):
                raise ValueError(error)
            self._cache_exercise_cmd_nodes_from_html(ref_id, resp.text, url=str(resp.url))
            detail = parse_ta_assignment_form(resp.text, exercise_ref_id=ref_id, ass_id=ass_id)
            detail.available_types = current.available_types
            detail.existing_assignment_ids = [item.ass_id for item in current.assignments]
            if ass_id:
                try:
                    files = await self.get_ta_instruction_files(ref_id, ass_id, http_client=client)
                    detail.instruction_files = files
                except SessionExpiredError:
                    raise
                except Exception as fe:
                    logger.debug(f"Could not load instruction files for {ass_id}: {fe}")
            return detail

    async def save_ta_assignment(
        self, ref_id: str, data: SaveTAAssignmentRequest
    ) -> TAAssignmentDetailResponse:
        """Submit a fresh native form and verify the exact created/updated object."""
        self._ensure_authenticated()
        validate_ta_assignment_request(data)
        async with self.session_manager.get_http_client() as client:
            existing = await self.get_ta_assignment_detail(
                ref_id, ass_id=data.ass_id, type_id=data.type_id, http_client=client)
            payload = build_ta_assignment_payload(existing, data)
            expected_command = 'cmd[updateAssignment]' if data.ass_id else 'cmd[saveAssignment]'
            if existing.submit_command != expected_command:
                raise ValueError(t('editor.form_missing'))
            action = existing.form_action
            target, origin = urllib.parse.urlparse(action), urllib.parse.urlparse(settings.ilias_base_url)
            query = urllib.parse.parse_qs(target.query)
            if ((target.scheme, target.netloc) != (origin.scheme, origin.netloc)
                    or query.get('ref_id') != [ref_id]):
                raise ValueError(t('editor.invalid_target'))
            if data.ass_id and query.get('ass_id') != [data.ass_id]:
                raise ValueError(t('editor.invalid_target'))

            # Reproduce native empty file controls too: PHP distinguishes an
            # empty multipart upload from a missing $_FILES entry.
            # Hidden checkbox subforms still participate in native validation;
            # include their enabled file inputs just as a browser does.
            if existing.file_inputs:
                body, content_type = encode_assignment_form(payload, existing.file_inputs)
                response = await client.post(action, content=body, headers={'Content-Type': content_type})
            else:
                response = await client.post(action, data=payload)
            self._check_response_for_session_loss(response, action)
            if not response.is_success:
                dump_failed_html(response.text, 'ta_assignment_save', extra_info={
                    'ref_id': ref_id, 'status': response.status_code,
                    'field_names': sorted(payload), 'file_inputs': existing.file_inputs})
                raise ValueError(t('editor.http_error', status=response.status_code))
            if error := parse_ta_assignment_error(response.text):
                dump_failed_html(response.text, 'ta_assignment_save', extra_info={
                    'ref_id': ref_id, 'field_names': sorted(payload), 'file_inputs': existing.file_inputs})
                logger.error('ILIAS rejected assignment save: %s', error)
                raise ValueError(t('ILIAS Fehler: {p0}', p0=error))

            saved_id = data.ass_id
            if not saved_id:
                before = set(existing.existing_assignment_ids)
                redirected = urllib.parse.parse_qs(urllib.parse.urlparse(str(response.url)).query).get('ass_id', [None])[0]
                if redirected and redirected not in before:
                    saved_id = redirected
                else:
                    updated = await self.get_ta_assignments_list(ref_id, http_client=client)
                    matches = [item for item in updated.assignments if item.ass_id not in before
                               and item.title.strip() == data.title.strip() and item.type_id == data.type_id]
                    if len(matches) == 1:
                        saved_id = matches[0].ass_id
            if not saved_id:
                raise ValueError(t('editor.save_unconfirmed'))
            saved = await self.get_ta_assignment_detail(ref_id, ass_id=saved_id, type_id=data.type_id, http_client=client)
            if saved.title.strip() != data.title.strip() or saved.type_id != data.type_id:
                raise ValueError(t('editor.save_unconfirmed'))
            return saved

    async def delete_ta_assignment(self, ref_id: str, ass_id: str) -> bool:
        """Follow the confirmation once, then verify deletion even after a timeout."""
        from backend.scrapers.dumper import ScrapingParsingError

        self._ensure_authenticated()
        async with self.session_manager.get_http_client() as client:
            current = await self.get_ta_assignments_list(ref_id, http_client=client)
            if not any(item.ass_id == ass_id for item in current.assignments):
                return True

            def target(url: str) -> str:
                parsed, origin = urllib.parse.urlparse(url), urllib.parse.urlparse(settings.ilias_base_url)
                query = urllib.parse.parse_qs(parsed.query)
                if ((parsed.scheme, parsed.netloc) != (origin.scheme, origin.netloc)
                        or query.get('ref_id') != [ref_id]
                        or query.get('cmdClass', [''])[0].lower() != 'ilexassignmenteditorgui'):
                    raise AssignmentDeletionError(t('editor.invalid_target'))
                return url

            if not current.form_action_url:
                raise AssignmentDeletionError(t('delete.form_missing'))
            post_url = target(current.form_action_url)
            confirmation = await client.post(post_url, data={
                'id[]': ass_id, 'cmd[confirmAssignmentsDeletion]': 'Delete'})
            self._check_response_for_session_loss(confirmation, post_url)
            if not confirmation.is_success:
                raise AssignmentDeletionError(t('delete.http_error', status=confirmation.status_code))
            if error := parse_ta_assignment_error(confirmation.text):
                raise AssignmentDeletionError(error, 400)
            action, payload = parse_ta_assignment_delete_form(confirmation.text, ref_id, ass_id)
            response = None
            try:
                # File/resource cleanup may outlast the ordinary 30-second timeout.
                # Skip the automatic redirect; the list is fetched explicitly below.
                response = await client.post(target(action), data=payload,
                    timeout=httpx.Timeout(120.0, connect=10.0), follow_redirects=False)
                self._check_response_for_session_loss(response, action)
            except httpx.RequestError as exc:
                logger.warning('Assignment deletion response unavailable (%s); checking exercise %s, assignment %s',
                               type(exc).__name__, ref_id, ass_id)

            try:
                updated = await self.get_ta_assignments_list(ref_id, http_client=client)
            except (httpx.HTTPError, ScrapingParsingError) as exc:
                raise AssignmentDeletionError(t('delete.unconfirmed'), 504) from exc
            if not any(item.ass_id == ass_id for item in updated.assignments):
                return True
            if response is None:
                raise AssignmentDeletionError(t('delete.unconfirmed'), 504)
            if error := parse_ta_assignment_error(response.text):
                raise AssignmentDeletionError(error, 400)
            if not (response.is_success or response.is_redirect):
                raise AssignmentDeletionError(t('delete.http_error', status=response.status_code))
            raise AssignmentDeletionError(t('delete.still_present'), 409)

    async def get_ta_instruction_files(
        self, ref_id: str, ass_id: str, *, http_client: Optional[httpx.AsyncClient] = None,
    ) -> List[TAInstructionFileItem]:
        """
        Fetch list of uploaded instruction files for an assignment.
        """
        self._ensure_authenticated()
        base_node = self._get_exercise_base_node(ref_id)
        url = (
            f"{settings.ilias_base_url}/ilias.php?"
            f"baseClass=ilexercisehandlergui&cmdNode={base_node}:cs:z6&cmdClass=ilResourceCollectionGUI&cmd=index"
            f"&ref_id={ref_id}&ass_id={ass_id}&from_overview=1"
        )
        async with (nullcontext(http_client) if http_client is not None else self.session_manager.get_http_client()) as client:
            resp = await client.get(url)
            self._check_response_for_session_loss(resp, url)
            return parse_instruction_files(resp.text, base_url=settings.ilias_base_url)

    async def upload_instruction_file(
        self,
        ref_id: str,
        ass_id: str,
        filename: str,
        file_bytes: bytes,
        content_type: str = "application/octet-stream",
    ) -> List[TAInstructionFileItem]:
        """Discover the native upload handler, send its token, and verify the new attachment."""
        self._ensure_authenticated()
        async with self.session_manager.get_http_client() as client:
            base_node = self._get_exercise_base_node(ref_id)
            page_url = (f'{settings.ilias_base_url}/ilias.php?baseClass=ilexercisehandlergui'
                        f'&cmdNode={base_node}:cs:z6&cmdClass=ilResourceCollectionGUI&cmd=index'
                        f'&ref_id={ref_id}&ass_id={ass_id}&from_overview=1')

            def check(response: httpx.Response):
                self._check_response_for_session_loss(response, str(response.url))
                if not response.is_success:
                    raise StudentUploadError(t('upload.http_error', status=response.status_code))

            def target(url: str) -> str:
                parsed = urllib.parse.urlparse(url)
                origin = urllib.parse.urlparse(settings.ilias_base_url)
                query = urllib.parse.parse_qs(parsed.query)
                if ((parsed.scheme, parsed.netloc) != (origin.scheme, origin.netloc)
                        or query.get('ref_id') != [ref_id] or query.get('ass_id') != [ass_id]):
                    raise StudentUploadError(t('upload.invalid_target'))
                return url

            page = await client.get(page_url)
            check(page)
            before = {item.file_id for item in parse_instruction_files(page.text)}
            form = parse_native_file_upload_form(page.text, str(page.url), command='postUpload')
            if not form.upload_url or not form.form_action or not form.token_input_name or not form.file_identifier or form.disabled:
                raise StudentUploadError(t('upload.form_missing'))
            if form.max_size and len(file_bytes) > form.max_size:
                raise StudentUploadError(t('upload.too_large', limit=form.max_size), 400)
            if form.max_files and form.current_files >= form.max_files:
                raise StudentUploadError(t('upload.unavailable'), 400)
            upload_url, action = target(form.upload_url), target(form.form_action)
            if form.chunked:
                # Never silently truncate uploads when the native handler requires chunks.
                raise StudentUploadError(t('upload.form_missing'))
            uploaded = await client.post(upload_url,
                files={form.file_field: (filename, file_bytes, content_type)},
                headers={'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'Referer': str(page.url)})
            check(uploaded)
            try:
                result = uploaded.json()
            except ValueError as exc:
                raise StudentUploadError(t('upload.invalid_response')) from exc
            if not isinstance(result, dict):
                raise StudentUploadError(t('upload.invalid_response'))
            if type(result.get('status')) is not int or result['status'] != 1:
                message = result.get('message')
                raise StudentUploadError(message if isinstance(message, str) and message.strip() else t('upload.rejected'), 400)
            token = result.get(form.file_identifier)
            if not isinstance(token, str) or not token.strip():
                raise StudentUploadError(t('upload.invalid_response'))
            saved = await client.post(action, data={**form.hidden_inputs, form.token_input_name: token})
            check(saved)
            if error := parse_student_upload_errors(saved.text):
                raise StudentUploadError(error, 400)
            updated = await self.get_ta_instruction_files(ref_id, ass_id, http_client=client)
            if not any(item.file_id not in before and item.filename == filename and item.download_url for item in updated):
                raise StudentUploadError(t('upload.unconfirmed'), 409)
            return updated

    async def delete_instruction_file(
        self, ref_id: str, ass_id: str, file_id: str
    ) -> bool:
        """
        Delete an instruction file from an assignment (ilResourceCollectionGUI&cmd=remove).
        """
        self._ensure_authenticated()
        base_node = self._get_exercise_base_node(ref_id)
        url = (
            f"{settings.ilias_base_url}/ilias.php?"
            f"baseClass=ilexercisehandlergui&cmdNode={base_node}:cs:z6&cmdClass=ilResourceCollectionGUI&cmd=remove"
            f"&ref_id={ref_id}&ass_id={ass_id}&from_overview=1"
        )
        async with self.session_manager.get_http_client() as client:
            resp = await client.post(url, data={"interruptive_items[]": file_id, "cmd": "Delete"})
            self._check_response_for_session_loss(resp, url)
            return resp.status_code == 200

# Default singleton instance
ilias_client = IliasClient()

