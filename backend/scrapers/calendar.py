from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta, timezone, tzinfo
import hashlib
import re
from typing import Any, Dict, List, Optional, Set, Tuple
import urllib.parse
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from bs4 import BeautifulSoup

from backend.config import settings
from backend.i18n import t
from backend.schemas import (
    CalendarEvent,
    CalendarEventKind,
    CourseCalendarFeedStatus,
    CourseScheduleRule,
)
from backend.scrapers.dashboard import _extract_ref_id_from_url
from backend.scrapers.dumper import safe_parser


def _last_sunday(year: int, month: int) -> date:
    """Return the date of the last Sunday of the given month and year."""
    if month == 12:
        last_day = date(year, 12, 31)
    else:
        last_day = date(year, month + 1, 1) - timedelta(days=1)
    offset = (last_day.weekday() + 1) % 7
    return last_day - timedelta(days=offset)


class _EuropeZurichTz(tzinfo):
    """
    Pure-Python IANA Europe/Zurich tzinfo implementation (CET/CEST) for Windows environments
    where the optional tzdata wheel is not installed.
    """

    def utcoffset(self, dt: Optional[datetime]) -> timedelta:
        if dt is None:
            return timedelta(hours=1)
        return timedelta(hours=2) if self._is_dst(dt) else timedelta(hours=1)

    def dst(self, dt: Optional[datetime]) -> timedelta:
        if dt is None:
            return timedelta(0)
        return timedelta(hours=1) if self._is_dst(dt) else timedelta(0)

    def tzname(self, dt: Optional[datetime]) -> str:
        return "CEST" if (dt is not None and self._is_dst(dt)) else "CET"

    def _is_dst(self, dt: datetime) -> bool:
        year = dt.year
        march_sun = _last_sunday(year, 3)
        oct_sun = _last_sunday(year, 10)
        naive = dt.replace(tzinfo=None)
        # Transition in March: 02:00 local jumps to 03:00
        start_local = datetime(year, 3, march_sun.day, 2, 0, 0)
        # Transition in October: 03:00 CEST falls back to 02:00 CET
        end_local = datetime(year, 10, oct_sun.day, 3, 0, 0)
        if naive < start_local or naive >= end_local:
            return False
        if datetime(year, 10, oct_sun.day, 2, 0, 0) <= naive < end_local:
            return getattr(dt, "fold", 0) == 0
        return True


try:
    ZURICH_TZ: tzinfo = ZoneInfo("Europe/Zurich")
except ZoneInfoNotFoundError:
    ZURICH_TZ = _EuropeZurichTz()

WEEKDAY_MAP = {
    "MO": 0,
    "TU": 1,
    "WE": 2,
    "TH": 3,
    "FR": 4,
    "SA": 5,
    "SU": 6,
}

MONTH_MAP = {
    "jan": 1, "januar": 1, "january": 1,
    "feb": 2, "februar": 2, "february": 2,
    "mär": 3, "maer": 3, "märz": 3, "mar": 3, "march": 3,
    "apr": 4, "april": 4,
    "mai": 5, "may": 5,
    "jun": 6, "juni": 6, "june": 6,
    "jul": 7, "juli": 7, "july": 7,
    "aug": 8, "august": 8,
    "sep": 9, "sept": 9, "september": 9,
    "okt": 10, "oktober": 10, "oct": 10, "october": 10,
    "nov": 11, "november": 11,
    "dez": 12, "dezember": 12, "dec": 12, "december": 12,
}


def make_stable_uid(prefix: str, key: str) -> str:
    digest = hashlib.sha256(key.encode("utf-8")).hexdigest()[:24]
    return f"betterilias-{prefix}-{digest}@betterilias.local"


def get_semester_date_bounds(semester: str) -> Tuple[date, date, date]:
    """
    Return (start_date, mid_date, end_date) for a Uni Bern semester code (e.g. HS2026, FS2026).
    HS: ISO week 38 Monday through ISO week 51 Friday (14 weeks; midpoint after 7 weeks).
    FS: ISO week 8 Monday through ISO week 22 Friday (15 weeks; midpoint after 7 weeks).
    """
    m = re.match(r"^(HS|FS)(\d{4})$", (semester or "").strip().upper())
    if not m:
        year = date.today().year
        sem_type = "HS" if date.today().month >= 7 else "FS"
    else:
        sem_type, year_str = m.group(1), m.group(2)
        year = int(year_str)

    if sem_type == "HS":
        try:
            start_d = date.fromisocalendar(year, 38, 1)
            end_d = date.fromisocalendar(year, 51, 5)
        except ValueError:
            start_d = date(year, 9, 14)
            end_d = date(year, 12, 18)
        mid_d = start_d + timedelta(weeks=6, days=4)  # Friday of 7th week
    else:
        try:
            start_d = date.fromisocalendar(year, 8, 1)
            end_d = date.fromisocalendar(year, 22, 5)
        except ValueError:
            start_d = date(year, 2, 16)
            end_d = date(year, 5, 29)
        mid_d = start_d + timedelta(weeks=6, days=4)

    return start_d, mid_d, end_d


def strip_course_code_prefix(title: str) -> str:
    """Strip UniBe course code prefix like '2406-HS2026-0: ' or 'HS2026: 43085 ' for readable display."""
    if not title:
        return ""
    cleaned = re.sub(r"^\d+-(?:HS|FS)\d{4}-\d+\s*:\s*", "", title.strip(), flags=re.I)
    cleaned = re.sub(r"^(?:HS|FS)\d{4}\s*:\s*(?:\d+(?:/\d+)?\s+)?", "", cleaned, flags=re.I)
    return cleaned.strip() or title.strip()


@dataclass
class ParsedCourseCalendarDiscovery:
    course_ref_id: str
    course_title: str
    has_calendar_block: bool = False
    ical_modal_url: Optional[str] = None
    open_calendar_url: Optional[str] = None
    upcoming_events_url: Optional[str] = None
    prev_sessions_url: Optional[str] = None
    next_sessions_url: Optional[str] = None
    reference_date: Optional[date] = None
    mini_calendar_dates: List[str] = field(default_factory=list)
    events: List[CalendarEvent] = field(default_factory=list)
    exercise_titles: List[str] = field(default_factory=list)
    status: CourseCalendarFeedStatus = "unavailable"


