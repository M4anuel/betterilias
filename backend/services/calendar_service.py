from datetime import date, datetime, timezone
import json
import logging
from pathlib import Path
import re
import secrets
from typing import Any, Dict, List, Optional, Tuple
import uuid

import httpx

from backend.config import settings
from backend.i18n import t
from backend.schemas import (
    CalendarEvent,
    CalendarSubscriptionResponse,
    CourseCalendarFeedStatus,
    CourseCalendarInfo,
    CourseItem,
    CourseScheduleRule,
    CourseScheduleRuleInput,
    SemesterCalendarResponse,
)
from backend.scrapers.calendar import (
    ParsedCourseCalendarDiscovery,
    combine_calendar_events,
    generate_ics_feed,
    get_semester_date_bounds,
    parse_course_calendar_discovery,
    parse_ics_feed,
    parse_ilias_subscription_modal,
    strip_course_code_prefix,
)
from backend.services.ilias_client import IliasClient, SessionExpiredError
from backend.services.semester_utils import get_current_semester, semester_order_key

logger = logging.getLogger("ilias.calendar")

CURRENT_SEMESTER_TTL_SECONDS = 6 * 3600  # 6 hours for current semester courses

COURSE_COLOR_PALETTE = [
    "#0AACA5",  # BetterIlias Teal
    "#2563EB",  # Royal Blue
    "#7C3AED",  # Violet
    "#DB2777",  # Pink
    "#EA580C",  # Orange
    "#16A34A",  # Green
    "#0284C7",  # Sky Blue
    "#9333EA",  # Purple
    "#DC2626",  # Red
    "#D97706",  # Amber
    "#059669",  # Emerald
    "#4F46E5",  # Indigo
]


def _default_color_for_course(course_ref_id: str, index: int = 0) -> str:
    try:
        num = int(re.sub(r"\D", "", course_ref_id) or index)
    except ValueError:
        num = index
    return COURSE_COLOR_PALETTE[(num + index) % len(COURSE_COLOR_PALETTE)]


def _status_message_for_course(info: CourseCalendarInfo) -> str:
    if info.status == "imported_with_lectures":
        return t(
            "calendar.status.imported_lectures",
            p0=info.imported_lecture_count,
        )
    if info.status == "imported_deadlines_only":
        return t(
            "calendar.status.deadlines_only",
            p0=info.imported_deadline_count,
        )
    if info.status == "valid_empty":
        return t("calendar.status.valid_empty")
    if info.status == "unavailable":
        return t("calendar.status.unavailable")
    if info.status == "failed":
        return t("calendar.status.failed")
    if info.status == "session_expired":
        return t("calendar.status.session_expired")
    return t("calendar.status.not_imported")