@dataclass
class ParsedIliasAgendaCategory:
    category_id: str
    title: str
    ref_id: Optional[str]
    color: str
    checked: bool
    calendar_url: Optional[str]
    item_type: str = "crs"


@dataclass
class ParsedIliasAgendaPage:
    ical_modal_url: Optional[str] = None
    seed_date: Optional[str] = None
    categories: List[ParsedIliasAgendaCategory] = field(default_factory=list)
    events: List[CalendarEvent] = field(default_factory=list)


def _parse_date_token(raw_date_str: str, reference_date: Optional[date] = None) -> Optional[date]:
    """Parse ILIAS date strings like '21. Oct 2026', '30. Sep 2026', 'Today', 'Tomorrow', 'Heute', 'Morgen'."""
    if not raw_date_str:
        return None
    s = raw_date_str.strip()
    s_lower = s.lower()
    ref = reference_date or date.today()
    if s_lower in ("today", "heute"):
        return ref
    if s_lower in ("tomorrow", "morgen"):
        return ref + timedelta(days=1)
    if s_lower in ("yesterday", "gestern"):
        return ref - timedelta(days=1)

    m = re.search(r"(\d{1,2})\.\s*([A-Za-zäöüÄÖÜ]+)\.?\s*(\d{4})", s)
    if m:
        day = int(m.group(1))
        month_raw = m.group(2).lower()
        year = int(m.group(3))
        month = MONTH_MAP.get(month_raw) or MONTH_MAP.get(month_raw[:3])
        if month:
            try:
                return date(year, month, day)
            except ValueError:
                return None

    m_iso = re.search(r"(\d{4})-(\d{2})-(\d{2})", s)
    if m_iso:
        try:
            return date(int(m_iso.group(1)), int(m_iso.group(2)), int(m_iso.group(3)))
        except ValueError:
            return None

    return None


def _build_timed_event(
    uid: str,
    course_ref_id: str,
    course_title: str,
    title: str,
    ev_date: date,
    start_hhmm: str,
    end_hhmm: str,
    source: str,
    kind: CalendarEventKind = "lecture",
    location: Optional[str] = None,
    description: Optional[str] = None,
    rule_id: Optional[str] = None,
) -> CalendarEvent:
    sh, sm = [int(x) for x in start_hhmm.split(":")[:2]]
    eh, em = [int(x) for x in end_hhmm.split(":")[:2]]
    start_dt = datetime.combine(ev_date, time(sh, sm), tzinfo=ZURICH_TZ)
    end_date = ev_date if (eh, em) > (sh, sm) else ev_date + timedelta(days=1)
    end_dt = datetime.combine(end_date, time(eh, em), tzinfo=ZURICH_TZ)
    return CalendarEvent(
        uid=uid,
        course_ref_id=course_ref_id,
        course_title=course_title,
        title=title,
        description=description,
        location=location,
        date=ev_date.isoformat(),
        end_date=end_date.isoformat(),
        start_time=f"{sh:02d}:{sm:02d}",
        end_time=f"{eh:02d}:{em:02d}",
        start_iso=start_dt.isoformat(),
        end_iso=end_dt.isoformat(),
        all_day=False,
        source=source,  # type: ignore[arg-type]
        kind=kind,
        rule_id=rule_id,
    )


def _build_all_day_event(
    uid: str,
    course_ref_id: str,
    course_title: str,
    title: str,
    ev_date: date,
    source: str,
    kind: CalendarEventKind = "deadline",
    end_date: Optional[date] = None,
    location: Optional[str] = None,
    description: Optional[str] = None,
) -> CalendarEvent:
    ed = end_date or ev_date
    return CalendarEvent(
        uid=uid,
        course_ref_id=course_ref_id,
        course_title=course_title,
        title=title,
        description=description,
        location=location,
        date=ev_date.isoformat(),
        end_date=ed.isoformat(),
        start_time=None,
        end_time=None,
        start_iso=ev_date.isoformat(),
        end_iso=ed.isoformat(),
        all_day=True,
        source=source,  # type: ignore[arg-type]
        kind=kind,
    )


@safe_parser(context_name="course_calendar_discovery")
def parse_course_calendar_discovery(
    html_content: str,
    course_ref_id: str,
    course_title: str = "",
) -> ParsedCourseCalendarDiscovery:
    """
    Inspect an ILIAS course repository page to discover:
    - Right-sidebar Calendar block (#block_cal_*)
    - iCalendar subscription modal AJAX URL (ilcalendarsubscriptiongui&cmd=getModalForSubscription)
    - Open Calendar & Upcoming Events URLs
    - Mini-calendar highlighted appointment days (a.calminiapp)
    - Course Session (sess) items and Show all previous/upcoming sessions links
    """
    soup = BeautifulSoup(html_content, "lxml")

    if not course_title:
        title_elem = (
            soup.select_one("h1.il-page-content-header, h1.ilHeader:not(.modal-title), h1.media-heading:not(.modal-title)")
            or soup.select_one(".ilTopTitle")
        )
        if title_elem:
            raw_t = title_elem.get_text(" ", strip=True)
            course_title = re.sub(r"^(View:\s*)?(Content:\s*)?(Inhalt:\s*)?", "", raw_t, flags=re.I).strip()
        if not course_title:
            course_title = f"Course {course_ref_id}"

    discovery = ParsedCourseCalendarDiscovery(
        course_ref_id=course_ref_id,
        course_title=course_title,
    )

    # 1. Detect Calendar block (#block_cal_*)
    cal_block = soup.find(id=re.compile(r"^block_cal_\d+"))
    if cal_block:
        discovery.has_calendar_block = True

        # Mini-calendar today cell gives us the exact reference date of the HTML dump/page
        today_link = cal_block.select_one("td.calminitoday a[href*='seed=']")
        if today_link:
            m_seed = re.search(r"seed=(\d{4}-\d{2}-\d{2})", today_link.get("href", ""))
            if m_seed:
                discovery.reference_date = _parse_date_token(m_seed.group(1))

        # Mini-calendar appointment days (a.calminiapp)
        seen_dates: Set[str] = set()
        for app_a in cal_block.select("a.calminiapp"):
            href = app_a.get("href", "")
            m_seed = re.search(r"seed=(\d{4}-\d{2}-\d{2})", href)
            if m_seed:
                d_str = m_seed.group(1)
                if d_str not in seen_dates:
                    seen_dates.add(d_str)
                    discovery.mini_calendar_dates.append(d_str)

        # Open Calendar and Upcoming Events links inside the block
        for ctrl in cal_block.find_all(["a", "button"]):
            action = (ctrl.get("data-action") or ctrl.get("href") or "").strip()
            if not action or action == "#":
                continue
            full_action = urllib.parse.urljoin(settings.ilias_base_url + "/", action.lstrip("/"))
            if "setpdmodeevents" in action.lower():
                discovery.upcoming_events_url = full_action
                if not discovery.reference_date:
                    m_seed = re.search(r"seed=(\d{4}-\d{2}-\d{2})", action)
                    if m_seed:
                        discovery.reference_date = _parse_date_token(m_seed.group(1))
            elif "ilcalendarpresentationgui" in action.lower() and "seed=" not in action.lower():
                discovery.open_calendar_url = full_action

    # 2. Extract iCalendar Subscription Modal AJAX URL from inline scripts
    m_modal = re.search(
        r"""["']([^"']*ilcalendarsubscriptiongui[^"']*cmd=getModalForSubscription[^"']*)["']""",
        html_content,
        flags=re.I,
    )
    if m_modal:
        raw_modal_url = m_modal.group(1).replace("&amp;", "&").replace(r"\/", "/")
        discovery.ical_modal_url = urllib.parse.urljoin(
            settings.ilias_base_url + "/", raw_modal_url.lstrip("/")
        )
        discovery.has_calendar_block = True

    # 3. Check for 'Show all previous sessions' and 'Show all upcoming sessions' links
    for a in soup.find_all("a", href=True):
        href = a["href"]
        if "crs_prev_sess=1" in href:
            discovery.prev_sessions_url = urllib.parse.urljoin(
                settings.ilias_base_url + "/", href.lstrip("/")
            )
        elif "crs_next_sess=1" in href:
            discovery.next_sessions_url = urllib.parse.urljoin(
                settings.ilias_base_url + "/", href.lstrip("/")
            )

    # 4. Detect Exercise items on the course page (for contextualising deadline-only calendars)
    for exc_img in soup.select("img[src*='icon_exc'], img[alt='Exercise'], img[alt='Übung']"):
        row = exc_img.find_parent(class_=re.compile(r"ilObjListRow|ilContainerListItemOuter|il-item"))
        if row:
            title_el = row.select_one("h3 a, h4 a, .il_ContainerItemTitle a, .il-item-title a, .il_ContainerItemTitle")
            if title_el:
                exc_t = title_el.get_text(" ", strip=True)
                if exc_t and exc_t not in discovery.exercise_titles:
                    discovery.exercise_titles.append(exc_t)

    # 5. Extract Course Session (sess) items directly from the course page
    session_lis = [
        li for li in soup.select("li.ilObjListRow, .ilContainerItemsContainer > li")
        if "sess" in li.get("id", "") or li.find("img", alt="Session") or li.select_one("img[src*='icon_sess']")
    ]
    seen_sess_ids: Set[str] = set()
    covered_dates: Set[str] = set()

    for sli in session_lis:
        title_a = sli.select_one("h3 a, h4 a, .il_ContainerItemTitle a, .il-item-title a")
        if not title_a or not title_a.get_text(strip=True):
            for a in sli.find_all("a"):
                if a.get_text(strip=True):
                    title_a = a
                    break
        if not title_a:
            continue

        raw_sess_title = " ".join(title_a.get_text(" ", strip=True).split())
        if not raw_sess_title or "previous sessions" in raw_sess_title.lower() or "upcoming sessions" in raw_sess_title.lower():
            continue

        raw_sess_id = sli.get("id", "")
        sess_m = re.search(r"sess-(\d+)", raw_sess_id)
        sess_ref_id = sess_m.group(1) if sess_m else (_extract_ref_id_from_url(title_a.get("href", "")) or raw_sess_title)
        if sess_ref_id in seen_sess_ids:
            continue
        seen_sess_ids.add(sess_ref_id)

        # Typical format:
        # "21. Oct 2026, 16:15 - 19:00: Personal und Organisation"
        # "Tomorrow, 16:15 - 19:00: Personal und Organisation"
        # "Today, 09:15 - 12:00: Mensch-Maschine-Schnittstelle"
        # "18. Feb 2025, 14:15 - 16:00"
        date_part_m = re.match(
            r"^((?:\d{1,2}\.\s*[A-Za-zäöüÄÖÜ]+\.?\s*\d{4})|Today|Tomorrow|Yesterday|Heute|Morgen|Gestern)\s*(?:,\s*(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2}))?(?:\s*:\s*(.*))?$",
            raw_sess_title,
            flags=re.I,
        )
        ev_date: Optional[date] = None
        start_hhmm: Optional[str] = None
        end_hhmm: Optional[str] = None
        clean_label = raw_sess_title

        if date_part_m:
            ev_date = _parse_date_token(date_part_m.group(1), discovery.reference_date)
            if date_part_m.group(2) and date_part_m.group(3):
                start_hhmm = date_part_m.group(2)
                end_hhmm = date_part_m.group(3)
            if date_part_m.group(4):
                clean_label = date_part_m.group(4).strip()
            else:
                clean_label = strip_course_code_prefix(course_title)
        else:
            # Fallback regex search
            dm = re.search(r"(\d{1,2}\.\s*[A-Za-zäöüÄÖÜ]+\.?\s*\d{4})", raw_sess_title)
            if dm:
                ev_date = _parse_date_token(dm.group(1), discovery.reference_date)
            tm = re.search(r"(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})", raw_sess_title)
            if tm:
                start_hhmm, end_hhmm = tm.group(1), tm.group(2)
            if ":" in raw_sess_title and tm:
                after_time = raw_sess_title.split(tm.group(0), 1)[-1].lstrip(" :,-")
                if after_time:
                    clean_label = after_time

        if not ev_date:
            continue

        # Extract optional location or description from session item properties
        desc_el = sli.select_one(".il_Description, .il-item-description")
        description = desc_el.get_text(" ", strip=True) if desc_el else None
        location: Optional[str] = None
        for prop_el in sli.select(".il_ItemProperty, .il-item-properties"):
            ptxt = prop_el.get_text(" ", strip=True)
            loc_m = re.search(r"(?:Location|Ort|Raum|Room)\s*:\s*([^|]+)", ptxt, flags=re.I)
            if loc_m:
                location = loc_m.group(1).strip()
                break

        covered_dates.add(ev_date.isoformat())
        uid = make_stable_uid("sess", f"{course_ref_id}:{sess_ref_id}:{ev_date.isoformat()}")

        if start_hhmm and end_hhmm:
            discovery.events.append(
                _build_timed_event(
                    uid=uid,
                    course_ref_id=course_ref_id,
                    course_title=course_title,
                    title=clean_label or strip_course_code_prefix(course_title),
                    ev_date=ev_date,
                    start_hhmm=start_hhmm,
                    end_hhmm=end_hhmm,
                    source="ilias_session",
                    kind="lecture",
                    location=location,
                    description=description,
                )
            )
        else:
            discovery.events.append(
                _build_all_day_event(
                    uid=uid,
                    course_ref_id=course_ref_id,
                    course_title=course_title,
                    title=clean_label or strip_course_code_prefix(course_title),
                    ev_date=ev_date,
                    source="ilias_session",
                    kind="lecture",
                    location=location,
                    description=description,
                )
            )

    # 6. Include mini-calendar dates not already covered by sessions (e.g. Exercise deadlines in Computergrafik)
    has_sessions = any(e.kind == "lecture" for e in discovery.events)
    for d_str in discovery.mini_calendar_dates:
        if d_str in covered_dates:
            continue
        ev_d = _parse_date_token(d_str)
        if not ev_d:
            continue
        covered_dates.add(d_str)
        if not has_sessions and discovery.exercise_titles:
            label = f"{discovery.exercise_titles[0]} – {t('Abgabe / Termin')}"
            kind: CalendarEventKind = "deadline"
        else:
            label = f"{strip_course_code_prefix(course_title)} – {t('Kalendertermin')}"
            kind = "appointment" if has_sessions else "deadline"

        uid = make_stable_uid("calblk", f"{course_ref_id}:{d_str}")
        discovery.events.append(
            _build_all_day_event(
                uid=uid,
                course_ref_id=course_ref_id,
                course_title=course_title,
                title=label,
                ev_date=ev_d,
                source="ilias_calendar_block",
                kind=kind,
            )
        )

    # 7. Determine feed status
    lecture_count = sum(1 for e in discovery.events if e.kind == "lecture")
    other_count = len(discovery.events) - lecture_count
    if lecture_count > 0:
        discovery.status = "imported_with_lectures"
    elif other_count > 0:
        discovery.status = "imported_deadlines_only"
    elif discovery.has_calendar_block or discovery.ical_modal_url:
        discovery.status = "valid_empty"
    else:
        discovery.status = "unavailable"

    return discovery