class CalendarService:
    """Manages semester calendar imports, custom weekly schedules, course colours, and .ics feeds."""

    def __init__(self, storage_dir: Optional[Path] = None):
        self.storage_dir = storage_dir or Path(".calendar")
        self.tenants_dir = self.storage_dir / "tenants"
        self.tokens_file = self.storage_dir / "tokens.json"
        self.tenants_dir.mkdir(parents=True, exist_ok=True)

    def _sanitize_tenant_key(self, session_id: Optional[str]) -> str:
        if not session_id:
            return "default"
        cleaned = re.sub(r"[^a-zA-Z0-9_-]", "_", session_id.strip())
        return cleaned[:64] or "default"

    def _tenant_path(self, tenant_key: str) -> Path:
        return self.tenants_dir / f"{tenant_key}.json"

    def _load_tenant_state(self, tenant_key: str) -> Dict[str, Any]:
        path = self._tenant_path(tenant_key)
        if path.exists():
            try:
                return json.loads(path.read_text(encoding="utf-8"))
            except Exception as e:
                logger.warning(f"Failed to read calendar state {path}: {e}")
        return {
            "courses": {},
            "imported_events": {},
            "rules": [],
            "colors": {},
            "ignored_missing_schedule": {},
            "subscription_token": None,
            "subscription_semester": None,
            "subscription_created_at": None,
        }

    def _save_tenant_state(self, tenant_key: str, state: Dict[str, Any]) -> None:
        self.tenants_dir.mkdir(parents=True, exist_ok=True)
        path = self._tenant_path(tenant_key)
        path.write_text(json.dumps(state, indent=2, ensure_ascii=False), encoding="utf-8")

    def _load_tokens(self) -> Dict[str, Dict[str, Any]]:
        if self.tokens_file.exists():
            try:
                return json.loads(self.tokens_file.read_text(encoding="utf-8"))
            except Exception:
                pass
        return {}

    def _save_tokens(self, tokens: Dict[str, Dict[str, Any]]) -> None:
        self.storage_dir.mkdir(parents=True, exist_ok=True)
        self.tokens_file.write_text(json.dumps(tokens, indent=2, ensure_ascii=False), encoding="utf-8")

    def _is_local_host(self, base_url: str) -> bool:
        lower = (base_url or "").lower()
        return any(h in lower for h in ["localhost", "127.0.0.1", "0.0.0.0", "[::1]"])

    def _build_subscription_urls(
        self, token: Optional[str], base_url: str, semester: str
    ) -> Tuple[Optional[str], Optional[str], bool]:
        is_local = self._is_local_host(base_url)
        if not token:
            return None, None, is_local
        clean_base = base_url.rstrip("/")
        sub_url = f"{clean_base}/api/calendar/feed/{token}.ics"
        webcal_url = re.sub(r"^https?://", "webcal://", sub_url, flags=re.I)
        return sub_url, webcal_url, is_local

    def build_semester_response(
        self,
        tenant_key: str,
        semester: Optional[str] = None,
        base_url: str = "http://localhost:8000",
        seed_courses: Optional[List[CourseItem]] = None,
    ) -> SemesterCalendarResponse:
        state = self._load_tenant_state(tenant_key)
        courses_dict: Dict[str, Any] = state.get("courses", {})
        colors_dict: Dict[str, str] = state.get("colors", {})
        ignored_dict: Dict[str, bool] = state.get("ignored_missing_schedule", {})
        imported_map: Dict[str, List[Dict[str, Any]]] = state.get("imported_events", {})
        raw_rules: List[Dict[str, Any]] = state.get("rules", [])

        effective_sem = semester if (semester and semester.upper() != "ALL") else get_current_semester()
        filter_by_semester = bool(semester and semester.upper() != "ALL")

        # Ensure any seed_courses passed from the UI are registered in courses_dict
        if seed_courses:
            changed = False
            for idx, sc in enumerate(seed_courses):
                c_color = colors_dict.get(sc.ref_id) or _default_color_for_course(sc.ref_id, idx)
                if sc.ref_id not in colors_dict:
                    colors_dict[sc.ref_id] = c_color
                    changed = True
                if sc.ref_id not in courses_dict:
                    info = CourseCalendarInfo(
                        course_ref_id=sc.ref_id,
                        course_title=sc.title,
                        semester=sc.semester or (effective_sem if filter_by_semester else None),
                        item_type=sc.item_type or "crs",
                        color=c_color,
                        status="not_imported",
                        needs_manual_schedule=True,
                        ignored_missing_schedule=bool(ignored_dict.get(sc.ref_id, False)),
                    )
                    courses_dict[sc.ref_id] = info.model_dump(mode="json")
                    changed = True
                else:
                    existing_c = courses_dict[sc.ref_id]
                    if sc.semester and not existing_c.get("semester"):
                        existing_c["semester"] = sc.semester
                        changed = True
                    if sc.item_type and existing_c.get("item_type") != sc.item_type:
                        existing_c["item_type"] = sc.item_type
                        changed = True
            if changed:
                state["courses"] = courses_dict
                state["colors"] = colors_dict
                self._save_tenant_state(tenant_key, state)

        start_d, mid_d, end_d = get_semester_date_bounds(effective_sem)

        all_rules = [CourseScheduleRule(**r) for r in raw_rules]
        if filter_by_semester:
            semester_course_ids = {
                cid for cid, cdata in courses_dict.items()
                if (cdata.get("semester") or effective_sem).upper() == effective_sem.upper()
            }
            if seed_courses:
                semester_course_ids.update(sc.ref_id for sc in seed_courses)
            semester_rules = [
                r for r in all_rules
                if r.semester.upper() == effective_sem.upper() or r.course_ref_id in semester_course_ids
            ]
        else:
            semester_course_ids = set(courses_dict.keys())
            if seed_courses:
                semester_course_ids.update(sc.ref_id for sc in seed_courses)
            semester_rules = all_rules

        rule_counts_by_course: Dict[str, int] = {}
        for r in semester_rules:
            if r.enabled:
                rule_counts_by_course[r.course_ref_id] = rule_counts_by_course.get(r.course_ref_id, 0) + 1

        course_infos: List[CourseCalendarInfo] = []
        course_titles: Dict[str, str] = {}
        all_imported_events: List[CalendarEvent] = []

        for idx, (cid, cdata) in enumerate(courses_dict.items()):
            c_sem = (cdata.get("semester") or "").upper()
            if filter_by_semester and semester_course_ids and cid not in semester_course_ids and c_sem != effective_sem.upper():
                continue

            info = CourseCalendarInfo(**cdata)
            info.color = colors_dict.get(cid) or info.color or _default_color_for_course(cid, idx)
            info.item_type = cdata.get("item_type") or info.item_type or "crs"
            is_ignored = bool(ignored_dict.get(cid, cdata.get("ignored_missing_schedule", False)))
            info.ignored_missing_schedule = is_ignored
            course_titles[cid] = info.course_title

            raw_evs = imported_map.get(cid, [])
            c_evs = [CalendarEvent(**e) for e in raw_evs]
            all_imported_events.extend(c_evs)

            lecture_cnt = sum(1 for e in c_evs if e.kind == "lecture")
            deadline_cnt = len(c_evs) - lecture_cnt
            custom_cnt = rule_counts_by_course.get(cid, 0)

            info.imported_event_count = len(c_evs)
            info.imported_lecture_count = lecture_cnt
            info.imported_deadline_count = deadline_cnt
            info.custom_rule_count = custom_cnt
            info.needs_manual_schedule = (lecture_cnt == 0 and custom_cnt == 0 and not is_ignored)
            info.status_message = _status_message_for_course(info)
            course_infos.append(info)

        # Also include any course referenced only by a custom rule
        known_cids = {ci.course_ref_id for ci in course_infos}
        for r in semester_rules:
            if r.course_ref_id not in known_cids:
                c_title = r.course_title or f"Course {r.course_ref_id}"
                course_titles[r.course_ref_id] = c_title
                c_color = colors_dict.get(r.course_ref_id) or _default_color_for_course(r.course_ref_id, len(course_infos))
                custom_cnt = rule_counts_by_course.get(r.course_ref_id, 0)
                is_ignored = bool(ignored_dict.get(r.course_ref_id, False))
                info = CourseCalendarInfo(
                    course_ref_id=r.course_ref_id,
                    course_title=c_title,
                    semester=r.semester or effective_sem,
                    item_type="crs",
                    color=c_color,
                    status="not_imported",
                    custom_rule_count=custom_cnt,
                    ignored_missing_schedule=is_ignored,
                    needs_manual_schedule=(custom_cnt == 0 and not is_ignored),
                )
                info.status_message = _status_message_for_course(info)
                course_infos.append(info)
                known_cids.add(r.course_ref_id)

        # Sort courses newest semester first, then undated/groups, then alphabetically
        course_infos.sort(
            key=lambda ci: (
                0 if ci.semester else 1,
                -semester_order_key(ci.semester or ""),
                ci.course_title.lower(),
                ci.course_ref_id,
            )
        )

        combined_events = combine_calendar_events(
            imported_events=all_imported_events,
            custom_rules=semester_rules,
            course_titles=course_titles,
        )

        token = state.get("subscription_token")
        sub_url, webcal_url, is_local = self._build_subscription_urls(token, base_url, effective_sem)

        return SemesterCalendarResponse(
            semester=effective_sem,
            semester_start_date=start_d.isoformat(),
            semester_end_date=end_d.isoformat(),
            semester_mid_date=mid_d.isoformat(),
            timezone="Europe/Zurich",
            courses=course_infos,
            rules=semester_rules,
            events=combined_events,
            subscription_token=token,
            subscription_url=sub_url,
            webcal_url=webcal_url,
            is_local_host=is_local,
        )

    def _find_local_html_dumps_for_course(self, course_ref_id: str, course_title: str) -> List[Path]:
        """Find local HTML dumps matching the course ref_id or course code in htmlfromilias."""
        dump_roots = [
            Path(r"C:\Users\manue\OneDrive\Dokumente\_Uni\IliasAlternative\htmlfromilias"),
            Path(r"C:\Users\manue\Downloads\betterilias\betterilias\htmlfromilias"),
        ]
        matches: List[Path] = []
        code_prefix = ""
        m_code = re.match(r"^(\d+-(?:HS|FS)\d{4}-\d+)", (course_title or "").strip(), flags=re.I)
        if m_code:
            code_prefix = m_code.group(1).lower()
        short_title = strip_course_code_prefix(course_title).lower()

        for root in dump_roots:
            if not root.exists():
                continue
            # Prefer Calendar subfolder first
            cal_sub = root / "Calendar"
            search_files = list(cal_sub.glob("*.html")) if cal_sub.exists() else []
            for f in root.glob("*.html"):
                if f not in search_files:
                    search_files.append(f)
            for f in search_files:
                fname_l = f.name.lower()
                if "agenda" in fname_l or "logs_" in fname_l or "podcast" in fname_l:
                    continue
                if code_prefix and code_prefix in fname_l:
                    matches.append(f)
                    continue
                if short_title and len(short_title) >= 5 and short_title in fname_l:
                    matches.append(f)
                    continue
                try:
                    txt = f.read_text(encoding="utf-8", errors="replace")
                    if f"ref_id={course_ref_id}" in txt and ("block_cal_" in txt or "ilObjCourseGUI" in txt):
                        matches.append(f)
                except Exception:
                    pass
            if matches:
                break
        return matches

    async def _import_single_course(
        self,
        client: IliasClient,
        course: CourseItem,
    ) -> Tuple[CourseCalendarInfo, List[CalendarEvent]]:
        """
        Discover and import a single course's calendar from ILIAS (or local HTML dump fallback).
        Distinguishes imported_with_lectures, imported_deadlines_only, valid_empty,
        unavailable, failed, and session_expired.
        """
        course_url = (
            course.url
            if course.url and course.url.startswith("http")
            else f"{settings.ilias_base_url}/ilias.php?baseClass=ilrepositorygui&ref_id={course.ref_id}"
        )

        discoveries: List[ParsedCourseCalendarDiscovery] = []
        ical_feed_url: Optional[str] = None
        ics_events: List[CalendarEvent] = []
        session_expired = False
        request_failed = False

        if client.session_manager.has_cookies():
            try:
                async with client.session_manager.get_http_client() as http:
                    resp = await http.get(course_url)
                    client._check_response_for_session_loss(resp, course_url)
                    disc = parse_course_calendar_discovery(resp.text, course.ref_id, course.title)
                    discoveries.append(disc)

                    # If course has collapsed previous or upcoming sessions, fetch expanded session view
                    if disc.prev_sessions_url or disc.next_sessions_url:
                        sep = "&" if "?" in course_url else "?"
                        expanded_url = f"{course_url}{sep}crs_prev_sess=1&crs_next_sess=1"
                        try:
                            exp_resp = await http.get(expanded_url)
                            client._check_response_for_session_loss(exp_resp, expanded_url)
                            exp_disc = parse_course_calendar_discovery(exp_resp.text, course.ref_id, course.title)
                            discoveries.append(exp_disc)
                        except Exception as exp_err:
                            logger.debug(f"Expanded session fetch skipped for {course.ref_id}: {exp_err}")

                    # If course has an iCalendar subscription modal URL, fetch it and import the .ics feed
                    if disc.ical_modal_url:
                        try:
                            modal_resp = await http.get(disc.ical_modal_url)
                            client._check_response_for_session_loss(modal_resp, disc.ical_modal_url)
                            ical_feed_url = parse_ilias_subscription_modal(modal_resp.text)
                            if ical_feed_url:
                                ics_resp = await http.get(ical_feed_url)
                                if ics_resp.status_code == 200 and "BEGIN:VCALENDAR" in ics_resp.text:
                                    ics_events = parse_ics_feed(ics_resp.text, course.ref_id, course.title)
                        except Exception as ics_err:
                            logger.debug(f"iCal modal/feed fetch failed for {course.ref_id}: {ics_err}")
            except SessionExpiredError:
                session_expired = True
            except (httpx.HTTPError, Exception) as e:
                logger.warning(f"Failed live calendar fetch for course {course.ref_id}: {e}")
                request_failed = True
        else:
            session_expired = True

        # Fallback to local HTML dumps if live fetch did not succeed and local dumps exist for this course
        if not discoveries:
            dump_files = self._find_local_html_dumps_for_course(course.ref_id, course.title)
            for df in dump_files:
                try:
                    html_txt = df.read_text(encoding="utf-8", errors="replace")
                    disc = parse_course_calendar_discovery(html_txt, course.ref_id, course.title)
                    discoveries.append(disc)
                except Exception as dump_err:
                    logger.warning(f"Failed parsing local dump {df}: {dump_err}")

        if not discoveries:
            status: CourseCalendarFeedStatus = "failed" if request_failed else ("session_expired" if session_expired else "unavailable")
            info = CourseCalendarInfo(
                course_ref_id=course.ref_id,
                course_title=course.title,
                semester=course.semester,
                color=_default_color_for_course(course.ref_id),
                status=status,
                needs_manual_schedule=True,
                last_imported_at=datetime.now(timezone.utc),
            )
            info.status_message = _status_message_for_course(info)
            return info, []

        primary = discoveries[0]
        raw_events: List[CalendarEvent] = list(ics_events)
        for d in discoveries:
            raw_events.extend(d.events)

        deduped_events = combine_calendar_events(
            imported_events=raw_events,
            custom_rules=[],
            course_titles={course.ref_id: course.title},
        )

        lecture_count = sum(1 for e in deduped_events if e.kind == "lecture")
        deadline_count = len(deduped_events) - lecture_count

        if lecture_count > 0:
            final_status: CourseCalendarFeedStatus = "imported_with_lectures"
        elif deadline_count > 0:
            final_status = "imported_deadlines_only"
        elif any(d.has_calendar_block or d.ical_modal_url for d in discoveries) or ical_feed_url:
            final_status = "valid_empty"
        else:
            final_status = "unavailable"

        info = CourseCalendarInfo(
            course_ref_id=course.ref_id,
            course_title=course.title,
            semester=course.semester,
            color=_default_color_for_course(course.ref_id),
            status=final_status,
            needs_manual_schedule=(lecture_count == 0),
            has_calendar_block=any(d.has_calendar_block for d in discoveries),
            ical_modal_url=primary.ical_modal_url,
            ical_feed_url=ical_feed_url,
            open_calendar_url=primary.open_calendar_url,
            imported_event_count=len(deduped_events),
            imported_lecture_count=lecture_count,
            imported_deadline_count=deadline_count,
            last_imported_at=datetime.now(timezone.utc),
        )
        info.status_message = _status_message_for_course(info)
        return info, deduped_events

    def _is_course_cache_fresh(
        self,
        existing_info: Optional[Dict[str, Any]],
        course_semester: Optional[str],
        current_semester: str,
    ) -> bool:
        if not existing_info:
            return False
        status = existing_info.get("status")
        if status not in ("imported_with_lectures", "imported_deadlines_only", "valid_empty"):
            return False
        last_imp_raw = existing_info.get("last_imported_at")
        if not last_imp_raw:
            return False
        c_sem = (course_semester or existing_info.get("semester") or "").upper()
        # Past semesters (or undated groups once checked) never expire automatically
        if c_sem != current_semester.upper():
            return True
        # Current semester courses expire after CURRENT_SEMESTER_TTL_SECONDS
        try:
            last_dt = datetime.fromisoformat(str(last_imp_raw).replace("Z", "+00:00"))
            if last_dt.tzinfo is None:
                last_dt = last_dt.replace(tzinfo=timezone.utc)
            age_sec = (datetime.now(timezone.utc) - last_dt).total_seconds()
            return age_sec < CURRENT_SEMESTER_TTL_SECONDS
        except Exception:
            return True

    async def sync_semester_calendar(
        self,
        tenant_key: str,
        client: IliasClient,
        semester: Optional[str] = None,
        courses: Optional[List[CourseItem]] = None,
        force_refresh: bool = False,
        base_url: str = "http://localhost:8000",
    ) -> SemesterCalendarResponse:
        state = self._load_tenant_state(tenant_key)
        courses_dict: Dict[str, Any] = state.get("courses", {})
        colors_dict: Dict[str, str] = state.get("colors", {})
        ignored_dict: Dict[str, bool] = state.get("ignored_missing_schedule", {})
        imported_map: Dict[str, List[Dict[str, Any]]] = state.get("imported_events", {})

        current_sem = get_current_semester()
        target_courses = list(courses or [])
        if not target_courses and client.session_manager.has_cookies():
            try:
                if semester and semester.upper() != "ALL":
                    sem_resp = await client.get_semester_courses(semester=semester)
                    target_courses = sem_resp.courses
                else:
                    dash_resp = await client.get_my_courses()
                    target_courses = dash_resp.courses
            except Exception as e:
                logger.warning(f"Could not fetch courses for calendar sync ({semester}): {e}")

        # Sort target_courses newest semester first, then undated groups
        target_courses.sort(
            key=lambda c: (
                0 if c.semester else 1,
                -semester_order_key(c.semester or ""),
                c.title.lower(),
                c.ref_id,
            )
        )

        for idx, course in enumerate(target_courses):
            cid = course.ref_id
            existing_info = courses_dict.get(cid)
            c_color = colors_dict.get(cid) or (existing_info.get("color") if existing_info else None) or _default_color_for_course(cid, idx)
            colors_dict[cid] = c_color
            c_sem = course.semester or (existing_info.get("semester") if existing_info else None) or (
                semester if (semester and semester.upper() != "ALL") else None
            )

            if not force_refresh and self._is_course_cache_fresh(existing_info, c_sem, current_sem):
                if existing_info:
                    if c_sem and not existing_info.get("semester"):
                        existing_info["semester"] = c_sem
                    if course.item_type and existing_info.get("item_type") != course.item_type:
                        existing_info["item_type"] = course.item_type
                continue

            info, evs = await self._import_single_course(client, course)
            info.color = c_color
            info.semester = c_sem
            info.item_type = course.item_type or (existing_info.get("item_type") if existing_info else "crs") or "crs"
            info.ignored_missing_schedule = bool(ignored_dict.get(cid, existing_info.get("ignored_missing_schedule", False) if existing_info else False))

            # If re-import failed or session expired, keep any previously imported events so data isn't lost
            if info.status in ("failed", "session_expired") and cid in imported_map and imported_map[cid]:
                if existing_info and existing_info.get("last_imported_at"):
                    info.last_imported_at = existing_info.get("last_imported_at")
            else:
                imported_map[cid] = [e.model_dump(mode="json") for e in evs]

            courses_dict[cid] = info.model_dump(mode="json")

        state["courses"] = courses_dict
        state["colors"] = colors_dict
        state["imported_events"] = imported_map
        self._save_tenant_state(tenant_key, state)

        return self.build_semester_response(
            tenant_key=tenant_key,
            semester=semester,
            base_url=base_url,
            seed_courses=target_courses,
        )

    def _validate_rule_input(self, rule_in: CourseScheduleRuleInput) -> None:
        if not rule_in.weekdays or any(w < 0 or w > 6 for w in rule_in.weekdays):
            raise ValueError(t("calendar.validation.weekdays_required"))
        if not re.match(r"^\d{2}:\d{2}$", rule_in.start_time) or not re.match(r"^\d{2}:\d{2}$", rule_in.end_time):
            raise ValueError(t("calendar.validation.invalid_time"))
        if rule_in.end_time <= rule_in.start_time:
            raise ValueError(t("calendar.validation.end_after_start_time"))
        if not re.match(r"^\d{4}-\d{2}-\d{2}$", rule_in.start_date) or not re.match(r"^\d{4}-\d{2}-\d{2}$", rule_in.end_date):
            raise ValueError(t("calendar.validation.invalid_date"))
        if rule_in.end_date < rule_in.start_date:
            raise ValueError(t("calendar.validation.end_after_start_date"))

    def create_rule(
        self,
        tenant_key: str,
        rule_in: CourseScheduleRuleInput,
        base_url: str = "http://localhost:8000",
    ) -> SemesterCalendarResponse:
        self._validate_rule_input(rule_in)
        state = self._load_tenant_state(tenant_key)
        now = datetime.now(timezone.utc)
        new_rule = CourseScheduleRule(
            **rule_in.model_dump(),
            id=str(uuid.uuid4()),
            created_at=now,
            updated_at=now,
        )
        rules = state.get("rules", [])
        rules.append(new_rule.model_dump(mode="json"))
        state["rules"] = rules

        # Ensure course is registered in courses_dict
        courses_dict = state.get("courses", {})
        colors_dict = state.get("colors", {})
        if rule_in.course_ref_id not in courses_dict:
            c_color = colors_dict.get(rule_in.course_ref_id) or _default_color_for_course(rule_in.course_ref_id, len(courses_dict))
            colors_dict[rule_in.course_ref_id] = c_color
            courses_dict[rule_in.course_ref_id] = CourseCalendarInfo(
                course_ref_id=rule_in.course_ref_id,
                course_title=rule_in.course_title or f"Course {rule_in.course_ref_id}",
                semester=rule_in.semester,
                color=c_color,
                status="not_imported",
                needs_manual_schedule=False,
            ).model_dump(mode="json")
            state["courses"] = courses_dict
            state["colors"] = colors_dict

        self._save_tenant_state(tenant_key, state)
        return self.build_semester_response(tenant_key, None, base_url=base_url)

    def update_rule(
        self,
        tenant_key: str,
        rule_id: str,
        rule_in: CourseScheduleRuleInput,
        base_url: str = "http://localhost:8000",
    ) -> SemesterCalendarResponse:
        self._validate_rule_input(rule_in)
        state = self._load_tenant_state(tenant_key)
        rules: List[Dict[str, Any]] = state.get("rules", [])
        found = False
        now = datetime.now(timezone.utc)

        for idx, r in enumerate(rules):
            if r.get("id") == rule_id:
                created_at = r.get("created_at") or now.isoformat()
                updated = CourseScheduleRule(
                    **rule_in.model_dump(),
                    id=rule_id,
                    created_at=created_at,
                    updated_at=now,
                )
                rules[idx] = updated.model_dump(mode="json")
                found = True
                break

        if not found:
            raise KeyError(f"Rule {rule_id} not found")

        state["rules"] = rules
        self._save_tenant_state(tenant_key, state)
        return self.build_semester_response(tenant_key, None, base_url=base_url)

    def duplicate_rule(
        self,
        tenant_key: str,
        rule_id: str,
        semester: Optional[str] = None,
        base_url: str = "http://localhost:8000",
    ) -> SemesterCalendarResponse:
        state = self._load_tenant_state(tenant_key)
        rules: List[Dict[str, Any]] = state.get("rules", [])
        target: Optional[Dict[str, Any]] = None
        for r in rules:
            if r.get("id") == rule_id:
                target = dict(r)
                break
        if not target:
            raise KeyError(f"Rule {rule_id} not found")

        now = datetime.now(timezone.utc).isoformat()
        target["id"] = str(uuid.uuid4())
        target["created_at"] = now
        target["updated_at"] = now
        rules.append(target)
        state["rules"] = rules
        self._save_tenant_state(tenant_key, state)
        return self.build_semester_response(tenant_key, semester, base_url=base_url)

    def delete_rule(
        self,
        tenant_key: str,
        rule_id: str,
        semester: Optional[str] = None,
        base_url: str = "http://localhost:8000",
    ) -> SemesterCalendarResponse:
        state = self._load_tenant_state(tenant_key)
        rules: List[Dict[str, Any]] = state.get("rules", [])
        new_rules = [r for r in rules if r.get("id") != rule_id]
        if len(new_rules) == len(rules):
            raise KeyError(f"Rule {rule_id} not found")
        state["rules"] = new_rules
        self._save_tenant_state(tenant_key, state)
        return self.build_semester_response(tenant_key, semester, base_url=base_url)

    def update_course_color(
        self,
        tenant_key: str,
        course_ref_id: str,
        color: str,
        semester: Optional[str] = None,
        base_url: str = "http://localhost:8000",
    ) -> SemesterCalendarResponse:
        if not re.match(r"^#[0-9a-fA-F]{6}$", (color or "").strip()):
            raise ValueError("Invalid hex color")
        state = self._load_tenant_state(tenant_key)
        colors = state.get("colors", {})
        colors[course_ref_id] = color.upper()
        courses = state.get("courses", {})
        if course_ref_id in courses:
            courses[course_ref_id]["color"] = color.upper()
        state["colors"] = colors
        state["courses"] = courses
        self._save_tenant_state(tenant_key, state)
        return self.build_semester_response(tenant_key, semester, base_url=base_url)

    def update_course_ignored_missing_schedule(
        self,
        tenant_key: str,
        course_ref_id: str,
        ignored: bool,
        semester: Optional[str] = None,
        base_url: str = "http://localhost:8000",
    ) -> SemesterCalendarResponse:
        state = self._load_tenant_state(tenant_key)
        ignored_map = state.get("ignored_missing_schedule", {})
        if ignored:
            ignored_map[course_ref_id] = True
        else:
            ignored_map.pop(course_ref_id, None)
        courses = state.get("courses", {})
        if course_ref_id in courses:
            courses[course_ref_id]["ignored_missing_schedule"] = bool(ignored)
        state["ignored_missing_schedule"] = ignored_map
        state["courses"] = courses
        self._save_tenant_state(tenant_key, state)
        return self.build_semester_response(tenant_key, semester, base_url=base_url)

    def import_raw_ics_for_course(
        self,
        tenant_key: str,
        course_ref_id: str,
        ics_content: str,
        course_title: Optional[str] = None,
        semester: Optional[str] = None,
        base_url: str = "http://localhost:8000",
    ) -> SemesterCalendarResponse:
        state = self._load_tenant_state(tenant_key)
        courses_dict = state.get("courses", {})
        colors_dict = state.get("colors", {})
        ignored_dict = state.get("ignored_missing_schedule", {})
        imported_map = state.get("imported_events", {})

        existing_c = courses_dict.get(course_ref_id, {})
        c_title = course_title or existing_c.get("course_title") or f"Course {course_ref_id}"
        c_color = colors_dict.get(course_ref_id) or existing_c.get("color") or _default_color_for_course(course_ref_id, len(courses_dict))
        c_sem = semester or existing_c.get("semester")
        colors_dict[course_ref_id] = c_color

        parsed_events = parse_ics_feed(ics_content, course_ref_id, c_title)
        deduped = combine_calendar_events(parsed_events, [], {course_ref_id: c_title})
        imported_map[course_ref_id] = [e.model_dump(mode="json") for e in deduped]

        lecture_cnt = sum(1 for e in deduped if e.kind == "lecture")
        deadline_cnt = len(deduped) - lecture_cnt
        status: CourseCalendarFeedStatus = (
            "imported_with_lectures"
            if lecture_cnt > 0
            else ("imported_deadlines_only" if deadline_cnt > 0 else "valid_empty")
        )
        is_ignored = bool(ignored_dict.get(course_ref_id, existing_c.get("ignored_missing_schedule", False)))

        info = CourseCalendarInfo(
            course_ref_id=course_ref_id,
            course_title=c_title,
            semester=c_sem,
            item_type=existing_c.get("item_type") or "crs",
            color=c_color,
            status=status,
            ignored_missing_schedule=is_ignored,
            needs_manual_schedule=(lecture_cnt == 0 and not is_ignored),
            has_calendar_block=True,
            imported_event_count=len(deduped),
            imported_lecture_count=lecture_cnt,
            imported_deadline_count=deadline_cnt,
            last_imported_at=datetime.now(timezone.utc),
        )
        info.status_message = _status_message_for_course(info)
        courses_dict[course_ref_id] = info.model_dump(mode="json")

        state["courses"] = courses_dict
        state["colors"] = colors_dict
        state["imported_events"] = imported_map
        self._save_tenant_state(tenant_key, state)
        return self.build_semester_response(tenant_key, None, base_url=base_url)

    def export_semester_ics(
        self,
        tenant_key: str,
        semester: Optional[str] = None,
        course_ids: Optional[List[str]] = None,
    ) -> str:
        cal_resp = self.build_semester_response(tenant_key, semester)
        events = cal_resp.events
        if course_ids:
            allowed = set(course_ids)
            events = [e for e in events if e.course_ref_id in allowed]
        return generate_ics_feed(events=events, semester=semester or get_current_semester())

    def rotate_subscription_token(
        self,
        tenant_key: str,
        semester: Optional[str] = None,
        base_url: str = "http://localhost:8000",
    ) -> CalendarSubscriptionResponse:
        state = self._load_tenant_state(tenant_key)
        tokens = self._load_tokens()
        effective_sem = semester or "ALL"

        old_token = state.get("subscription_token")
        if old_token and old_token in tokens:
            del tokens[old_token]

        new_token = secrets.token_urlsafe(32)
        now = datetime.now(timezone.utc)
        tokens[new_token] = {
            "tenant_key": tenant_key,
            "semester": effective_sem,
            "created_at": now.isoformat(),
        }
        self._save_tokens(tokens)

        state["subscription_token"] = new_token
        state["subscription_semester"] = effective_sem
        state["subscription_created_at"] = now.isoformat()
        self._save_tenant_state(tenant_key, state)

        sub_url, webcal_url, is_local = self._build_subscription_urls(new_token, base_url, effective_sem)
        clean_base = base_url.rstrip("/")
        dl_url = f"{clean_base}/api/calendar/export.ics"

        return CalendarSubscriptionResponse(
            token=new_token,
            subscription_url=sub_url or "",
            webcal_url=webcal_url or "",
            download_url=dl_url,
            is_local_host=is_local,
            created_at=now,
        )

    def revoke_subscription_token(self, tenant_key: str) -> None:
        state = self._load_tenant_state(tenant_key)
        tokens = self._load_tokens()
        old_token = state.get("subscription_token")
        if old_token and old_token in tokens:
            del tokens[old_token]
            self._save_tokens(tokens)
        state["subscription_token"] = None
        self._save_tenant_state(tenant_key, state)

    def get_feed_by_token(self, token: str, semester_override: Optional[str] = None) -> Optional[Tuple[str, str]]:
        """Resolve a private subscription token and return (semester, ics_text) or None if invalid/revoked."""
        tokens = self._load_tokens()
        meta = tokens.get(token)
        if not meta:
            return None
        tenant_key = meta.get("tenant_key") or "default"
        stored_sem = meta.get("semester")
        semester = semester_override or (None if stored_sem == "ALL" else stored_sem)
        ics_text = self.export_semester_ics(tenant_key=tenant_key, semester=semester)
        return (semester or get_current_semester()), ics_text


calendar_service = CalendarService()