@safe_parser(context_name="ilias_subscription_modal")
def parse_ilias_subscription_modal(html_content: str) -> Optional[str]:
    """
    Extract the iCalendar (.ics / calendar.php / webcal://) feed URL from ILIAS's
    ilCalendarSubscriptionGUI::getModalForSubscription response.
    """
    if not html_content:
        return None

    # Match webcal:// or http(s)://.../calendar.php?... or any .ics URL
    patterns = [
        r"""((?:webcals?|https?)://[^\s"'<>]+calendar\.php[^\s"'<>]*)""",
        r"""((?:webcals?|https?)://[^\s"'<>]+\.ics(?:\?[^\s"'<>]*)?)""",
    ]
    for pat in patterns:
        m = re.search(pat, html_content, flags=re.I)
        if m:
            url = m.group(1).replace("&amp;", "&").replace(r"\/", "/").strip()
            if url.lower().startswith("webcal://"):
                url = "https://" + url[len("webcal://"):]
            elif url.lower().startswith("webcals://"):
                url = "https://" + url[len("webcals://"):]
            return url

    soup = BeautifulSoup(html_content, "lxml")
    for inp in soup.find_all(["input", "textarea", "a"]):
        val = (inp.get("value") or inp.get("href") or inp.get_text(strip=True) or "").strip()
        if "calendar.php" in val or val.endswith(".ics"):
            if val.lower().startswith("webcal://"):
                val = "https://" + val[len("webcal://"):]
            elif val.lower().startswith("webcals://"):
                val = "https://" + val[len("webcals://"):]
            return urllib.parse.urljoin(settings.ilias_base_url + "/", val.lstrip("/"))

    return None


@safe_parser(context_name="ilias_agenda_page")
def parse_ilias_agenda_page(html_content: str) -> ParsedIliasAgendaPage:
    """
    Parse the native ILIAS Agenda/Calendar page (Agenda_ Calendar_ ILIAS Universität Bern.html)
    including the Calendar Selection panel (#block_cal_sel_0), subscription modal URL, and week grid.
    """
    soup = BeautifulSoup(html_content, "lxml")
    res = ParsedIliasAgendaPage()

    m_modal = re.search(
        r"""["']([^"']*ilcalendarsubscriptiongui[^"']*cmd=getModalForSubscription[^"']*)["']""",
        html_content,
        flags=re.I,
    )
    if m_modal:
        raw_url = m_modal.group(1).replace("&amp;", "&").replace(r"\/", "/")
        res.ical_modal_url = urllib.parse.urljoin(settings.ilias_base_url + "/", raw_url.lstrip("/"))

    for li in soup.select("#block_cal_sel_0 .ilCalSel li, .ilCalSelList .ilCalSel li"):
        cb = li.select_one("input[name='selected_cat_ids[]'], input[type='checkbox']")
        hidden = li.select_one("input[name='shown_cat_ids[]']")
        cat_id = (cb.get("value") if cb else None) or (hidden.get("value") if hidden else None)
        if not cat_id:
            continue
        checked = bool(cb and cb.has_attr("checked"))

        col_div = li.select_one(".ilCalColSpan")
        color = "#F47C94"
        if col_div and col_div.get("style"):
            cm = re.search(r"border-color\s*:\s*(#[0-9a-fA-F]{3,6})", col_div["style"])
            if cm:
                color = cm.group(1).upper()

        link = li.select_one(".ilCalSelTitle a, label a")
        lbl = li.select_one(".ilCalSelTitle label, label")
        title = (link.get_text(" ", strip=True) if link else "") or (lbl.get_text(" ", strip=True) if lbl else "")
        cal_url = None
        ref_id = None
        if link and link.get("href"):
            cal_url = urllib.parse.urljoin(settings.ilias_base_url + "/", link["href"].lstrip("/"))
            ref_id = _extract_ref_id_from_url(link["href"])

        img = li.select_one("img")
        icon_src = (img.get("src") or "").lower() if img else ""
        item_type = "grp" if "grp" in icon_src else "crs"

        res.categories.append(
            ParsedIliasAgendaCategory(
                category_id=str(cat_id),
                title=title,
                ref_id=ref_id,
                color=color,
                checked=checked,
                calendar_url=cal_url,
                item_type=item_type,
            )
        )

    return res


def _unfold_ics_lines(ics_text: str) -> List[str]:
    unfolded = re.sub(r"\r?\n[ \t]", "", ics_text or "")
    return [line.strip("\r") for line in unfolded.splitlines() if line.strip()]


def _unescape_ics_text(val: str) -> str:
    if not val:
        return ""
    return (
        val.replace(r"\n", "\n")
        .replace(r"\N", "\n")
        .replace(r"\,", ",")
        .replace(r"\;", ";")
        .replace(r"\\", "\\")
        .strip()
    )


def _escape_ics_text(val: str) -> str:
    if not val:
        return ""
    return (
        val.replace("\\", "\\\\")
        .replace(";", r"\;")
        .replace(",", r"\,")
        .replace("\r\n", r"\n")
        .replace("\n", r"\n")
    )


def _parse_ics_datetime_prop(prop_params: str, raw_val: str) -> Tuple[Optional[datetime], Optional[date], bool]:
    """
    Parse an iCalendar DTSTART/DTEND/EXDATE/UNTIL value.
    Returns (zoned_datetime_in_zurich, calendar_date, is_all_day).
    """
    val = raw_val.strip()
    params_upper = (prop_params or "").upper()

    # Date-only (all-day)
    if "VALUE=DATE" in params_upper or re.match(r"^\d{8}$", val):
        try:
            d = date(int(val[0:4]), int(val[4:6]), int(val[6:8]))
            return None, d, True
        except ValueError:
            return None, None, True

    m = re.match(r"^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$", val)
    if not m:
        return None, None, False

    y, mo, da, hh, mm, ss, is_utc = (
        int(m.group(1)),
        int(m.group(2)),
        int(m.group(3)),
        int(m.group(4)),
        int(m.group(5)),
        int(m.group(6)),
        bool(m.group(7)),
    )

    try:
        if is_utc:
            dt_utc = datetime(y, mo, da, hh, mm, ss, tzinfo=timezone.utc)
            dt_zh = dt_utc.astimezone(ZURICH_TZ)
            return dt_zh, dt_zh.date(), False

        tz_m = re.search(r"TZID=([^;:]+)", prop_params or "", flags=re.I)
        if tz_m:
            tz_name = tz_m.group(1).strip().strip('"')
            try:
                src_tz = ZoneInfo(tz_name)
            except Exception:
                src_tz = ZURICH_TZ
            dt_src = datetime(y, mo, da, hh, mm, ss, tzinfo=src_tz)
            dt_zh = dt_src.astimezone(ZURICH_TZ)
            return dt_zh, dt_zh.date(), False

        dt_zh = datetime(y, mo, da, hh, mm, ss, tzinfo=ZURICH_TZ)
        return dt_zh, dt_zh.date(), False
    except ValueError:
        return None, None, False


def _parse_ics_duration(raw_dur: str) -> timedelta:
    """Parse RFC 5545 DURATION string like PT1H45M, P1D, PT90M."""
    m = re.match(
        r"^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$",
        (raw_dur or "").strip().upper(),
    )
    if not m:
        return timedelta(hours=1)
    sign = -1 if m.group(1) == "-" else 1
    weeks = int(m.group(2) or 0)
    days = int(m.group(3) or 0)
    hours = int(m.group(4) or 0)
    minutes = int(m.group(5) or 0)
    seconds = int(m.group(6) or 0)
    return sign * timedelta(weeks=weeks, days=days, hours=hours, minutes=minutes, seconds=seconds)


def parse_ics_feed(
    ics_text: str,
    course_ref_id: str,
    course_title: str,
    range_start: Optional[date] = None,
    range_end: Optional[date] = None,
) -> List[CalendarEvent]:
    """
    Parse an RFC 5545 iCalendar (.ics) feed into normalized CalendarEvents in Europe/Zurich.
    Handles VEVENTs, UTC & TZID conversions across DST boundaries, RRULE (WEEKLY/DAILY,
    INTERVAL, BYDAY, UNTIL, COUNT), EXDATE, RDATE, STATUS:CANCELLED, and RECURRENCE-ID overrides.
    """
    lines = _unfold_ics_lines(ics_text)
    raw_vevents: List[List[Tuple[str, str, str]]] = []
    current_vevent: Optional[List[Tuple[str, str, str]]] = None

    for line in lines:
        if line.upper() == "BEGIN:VEVENT":
            current_vevent = []
        elif line.upper() == "END:VEVENT":
            if current_vevent is not None:
                raw_vevents.append(current_vevent)
            current_vevent = None
        elif current_vevent is not None and ":" in line:
            left, val = line.split(":", 1)
            if ";" in left:
                prop_name, prop_params = left.split(";", 1)
            else:
                prop_name, prop_params = left, ""
            current_vevent.append((prop_name.strip().upper(), prop_params.strip(), val.strip()))

    # Separate base VEVENTs from RECURRENCE-ID override VEVENTs
    overrides: Dict[Tuple[str, str], Dict[str, Any]] = {}
    base_entries: List[Dict[str, Any]] = []

    for props in raw_vevents:
        entry: Dict[str, Any] = {
            "exdates": set(),
            "rdates": [],
        }
        for name, params, val in props:
            if name == "UID":
                entry["uid"] = val
            elif name == "SUMMARY":
                entry["summary"] = _unescape_ics_text(val)
            elif name == "DESCRIPTION":
                entry["description"] = _unescape_ics_text(val)
            elif name == "LOCATION":
                entry["location"] = _unescape_ics_text(val)
            elif name == "STATUS":
                entry["status"] = val.upper()
            elif name == "DTSTART":
                entry["dtstart"] = (params, val)
            elif name == "DTEND":
                entry["dtend"] = (params, val)
            elif name == "DURATION":
                entry["duration"] = val
            elif name == "RRULE":
                entry["rrule"] = val
            elif name == "RECURRENCE-ID":
                _, rec_d, _ = _parse_ics_datetime_prop(params, val)
                if rec_d:
                    entry["recurrence_date"] = rec_d.isoformat()
            elif name == "EXDATE":
                for part in val.split(","):
                    _, ex_d, _ = _parse_ics_datetime_prop(params, part)
                    if ex_d:
                        entry["exdates"].add(ex_d.isoformat())
            elif name == "RDATE":
                for part in val.split(","):
                    r_dt, r_d, r_all = _parse_ics_datetime_prop(params, part)
                    if r_d:
                        entry["rdates"].append((r_dt, r_d, r_all))

        if "dtstart" not in entry:
            continue
        if "recurrence_date" in entry and "uid" in entry:
            overrides[(entry["uid"], entry["recurrence_date"])] = entry
        else:
            base_entries.append(entry)

    events: List[CalendarEvent] = []
    seen_event_keys: Set[str] = set()

    def _classify_kind(summary: str, desc: str, is_all_day: bool) -> CalendarEventKind:
        text_l = f"{summary} {desc}".lower()
        if any(w in text_l for w in ["deadline", "abgabe", "einreichung", "submission", "fällig", "due"]):
            return "deadline"
        if any(w in text_l for w in ["vorlesung", "lecture", "übung", "exercise", "sitzung", "session", "seminar", "praktikum", "kolloquium"]):
            return "lecture"
        if is_all_day:
            return "appointment"
        return "lecture"

    for entry in base_entries:
        raw_uid = entry.get("uid") or make_stable_uid("ics", f"{course_ref_id}:{entry.get('summary', '')}:{entry['dtstart']}")
        status = entry.get("status", "CONFIRMED")
        if status == "CANCELLED" and "rrule" not in entry:
            continue

        summary = entry.get("summary") or strip_course_code_prefix(course_title)
        description = entry.get("description")
        location = entry.get("location")
        start_dt, start_d, is_all_day = _parse_ics_datetime_prop(*entry["dtstart"])
        if not start_d:
            continue

        end_dt: Optional[datetime] = None
        end_d: Optional[date] = None
        if "dtend" in entry:
            end_dt, end_d, _ = _parse_ics_datetime_prop(*entry["dtend"])
        elif "duration" in entry:
            dur = _parse_ics_duration(entry["duration"])
            if is_all_day:
                end_d = start_d + dur
            elif start_dt:
                end_dt = (start_dt + dur).astimezone(ZURICH_TZ)
                end_d = end_dt.date()

        if is_all_day:
            # In RFC 5545, DTEND for VALUE=DATE is exclusive (e.g. next day for 1-day event)
            if end_d and end_d > start_d:
                inclusive_end_d = end_d - timedelta(days=1)
            else:
                inclusive_end_d = start_d
            duration_days = (inclusive_end_d - start_d).days
            duration_td = timedelta(days=duration_days)
        else:
            assert start_dt is not None
            if not end_dt or end_dt <= start_dt:
                end_dt = start_dt + timedelta(hours=2)
            duration_td = end_dt - start_dt

        kind = _classify_kind(summary, description or "", is_all_day)

        # Expand RRULE if present
        occurrence_dates: List[date] = [start_d]
        if "rrule" in entry:
            rrule_parts: Dict[str, str] = {}
            for kv in entry["rrule"].split(";"):
                if "=" in kv:
                    k, v = kv.split("=", 1)
                    rrule_parts[k.strip().upper()] = v.strip().upper()

            freq = rrule_parts.get("FREQ", "")
            interval = max(1, int(rrule_parts.get("INTERVAL", "1") or "1"))
            max_count = int(rrule_parts["COUNT"]) if "COUNT" in rrule_parts and rrule_parts["COUNT"].isdigit() else 500
            until_date: Optional[date] = None
            if "UNTIL" in rrule_parts:
                u_dt, u_d, _ = _parse_ics_datetime_prop("", rrule_parts["UNTIL"])
                until_date = u_d or (u_dt.date() if u_dt else None)

            bound_end = until_date or range_end or (start_d + timedelta(days=200))
            if range_end and bound_end > range_end:
                bound_end = range_end

            byday_tokens = [tok.strip()[-2:] for tok in rrule_parts.get("BYDAY", "").split(",") if tok.strip()]
            target_weekdays = [WEEKDAY_MAP[t] for t in byday_tokens if t in WEEKDAY_MAP]
            if not target_weekdays:
                target_weekdays = [start_d.weekday()]

            occurrence_dates = []
            generated_count = 0
            cur = start_d
            # Align week counter to Monday of start_d's week
            start_week_monday = start_d - timedelta(days=start_d.weekday())

            while cur <= bound_end and generated_count < max_count:
                if freq == "DAILY":
                    days_diff = (cur - start_d).days
                    if days_diff % interval == 0:
                        occurrence_dates.append(cur)
                        generated_count += 1
                elif freq == "WEEKLY":
                    cur_week_monday = cur - timedelta(days=cur.weekday())
                    weeks_diff = (cur_week_monday - start_week_monday).days // 7
                    if weeks_diff % interval == 0 and cur.weekday() in target_weekdays:
                        occurrence_dates.append(cur)
                        generated_count += 1
                cur += timedelta(days=1)

        # Include explicit RDATEs
        for _, r_d, _ in entry.get("rdates", []):
            if r_d not in occurrence_dates:
                occurrence_dates.append(r_d)

        occurrence_dates.sort()
        exdates: Set[str] = entry.get("exdates", set())

        for occ_d in occurrence_dates:
            occ_iso = occ_d.isoformat()
            if occ_iso in exdates:
                continue

            # Check if there is a RECURRENCE-ID override for this occurrence
            ov = overrides.get((raw_uid, occ_iso))
            if ov:
                if ov.get("status", "CONFIRMED") == "CANCELLED":
                    continue
                ov_summary = ov.get("summary") or summary
                ov_desc = ov.get("description", description)
                ov_loc = ov.get("location", location)
                ov_start_dt, ov_start_d, ov_all_day = _parse_ics_datetime_prop(*ov["dtstart"])
                if not ov_start_d:
                    continue
                if range_start and ov_start_d < range_start:
                    continue
                if range_end and ov_start_d > range_end:
                    continue
                ov_uid = make_stable_uid("ics", f"{course_ref_id}:{raw_uid}:{occ_iso}")
                if ov_all_day:
                    events.append(
                        _build_all_day_event(
                            uid=ov_uid,
                            course_ref_id=course_ref_id,
                            course_title=course_title,
                            title=ov_summary,
                            ev_date=ov_start_d,
                            source="ilias_ical",
                            kind=_classify_kind(ov_summary, ov_desc or "", True),
                            location=ov_loc,
                            description=ov_desc,
                        )
                    )
                elif ov_start_dt:
                    ov_end_dt = None
                    if "dtend" in ov:
                        ov_end_dt, _, _ = _parse_ics_datetime_prop(*ov["dtend"])
                    if not ov_end_dt or ov_end_dt <= ov_start_dt:
                        ov_end_dt = ov_start_dt + duration_td
                    events.append(
                        _build_timed_event(
                            uid=ov_uid,
                            course_ref_id=course_ref_id,
                            course_title=course_title,
                            title=ov_summary,
                            ev_date=ov_start_d,
                            start_hhmm=ov_start_dt.strftime("%H:%M"),
                            end_hhmm=ov_end_dt.strftime("%H:%M"),
                            source="ilias_ical",
                            kind=_classify_kind(ov_summary, ov_desc or "", False),
                            location=ov_loc,
                            description=ov_desc,
                        )
                    )
                continue

            if range_start and occ_d < range_start:
                continue
            if range_end and occ_d > range_end:
                continue

            occ_uid = (
                raw_uid
                if ("rrule" not in entry and not entry.get("rdates") and raw_uid.startswith("betterilias-"))
                else make_stable_uid("ics", f"{course_ref_id}:{raw_uid}:{occ_iso}")
            )
            if occ_uid in seen_event_keys:
                continue
            seen_event_keys.add(occ_uid)

            if is_all_day:
                events.append(
                    _build_all_day_event(
                        uid=occ_uid,
                        course_ref_id=course_ref_id,
                        course_title=course_title,
                        title=summary,
                        ev_date=occ_d,
                        end_date=occ_d + duration_td,
                        source="ilias_ical",
                        kind=kind,
                        location=location,
                        description=description,
                    )
                )
            else:
                assert start_dt is not None
                # Preserve wall-clock time in Europe/Zurich across DST transitions when expanding RRULEs!
                wall_start = datetime.combine(occ_d, start_dt.timetz().replace(tzinfo=None), tzinfo=ZURICH_TZ)
                wall_end = (wall_start + duration_td).astimezone(ZURICH_TZ)
                events.append(
                    _build_timed_event(
                        uid=occ_uid,
                        course_ref_id=course_ref_id,
                        course_title=course_title,
                        title=summary,
                        ev_date=occ_d,
                        start_hhmm=wall_start.strftime("%H:%M"),
                        end_hhmm=wall_end.strftime("%H:%M"),
                        source="ilias_ical",
                        kind=kind,
                        location=location,
                        description=description,
                    )
                )

    return events


def expand_schedule_rule(
    rule: CourseScheduleRule,
    course_title: str,
    range_start: Optional[date] = None,
    range_end: Optional[date] = None,
) -> List[CalendarEvent]:
    """
    Expand a custom weekly schedule rule into concrete CalendarEvents in Europe/Zurich.
    Handles multiple weekdays, start/end date bounds, exception dates, and DST transitions.
    """
    if not rule.enabled or not rule.weekdays:
        return []

    start_d = _parse_date_token(rule.start_date)
    end_d = _parse_date_token(rule.end_date)
    if not start_d or not end_d or end_d < start_d:
        return []

    if range_start and start_d < range_start:
        start_d = range_start
    if range_end and end_d > range_end:
        end_d = range_end

    weekdays_set = {w for w in rule.weekdays if 0 <= w <= 6}
    exceptions_set = {ex.strip() for ex in (rule.exceptions or []) if ex.strip()}
    display_course = course_title or rule.course_title or f"Course {rule.course_ref_id}"
    short_course = strip_course_code_prefix(display_course)
    event_title = (rule.title or "").strip() or short_course

    out: List[CalendarEvent] = []
    cur = start_d
    while cur <= end_d:
        cur_iso = cur.isoformat()
        if cur.weekday() in weekdays_set and cur_iso not in exceptions_set:
            uid = make_stable_uid(
                "rule",
                f"{rule.id}:{rule.course_ref_id}:{cur_iso}:{rule.start_time}:{rule.end_time}",
            )
            out.append(
                _build_timed_event(
                    uid=uid,
                    course_ref_id=rule.course_ref_id,
                    course_title=display_course,
                    title=event_title,
                    ev_date=cur,
                    start_hhmm=rule.start_time,
                    end_hhmm=rule.end_time,
                    source="custom_rule",
                    kind="lecture",
                    location=rule.location,
                    rule_id=rule.id,
                )
            )
        cur += timedelta(days=1)

    return out


def combine_calendar_events(
    imported_events: List[CalendarEvent],
    custom_rules: List[CourseScheduleRule],
    course_titles: Dict[str, str],
    range_start: Optional[date] = None,
    range_end: Optional[date] = None,
) -> List[CalendarEvent]:
    """
    Combine imported ILIAS events (iCal, Session items, Calendar block dates) and custom
    weekly schedule rules into one deduplicated, chronologically sorted event stream.
    """
    # 1. Deduplicate imported events:
    # Prefer ilias_ical > ilias_session > ilias_calendar_block
    source_priority = {
        "ilias_ical": 3,
        "ilias_session": 2,
        "ilias_calendar_block": 1,
        "custom_rule": 4,
    }

    timed_by_slot: Dict[Tuple[str, str, str, str], CalendarEvent] = {}
    all_day_by_date: Dict[Tuple[str, str, str], CalendarEvent] = {}
    dates_with_real_events_per_course: Set[Tuple[str, str]] = set()

    for ev in imported_events:
        if ev.cancelled:
            continue
        ev_d = _parse_date_token(ev.date)
        if not ev_d:
            continue
        if range_start and ev_d < range_start:
            continue
        if range_end and ev_d > range_end:
            continue

        if ev.source in ("ilias_ical", "ilias_session"):
            dates_with_real_events_per_course.add((ev.course_ref_id, ev.date))

        if not ev.all_day and ev.start_time and ev.end_time:
            slot_key = (ev.course_ref_id, ev.date, ev.start_time, ev.end_time)
            existing = timed_by_slot.get(slot_key)
            if not existing or source_priority.get(ev.source, 0) > source_priority.get(existing.source, 0):
                if existing and not ev.location and existing.location:
                    ev = ev.model_copy(update={"location": existing.location})
                timed_by_slot[slot_key] = ev
        else:
            day_key = (ev.course_ref_id, ev.date, ev.title.lower() if ev.source != "ilias_calendar_block" else "__calblock__")
            all_day_by_date[day_key] = ev

    # Remove generic calminiapp markers on dates where the course already has a concrete iCal/Session event
    filtered_all_day: List[CalendarEvent] = []
    for (c_id, d_str, _), ev in all_day_by_date.items():
        if ev.source == "ilias_calendar_block" and (c_id, d_str) in dates_with_real_events_per_course:
            continue
        filtered_all_day.append(ev)

    # 2. Expand custom schedule rules and merge
    for rule in custom_rules:
        c_title = course_titles.get(rule.course_ref_id) or rule.course_title or f"Course {rule.course_ref_id}"
        for rule_ev in expand_schedule_rule(rule, c_title, range_start=range_start, range_end=range_end):
            slot_key = (rule_ev.course_ref_id, rule_ev.date, rule_ev.start_time or "", rule_ev.end_time or "")
            existing = timed_by_slot.get(slot_key)
            if existing:
                # Keep custom rule's rule_id and location/title enrichment while avoiding duplicate slot
                merged = existing.model_copy(
                    update={
                        "rule_id": rule.id,
                        "location": rule_ev.location or existing.location,
                        "title": rule_ev.title or existing.title,
                    }
                )
                timed_by_slot[slot_key] = merged
            else:
                timed_by_slot[slot_key] = rule_ev

    combined = list(timed_by_slot.values()) + filtered_all_day
    combined.sort(
        key=lambda e: (
            e.date,
            0 if e.all_day else 1,
            e.start_time or "00:00",
            e.end_time or "23:59",
            e.course_title,
            e.title,
        )
    )
    return combined


def _fold_ics_line(line: str) -> str:
    """Fold an RFC 5545 content line at <= 75 UTF-8 octets."""
    raw_bytes = line.encode("utf-8")
    if len(raw_bytes) <= 75:
        return line
    parts: List[str] = []
    current = ""
    current_len = 0
    limit = 75
    for ch in line:
        ch_len = len(ch.encode("utf-8"))
        if current_len + ch_len > limit:
            parts.append(current)
            current = " " + ch
            current_len = 1 + ch_len
            limit = 75
        else:
            current += ch
            current_len += ch_len
    if current:
        parts.append(current)
    return "\r\n".join(parts)


def generate_ics_feed(
    events: List[CalendarEvent],
    semester: str,
    cal_name: Optional[str] = None,
) -> str:
    """
    Serialize combined CalendarEvents into a standards-compliant RFC 5545 .ics calendar
    with Europe/Zurich VTIMEZONE and stable UIDs.
    """
    calendar_title = cal_name or f"BetterIlias – {semester}"
    dtstamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")

    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//BetterIlias//Semester Calendar//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        f"X-WR-CALNAME:{_escape_ics_text(calendar_title)}",
        "X-WR-TIMEZONE:Europe/Zurich",
        "BEGIN:VTIMEZONE",
        "TZID:Europe/Zurich",
        "X-LIC-LOCATION:Europe/Zurich",
        "BEGIN:DAYLIGHT",
        "TZOFFSETFROM:+0100",
        "TZOFFSETTO:+0200",
        "TZNAME:CEST",
        "DTSTART:19700329T020000",
        "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
        "END:DAYLIGHT",
        "BEGIN:STANDARD",
        "TZOFFSETFROM:+0200",
        "TZOFFSETTO:+0100",
        "TZNAME:CET",
        "DTSTART:19701025T030000",
        "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
        "END:STANDARD",
        "END:VTIMEZONE",
    ]

    for ev in events:
        if ev.cancelled:
            continue
        start_d = _parse_date_token(ev.date)
        if not start_d:
            continue
        end_d = _parse_date_token(ev.end_date or ev.date) or start_d

        short_course = strip_course_code_prefix(ev.course_title)
        if short_course.lower() in ev.title.lower():
            summary_str = ev.title
        else:
            summary_str = f"{short_course}: {ev.title}"

        lines.append("BEGIN:VEVENT")
        lines.append(f"UID:{ev.uid}")
        lines.append(f"DTSTAMP:{dtstamp}")

        if ev.all_day or not ev.start_time or not ev.end_time:
            exclusive_end = end_d + timedelta(days=1)
            lines.append(f"DTSTART;VALUE=DATE:{start_d.strftime('%Y%m%d')}")
            lines.append(f"DTEND;VALUE=DATE:{exclusive_end.strftime('%Y%m%d')}")
        else:
            sh, sm = [int(x) for x in ev.start_time.split(":")[:2]]
            eh, em = [int(x) for x in ev.end_time.split(":")[:2]]
            dt_s = datetime.combine(start_d, time(sh, sm))
            dt_e = datetime.combine(end_d, time(eh, em))
            lines.append(f"DTSTART;TZID=Europe/Zurich:{dt_s.strftime('%Y%m%dT%H%M%S')}")
            lines.append(f"DTEND;TZID=Europe/Zurich:{dt_e.strftime('%Y%m%dT%H%M%S')}")

        lines.append(f"SUMMARY:{_escape_ics_text(summary_str)}")
        if ev.location:
            lines.append(f"LOCATION:{_escape_ics_text(ev.location)}")
        if ev.description:
            lines.append(f"DESCRIPTION:{_escape_ics_text(ev.description)}")
        if ev.course_title:
            lines.append(f"CATEGORIES:{_escape_ics_text(ev.course_title)}")
        lines.append("STATUS:CONFIRMED")
        lines.append("END:VEVENT")

    lines.append("END:VCALENDAR")
    folded = [_fold_ics_line(line) for line in lines]
    return "\r\n".join(folded) + "\r\n"
