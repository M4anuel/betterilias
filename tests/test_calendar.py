from datetime import date, datetime, timezone
from pathlib import Path
import pytest
from fastapi.testclient import TestClient

from backend.main import app
from backend.schemas import CourseScheduleRule
from backend.scrapers.calendar import (
    combine_calendar_events,
    expand_schedule_rule,
    generate_ics_feed,
    get_semester_date_bounds,
    parse_course_calendar_discovery,
    parse_ics_feed,
    parse_ilias_agenda_page,
    parse_ilias_subscription_modal,
)
from backend.services.calendar_service import CalendarService

FIXTURES_UNIBE = Path(__file__).parent / "fixtures" / "unibe"
CALENDAR_DUMPS_DIR = Path(
    r"C:\Users\manue\OneDrive\Dokumente\_Uni\IliasAlternative\htmlfromilias\Calendar"
)


def test_semester_bounds_calculation():
    start, mid, end = get_semester_date_bounds("HS2026")
    assert start == date(2026, 9, 14)
    assert mid == date(2026, 10, 30)
    assert end == date(2026, 12, 18)

    fs_start, fs_mid, fs_end = get_semester_date_bounds("FS2026")
    assert fs_start == date(2026, 2, 16)
    assert fs_mid == date(2026, 4, 3)
    assert fs_end == date(2026, 5, 29)


def test_real_po_course_calendar_discovery_from_fixture():
    """Verify discovery of subscription modal URL, mini-calendar dates, and lecture sessions on PO."""
    html = (FIXTURES_UNIBE / "unibe_po_course_content.html").read_text(
        encoding="utf-8", errors="replace"
    )
    disc = parse_course_calendar_discovery(
        html,
        course_ref_id="3715339",
        course_title="24-HS2026-0: Personal und Organisation",
    )

    assert disc.has_calendar_block is True
    assert disc.ical_modal_url is not None
    assert "cmd=getModalForSubscription" in disc.ical_modal_url
    assert disc.status == "imported_with_lectures"
    lecture_evs = [e for e in disc.events if e.kind == "lecture"]
    assert len(lecture_evs) >= 7
    assert "2026-10-07" in disc.mini_calendar_dates


@pytest.mark.skipif(
    not CALENDAR_DUMPS_DIR.exists(),
    reason="Local htmlfromilias/Calendar dump directory not present",
)
def test_real_calendar_html_dumps():
    """Verify all 5 real ILIAS HTML pages in htmlfromilias/Calendar."""
    # 1. Personal und Organisation (has lecture sessions + mid-semester change Wed -> Fri)
    po_html = next(CALENDAR_DUMPS_DIR.glob("*24-HS2026-0*")).read_text(encoding="utf-8", errors="replace")
    po = parse_course_calendar_discovery(
        po_html,
        course_ref_id="3715339",
        course_title="24-HS2026-0: Personal und Organisation",
    )
    assert po.status == "imported_with_lectures"
    po_dates = {
        ev.date: (date.fromisoformat(ev.date).weekday(), ev.start_time, ev.end_time)
        for ev in po.events
        if ev.kind == "lecture"
    }
    # First half: Wednesday (weekday=2) 16:15-19:00
    assert po.prev_sessions_url is not None
    assert "2026-09-30" in po.mini_calendar_dates
    assert "2026-10-07" in po.mini_calendar_dates
    assert po_dates["2026-10-21"] == (2, "16:15", "19:00")
    # Second half: Friday (weekday=4) 14:15-17:00
    assert po_dates["2026-10-30"] == (4, "14:15", "17:00")
    assert po_dates["2026-11-06"] == (4, "14:15", "17:00")

    # 2. Computergrafik (has exercise deadlines on Fridays in mini-calendar, but 0 lecture sessions)
    cg_html = next(CALENDAR_DUMPS_DIR.glob("*2406-HS2026-0*")).read_text(encoding="utf-8", errors="replace")
    cg = parse_course_calendar_discovery(
        cg_html,
        course_ref_id="3695519",
        course_title="2406-HS2026-0: Computergrafik",
    )
    assert cg.has_calendar_block is True
    assert cg.status == "imported_deadlines_only"
    assert cg.mini_calendar_dates == [
        "2026-10-02",
        "2026-10-09",
        "2026-10-16",
        "2026-10-23",
        "2026-10-30",
    ]
    assert len([e for e in cg.events if e.kind == "deadline"]) == 5

    # 3. Einf. in die Mathematik für WISO I (has 2 lectures per week: Tue & Wed 12:15-14:00)
    math_html = next(CALENDAR_DUMPS_DIR.parent.glob("*101559*")).read_text(encoding="utf-8", errors="replace")
    math_disc = parse_course_calendar_discovery(
        math_html,
        course_ref_id="3690476",
        course_title="101559-HS2026-0: Einf. in die Mathematik für WISO I",
    )
    assert math_disc.status == "imported_with_lectures"
    assert len([e for e in math_disc.events if e.kind == "lecture"]) >= 6
    assert math_disc.prev_sessions_url is not None
    assert math_disc.next_sessions_url is not None

    # 4. Graph Theory (valid calendar block & modal URL, but 0 events -> valid_empty)
    gt_html = next(CALENDAR_DUMPS_DIR.parent.glob("*43085*")).read_text(encoding="utf-8", errors="replace")
    gt = parse_course_calendar_discovery(
        gt_html,
        course_ref_id="3684711",
        course_title="HS2026: 43085 Graph Theory",
    )
    assert gt.has_calendar_block is True
    assert gt.status == "valid_empty"
    assert gt.mini_calendar_dates == []
    assert len(gt.events) == 0

    # 5. Global ILIAS Agenda / Calendar page
    agenda_html = next(CALENDAR_DUMPS_DIR.glob("Agenda*")).read_text(encoding="utf-8", errors="replace")
    agenda = parse_ilias_agenda_page(agenda_html)
    assert len(agenda.categories) >= 50
    assert agenda.ical_modal_url is not None


def test_subscription_modal_parsing():
    modal_html = """
    <div class="modal-body">
      <p>Abonnieren Sie den Kalender mit folgender URL:</p>
      <input type="text" class="form-control" value="webcal://ilias.unibe.ch/calendar.php?client_id=ilias3_unibe&token=abc123xyz" />
    </div>
    """
    url = parse_ilias_subscription_modal(modal_html)
    assert url == "https://ilias.unibe.ch/calendar.php?client_id=ilias3_unibe&token=abc123xyz"


def test_custom_schedule_rules_two_slots_and_mid_semester_change_and_dst():
    """
    Verify:
    1. A course with 2 weekly lecture slots (Tue & Thu 10:15-12:00).
    2. A course with a mid-semester schedule change (Wed 16:00-18:00 in 1st half, Fri 14:00-16:00 in 2nd half).
    3. Exception/cancelled dates.
    4. Europe/Zurich DST transition on 2026-10-25 (CEST +02:00 -> CET +01:00).
    """
    rule_two_slots = CourseScheduleRule(
        id="rule-two-slots",
        course_ref_id="3695519",
        course_title="Computergrafik",
        title="Vorlesung Computergrafik",
        location="Raum 101",
        weekdays=[1, 3],  # Tue, Thu
        start_time="10:15",
        end_time="12:00",
        start_date="2026-10-20",
        end_date="2026-10-29",
        exceptions=["2026-10-22"],
        semester="HS2026",
    )
    events_a = expand_schedule_rule(rule_two_slots, "Computergrafik")
    dates_a = [e.date for e in events_a]
    # 2026-10-22 is excluded by exceptions!
    assert dates_a == ["2026-10-20", "2026-10-27", "2026-10-29"]

    # Check DST transition: 2026-10-20 is CEST (+02:00), 2026-10-27 is CET (+01:00),
    # while local time remains 10:15-12:00!
    ev_cest = next(e for e in events_a if e.date == "2026-10-20")
    ev_cet = next(e for e in events_a if e.date == "2026-10-27")
    assert ev_cest.start_time == "10:15"
    assert ev_cet.start_time == "10:15"
    assert "+02:00" in ev_cest.start_iso
    assert "+01:00" in ev_cet.start_iso

    # Course B: Mid-semester schedule change (Rule 1: Wed 16:00-18:00, Rule 2: Fri 14:00-16:00)
    rule_first_half = CourseScheduleRule(
        id="rule-half-1",
        course_ref_id="3715339",
        course_title="Personal und Organisation",
        weekdays=[2],  # Wed
        start_time="16:00",
        end_time="18:00",
        start_date="2026-09-14",
        end_date="2026-10-23",
        exceptions=[],
        semester="HS2026",
    )
    rule_second_half = CourseScheduleRule(
        id="rule-half-2",
        course_ref_id="3715339",
        course_title="Personal und Organisation",
        weekdays=[4],  # Fri
        start_time="14:00",
        end_time="16:00",
        start_date="2026-10-26",
        end_date="2026-12-18",
        exceptions=[],
        semester="HS2026",
    )
    combined = combine_calendar_events(
        [],
        [rule_first_half, rule_second_half],
        {"3715339": "Personal und Organisation"},
    )
    wed_events = [e for e in combined if date.fromisoformat(e.date).weekday() == 2]
    fri_events = [e for e in combined if date.fromisoformat(e.date).weekday() == 4]
    assert len(wed_events) == 6  # Sept 16 .. Oct 21
    assert all(e.start_time == "16:00" and e.end_time == "18:00" for e in wed_events)
    assert len(fri_events) == 8  # Oct 30 .. Dec 18
    assert all(e.start_time == "14:00" and e.end_time == "16:00" for e in fri_events)


def test_ics_import_and_export_round_trip_with_rrule_exdate_and_override():
    sample_ics = """BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//ILIAS//NONSGML ILIAS Calendar//EN
BEGIN:VEVENT
UID:ilias-series-1@ilias.unibe.ch
SUMMARY:Vorlesung Graph Theory
LOCATION:ExWi B001
DTSTART;TZID=Europe/Zurich:20261005T101500
DTEND;TZID=Europe/Zurich:20261005T120000
RRULE:FREQ=WEEKLY;UNTIL=20261026T235959Z
EXDATE;TZID=Europe/Zurich:20261012T101500
END:VEVENT
BEGIN:VEVENT
UID:ilias-series-1@ilias.unibe.ch
RECURRENCE-ID;TZID=Europe/Zurich:20261019T101500
SUMMARY:Vorlesung Graph Theory (Sondertermin)
LOCATION:ExWi A102
DTSTART;TZID=Europe/Zurich:20261019T141500
DTEND;TZID=Europe/Zurich:20261019T160000
END:VEVENT
END:VCALENDAR
"""
    parsed = parse_ics_feed(
        sample_ics,
        course_ref_id="3684711",
        course_title="Graph Theory",
    )
    dates = {e.date: e for e in parsed}
    # 2026-10-05 (regular), 2026-10-12 (excluded via EXDATE), 2026-10-19 (overridden to 14:15), 2026-10-26 (regular after DST!)
    assert "2026-10-12" not in dates
    assert set(dates.keys()) == {"2026-10-05", "2026-10-19", "2026-10-26"}
    assert dates["2026-10-05"].start_time == "10:15"
    assert dates["2026-10-19"].start_time == "14:15"
    assert dates["2026-10-19"].location == "ExWi A102"
    assert dates["2026-10-26"].start_time == "10:15"

    # Export to .ics and re-import to verify round-trip stability
    exported_ics = generate_ics_feed(parsed, semester="HS2026", cal_name="BetterIlias Test")
    assert "BEGIN:VCALENDAR" in exported_ics
    assert "X-WR-TIMEZONE:Europe/Zurich" in exported_ics

    reparsed = parse_ics_feed(
        exported_ics,
        course_ref_id="3684711",
        course_title="Graph Theory",
    )
    assert [e.uid for e in reparsed] == [e.uid for e in parsed]
    assert [e.start_iso for e in reparsed] == [e.start_iso for e in parsed]


def test_calendar_api_endpoints_and_subscription_revocation(tmp_path, monkeypatch):
    """Test API routes for rules, .ics export, and revocable subscription token."""
    test_service = CalendarService(storage_dir=tmp_path / ".calendar")
    monkeypatch.setattr("backend.api.routes.calendar.calendar_service", test_service)

    client = TestClient(app)
    headers = {"X-Session-Id": "test-cal-tenant-1"}

    # 1. Create a schedule rule
    rule_payload = {
        "course_ref_id": "3695519",
        "course_title": "Computergrafik",
        "title": "Computergrafik Vorlesung",
        "location": "Hörsaal 115",
        "weekdays": [0, 2],
        "start_time": "10:15",
        "end_time": "12:00",
        "start_date": "2026-09-14",
        "end_date": "2026-10-05",
        "exceptions": ["2026-09-21"],
        "semester": "HS2026",
    }
    res = client.post("/api/calendar/rules", json=rule_payload, headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert len(data["rules"]) == 1
    rule_id = data["rules"][0]["id"]
    assert len(data["events"]) == 6  # 4 Mondays + 3 Wednesdays - 1 exception = 6 events

    # 2. Duplicate the rule
    dup_res = client.post(
        f"/api/calendar/rules/{rule_id}/duplicate?semester=HS2026", headers=headers
    )
    assert dup_res.status_code == 200
    assert len(dup_res.json()["rules"]) == 2

    # 3. Export .ics
    ics_res = client.get("/api/calendar/export.ics?semester=HS2026", headers=headers)
    assert ics_res.status_code == 200
    assert "BEGIN:VCALENDAR" in ics_res.text
    assert "Computergrafik Vorlesung" in ics_res.text

    # 4. Generate private subscription URL and fetch feed without session headers
    sub_res = client.post(
        "/api/calendar/subscription/rotate?semester=HS2026", headers=headers
    )
    assert sub_res.status_code == 200
    sub_data = sub_res.json()
    token = sub_data["token"]
    assert token

    feed_res = client.get(f"/api/calendar/feed/{token}.ics")
    assert feed_res.status_code == 200
    assert "Computergrafik Vorlesung" in feed_res.text

    # 5. Revoke subscription token and verify old token returns 404
    rev_res = client.delete("/api/calendar/subscription", headers=headers)
    assert rev_res.status_code == 200
    feed_after_revoke = client.get(f"/api/calendar/feed/{token}.ics")
    assert feed_after_revoke.status_code == 404


def test_cross_semester_calendar_ignore_schedule_and_tiered_caching(tmp_path, monkeypatch):
    """
    Verify:
    1. Global calendar loads courses across multiple semesters (HS2026, FS2026, HS2025) and undated groups,
       sorted newest semester to oldest.
    2. Ignoring missing schedule suppresses needs_manual_schedule warning on past courses or groups.
    3. Tiered cache freshness: past-semester courses remain cached indefinitely even with old timestamps,
       while current-semester courses expire after CURRENT_SEMESTER_TTL_SECONDS (6 hours).
    """
    test_service = CalendarService(storage_dir=tmp_path / ".calendar")
    monkeypatch.setattr("backend.api.routes.calendar.calendar_service", test_service)

    client = TestClient(app)
    headers = {"X-Session-Id": "test-cal-tiered-1"}

    # Seed tenant with courses from HS2025, HS2026, FS2026, and an undated group
    state = test_service._load_tenant_state("test-cal-tiered-1")
    state["courses"] = {
        "old-hs2025": {
            "course_ref_id": "old-hs2025",
            "course_title": "HS2025: Alte Vorlesung",
            "semester": "HS2025",
            "item_type": "crs",
            "color": "#0AACA5",
            "status": "valid_empty",
            "status_message": "Keine Termine",
            "needs_manual_schedule": True,
            "ignored_missing_schedule": False,
            "imported_event_count": 0,
            "imported_lecture_count": 0,
            "imported_deadline_count": 0,
            "custom_rule_count": 0,
            "last_imported_at": "2025-11-01T10:00:00+00:00",  # ~1 year old!
        },
        "curr-hs2026": {
            "course_ref_id": "curr-hs2026",
            "course_title": "HS2026: Aktuelle Vorlesung",
            "semester": "HS2026",
            "item_type": "crs",
            "color": "#2563EB",
            "status": "imported_deadlines_only",
            "status_message": "Nur Fristen",
            "needs_manual_schedule": True,
            "ignored_missing_schedule": False,
            "imported_event_count": 2,
            "imported_lecture_count": 0,
            "imported_deadline_count": 2,
            "custom_rule_count": 0,
            "last_imported_at": "2026-01-01T10:00:00+00:00",  # > 6 hours old
        },
        "mid-fs2026": {
            "course_ref_id": "mid-fs2026",
            "course_title": "FS2026: Frühlingsvorlesung",
            "semester": "FS2026",
            "item_type": "crs",
            "color": "#7C3AED",
            "status": "imported_with_lectures",
            "status_message": "10 Termine",
            "needs_manual_schedule": False,
            "ignored_missing_schedule": False,
            "imported_event_count": 10,
            "imported_lecture_count": 10,
            "imported_deadline_count": 0,
            "custom_rule_count": 0,
            "last_imported_at": "2026-03-15T10:00:00+00:00",  # Months old
        },
        "grp-1": {
            "course_ref_id": "grp-1",
            "course_title": "Übungsgruppe 3",
            "semester": None,
            "item_type": "grp",
            "color": "#D97706",
            "status": "valid_empty",
            "status_message": "Keine Termine",
            "needs_manual_schedule": True,
            "ignored_missing_schedule": False,
            "imported_event_count": 0,
            "imported_lecture_count": 0,
            "imported_deadline_count": 0,
            "custom_rule_count": 0,
            "last_imported_at": "2026-02-01T10:00:00+00:00",
        },
    }
    test_service._save_tenant_state("test-cal-tiered-1", state)

    # 1. GET /api/calendar without semester returns ALL courses sorted newest semester to oldest
    res = client.get("/api/calendar", headers=headers)
    assert res.status_code == 200
    cal = res.json()
    returned_ids = [c["course_ref_id"] for c in cal["courses"]]
    assert returned_ids == ["curr-hs2026", "mid-fs2026", "old-hs2025", "grp-1"]

    # 2. Verify tiered cache freshness:
    # Past semester (HS2025, FS2026) and undated group (grp-1) are fresh indefinitely despite months-old timestamps
    assert (
        test_service._is_course_cache_fresh(
            state["courses"]["old-hs2025"], "HS2025", "HS2026"
        )
        is True
    )
    assert (
        test_service._is_course_cache_fresh(
            state["courses"]["mid-fs2026"], "FS2026", "HS2026"
        )
        is True
    )
    assert (
        test_service._is_course_cache_fresh(state["courses"]["grp-1"], None, "HS2026")
        is True
    )
    # Current semester (HS2026) with old timestamp is expired (> 6h)
    assert (
        test_service._is_course_cache_fresh(
            state["courses"]["curr-hs2026"], "HS2026", "HS2026"
        )
        is False
    )

    # 3. Ignore missing schedule on old-hs2025 and verify needs_manual_schedule becomes False
    ign_res = client.put(
        "/api/calendar/courses/old-hs2025/ignore-schedule",
        json={"ignored": True},
        headers=headers,
    )
    assert ign_res.status_code == 200
    ign_courses = {c["course_ref_id"]: c for c in ign_res.json()["courses"]}
    assert ign_courses["old-hs2025"]["ignored_missing_schedule"] is True
    assert ign_courses["old-hs2025"]["needs_manual_schedule"] is False

    # Unignore and verify needs_manual_schedule is restored
    unign_res = client.put(
        "/api/calendar/courses/old-hs2025/ignore-schedule",
        json={"ignored": False},
        headers=headers,
    )
    assert unign_res.status_code == 200
    unign_courses = {c["course_ref_id"]: c for c in unign_res.json()["courses"]}
    assert unign_courses["old-hs2025"]["ignored_missing_schedule"] is False
    assert unign_courses["old-hs2025"]["needs_manual_schedule"] is True


@pytest.mark.anyio
async def test_agenda_discovery_and_opportunistic_course_materials_ingest(tmp_path, monkeypatch):
    """
    Verify:
    1. POST /api/calendar/discover extracts courses and groups across all semesters directly
       from the ILIAS Agenda page (#block_cal_sel_0) and Memberships Overview without requiring
       the user to open past semesters in BetterIlias first.
    2. Opening a lecture's page (via ingest_course_page_html, called inside get_course_materials)
       immediately extracts and stores its calendar events and status from the already-fetched
       HTML page with zero extra course-page HTTP fetches, and subsequent calls skip re-parsing
       when cached.
    """
    test_service = CalendarService(storage_dir=tmp_path / ".calendar")
    monkeypatch.setattr("backend.api.routes.calendar.calendar_service", test_service)

    agenda_fixture_html = """
    <html><body>
      <div id="block_cal_sel_0">
        <ul class="ilCalSel">
          <li>
            <input type="checkbox" name="selected_cat_ids[]" value="101" checked="checked" />
            <div class="ilCalColSpan" style="border-color: #0c4299"></div>
            <span class="ilCalSelTitle"><a href="ilias.php?baseClass=ilDashboardGUI&cmdClass=ilcalendarcategorygui&calendar_id=101&ref_id=3695519">449033-HS2026-0: Computergrafik</a></span>
            <img src="templates/default/images/icon_crs.svg" />
          </li>
          <li>
            <input type="checkbox" name="selected_cat_ids[]" value="102" checked="checked" />
            <div class="ilCalColSpan" style="border-color: #30990c"></div>
            <span class="ilCalSelTitle"><a href="ilias.php?baseClass=ilDashboardGUI&cmdClass=ilcalendarcategorygui&calendar_id=102&ref_id=3187493">442670-HS2024-0: Einführung in die Programmierung</a></span>
            <img src="templates/default/images/icon_crs.svg" />
          </li>
          <li>
            <input type="checkbox" name="selected_cat_ids[]" value="103" checked="checked" />
            <div class="ilCalColSpan" style="border-color: #746625"></div>
            <span class="ilCalSelTitle"><a href="ilias.php?baseClass=ilDashboardGUI&cmdClass=ilcalendarcategorygui&calendar_id=103&ref_id=2640154">7567-HS2022-0: Einführung in die Betriebswirtschaftslehre</a></span>
            <img src="templates/default/images/icon_crs.svg" />
          </li>
          <li>
            <input type="checkbox" name="selected_cat_ids[]" value="104" checked="checked" />
            <div class="ilCalColSpan" style="border-color: #9333ea"></div>
            <span class="ilCalSelTitle"><a href="ilias.php?baseClass=ilDashboardGUI&cmdClass=ilcalendarcategorygui&calendar_id=104&ref_id=2713697">Fachschaft Mathematik und Informatik (MIB)</a></span>
            <img src="templates/default/images/icon_grp.svg" />
          </li>
        </ul>
      </div>
    </body></html>
    """

    class FakeResp:
        status_code = 200
        text = agenda_fixture_html

    class FakeHttp:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            pass

        async def get(self, url, **kwargs):
            return FakeResp()

    class FakeSessionManager:
        def has_cookies(self):
            return True

        def get_http_client(self):
            return FakeHttp()

    class FakeClient:
        session_manager = FakeSessionManager()

        def _check_response_for_session_loss(self, resp, url):
            pass

        async def get_my_courses(self):
            return type("Dash", (), {"courses": []})()

    disc_cal = await test_service.discover_courses_from_agenda_and_memberships(
        "test-discover-tenant", client=FakeClient()
    )
    semesters = [c.semester for c in disc_cal.courses]
    # Sorted newest semester first, undated groups last!
    assert semesters == ["HS2026", "HS2024", "HS2022", None]
    types = {c.course_ref_id: c.item_type for c in disc_cal.courses}
    assert types["3695519"] == "crs"
    assert types["2713697"] == "grp"

    # Now simulate opening the lecture page for Personal und Organisation (or an older course)
    # via get_course_materials -> ingest_course_page_html using the already-fetched HTML
    po_html = (FIXTURES_UNIBE / "unibe_po_course_content.html").read_text(
        encoding="utf-8", errors="replace"
    )
    ingested = await test_service.ingest_course_page_html(
        tenant_key="test-discover-tenant",
        course_ref_id="3715339",
        html_content=po_html,
        course_title="24-HS2026-0: Personal und Organisation",
        client=None,
    )
    assert ingested is True

    cal_after = test_service.build_semester_response("test-discover-tenant")
    po_course = next(c for c in cal_after.courses if c.course_ref_id == "3715339")
    assert po_course.status == "imported_with_lectures"
    assert po_course.imported_lecture_count >= 7
    assert any(e.course_ref_id == "3715339" and e.kind == "lecture" for e in cal_after.events)

    # Opening the same course again while its calendar cache is fresh should be a fast no-op
    ingested_again = await test_service.ingest_course_page_html(
        tenant_key="test-discover-tenant",
        course_ref_id="3715339",
        html_content=po_html,
        course_title="24-HS2026-0: Personal und Organisation",
        client=None,
    )
    assert ingested_again is False


from tests.test_localisation_browser import local_site, ROOT


@pytest.mark.skipif(
    __import__("os").environ.get("BETTERILIAS_BROWSER_TESTS") != "1",
    reason="Opt-in browser tests",
)
@pytest.mark.parametrize("language,scheme", [("de", "light"), ("en", "dark")])
@pytest.mark.parametrize("width", [320, 390, 768, 1280])
def test_calendar_mobile_tablet_desktop_browser(local_site, language, scheme, width):
    import json
    import os
    from urllib.parse import urlparse

    playwright = pytest.importorskip("playwright.sync_api")
    tr = json.loads((ROOT / "locales" / f"{language}.json").read_text(encoding="utf8")).__getitem__

    now_iso = datetime.now(timezone.utc).isoformat()
    cal_response = {
        "semester": "ALL",
        "semester_start_date": "2026-09-14",
        "semester_end_date": "2026-12-18",
        "semester_mid_date": "2026-10-30",
        "timezone": "Europe/Zurich",
        "courses": [
            {
                "course_ref_id": "3715339",
                "course_title": "Personal und Organisation",
                "semester": "HS2026",
                "item_type": "crs",
                "color": "#0AACA5",
                "status": "imported_with_lectures",
                "status_message": "7 Vorlesungstermine aus ILIAS importiert.",
                "needs_manual_schedule": False,
                "ignored_missing_schedule": False,
                "imported_event_count": 7,
                "imported_lecture_count": 7,
                "imported_deadline_count": 0,
                "custom_rule_count": 0,
                "last_imported_at": now_iso,
            },
            {
                "course_ref_id": "3695519",
                "course_title": "Computergrafik",
                "semester": "HS2026",
                "item_type": "crs",
                "color": "#2563EB",
                "status": "imported_deadlines_only",
                "status_message": "Nur Abgabefristen in ILIAS.",
                "needs_manual_schedule": True,
                "ignored_missing_schedule": False,
                "imported_event_count": 5,
                "imported_lecture_count": 0,
                "imported_deadline_count": 5,
                "custom_rule_count": 0,
                "last_imported_at": now_iso,
            },
            {
                "course_ref_id": "3100001",
                "course_title": "HS2025: Alte Vorlesung",
                "semester": "HS2025",
                "item_type": "crs",
                "color": "#7C3AED",
                "status": "valid_empty",
                "status_message": "Keine Termine in ILIAS.",
                "needs_manual_schedule": True,
                "ignored_missing_schedule": False,
                "imported_event_count": 0,
                "imported_lecture_count": 0,
                "imported_deadline_count": 0,
                "custom_rule_count": 0,
                "last_imported_at": "2025-11-15T10:00:00Z",
            },
            {
                "course_ref_id": "3200002",
                "course_title": "Lerngruppe Informatik",
                "semester": None,
                "item_type": "grp",
                "color": "#D97706",
                "status": "valid_empty",
                "status_message": "Keine Termine in ILIAS.",
                "needs_manual_schedule": True,
                "ignored_missing_schedule": False,
                "imported_event_count": 0,
                "imported_lecture_count": 0,
                "imported_deadline_count": 0,
                "custom_rule_count": 0,
                "last_imported_at": "2026-03-01T10:00:00Z",
            },
        ],
        "rules": [],
        "events": [
            {
                "uid": "ev-1",
                "course_ref_id": "3715339",
                "course_title": "Personal und Organisation",
                "title": "Personal und Organisation",
                "location": "Hörsaal 001",
                "date": "2026-10-21",
                "end_date": "2026-10-21",
                "start_time": "16:15",
                "end_time": "19:00",
                "start_iso": "2026-10-21T16:15:00+02:00",
                "end_iso": "2026-10-21T19:00:00+02:00",
                "all_day": False,
                "source": "ilias_session",
                "kind": "lecture",
                "cancelled": False,
            }
        ],
        "subscription_token": "tok123",
        "subscription_url": "http://localhost:8000/api/calendar/feed/tok123.ics",
        "fetched_at": now_iso,
    }

    def respond(route):
        path = urlparse(route.request.url).path
        if path.endswith("/status"):
            body = dict(authenticated=True, cookies_present=True)
        elif path.endswith("/semesters"):
            body = dict(
                active_semester="HS2026",
                available_semesters=[],
                grouped_by_category={},
                courses=[
                    dict(ref_id="3715339", title="Personal und Organisation", url="", item_type="crs", semester="HS2026"),
                    dict(ref_id="3695519", title="Computergrafik", url="", item_type="crs", semester="HS2026"),
                ],
            )
        elif path.endswith("/memberships"):
            body = [
                dict(ref_id="3715339", title="Personal und Organisation", url="", item_type="crs", semester="HS2026"),
                dict(ref_id="3695519", title="Computergrafik", url="", item_type="crs", semester="HS2026"),
                dict(ref_id="3100001", title="HS2025: Alte Vorlesung", url="", item_type="crs", semester="HS2025"),
                dict(ref_id="3200002", title="Lerngruppe Informatik", url="", item_type="grp", semester=None),
            ]
        elif "/ignore-schedule" in path:
            for c in cal_response["courses"]:
                if c["course_ref_id"] in path:
                    c["ignored_missing_schedule"] = True
                    c["needs_manual_schedule"] = False
            body = cal_response
        elif "/api/calendar" in path:
            body = cal_response
        else:
            body = {}
        route.fulfill(status=200, content_type="application/json", body=json.dumps(body))

    with playwright.sync_playwright() as p:
        browser = p.chromium.launch(headless=True, channel=os.environ.get("BETTERILIAS_BROWSER_CHANNEL"))
        page = browser.new_page(
            viewport=dict(width=width, height=800),
            is_mobile=width < 1024,
            has_touch=True,
            locale=language,
            color_scheme=scheme,
        )
        page.add_init_script(f"localStorage.setItem('betterilias_language', '{language}');")
        page.route("**/api/**", respond)
        page.goto(local_site + "/?view=calendar&semester=HS2026")

        playwright.expect(page.get_by_role("heading", name=tr("calendar.title"))).to_be_visible()
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")

        # Switch through views: Week, Month, Agenda, Timetable
        for vkey in ["calendar.view.week", "calendar.view.month", "calendar.view.agenda", "calendar.view.timetable"]:
            page.get_by_role("tab", name=tr(vkey), exact=True).click()
            assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")

        # Filter Courses & ILIAS Calendar Status panel by Category (Groups) and Semester
        cat_select = page.get_by_role("combobox", name=tr("calendar.filter.category_label"), exact=True)
        cat_select.select_option("groups")
        playwright.expect(page.get_by_role("button", name="Lerngruppe Informatik", exact=True)).to_be_visible()
        cat_select.select_option("all")

        sem_select = page.get_by_role("combobox", name=tr("calendar.filter.semester_label"), exact=True)
        sem_select.select_option("HS2025")
        playwright.expect(page.get_by_role("button", name="Alte Vorlesung", exact=True)).to_be_visible()

        # Ignore missing schedule warning on past course HS2025: Alte Vorlesung
        page.get_by_role("button", name=tr("calendar.ignore_missing_schedule"), exact=True).first.click()
        playwright.expect(page.get_by_text(tr("calendar.status.badge_ignored"), exact=True)).to_be_visible()
        sem_select.select_option("ALL")

        # Verify compact session count chip and Info button popover on course card
        expected_sessions = tr("calendar.course_sessions_count").replace("{count}", "7")
        playwright.expect(page.get_by_text(expected_sessions, exact=True)).to_be_visible()
        info_btn = page.get_by_role("button", name=tr("calendar.info.button_label"), exact=True).first
        info_btn.click()
        playwright.expect(page.get_by_text(tr("calendar.info.synced_from_ilias"), exact=True)).to_be_visible()
        info_btn.click()

        # Verify collapsing and expanding the Courses & ILIAS Calendar Status panel (persisted in localStorage)
        collapse_btn = page.get_by_role("button", name=tr("calendar.courses_panel.collapse"), exact=True)
        collapse_btn.click()
        expand_btn = page.get_by_role("button", name=tr("calendar.courses_panel.expand"), exact=True)
        playwright.expect(expand_btn).to_be_visible()
        assert page.evaluate("localStorage.getItem('betterilias_calendar_panel_collapsed')") == "true"
        expand_btn.click()
        playwright.expect(collapse_btn).to_be_visible()
        assert page.evaluate("localStorage.getItem('betterilias_calendar_panel_collapsed')") == "false"

        # Open Manual Recheck Modal and verify checkbox list + layout
        page.get_by_role("button", name=tr("calendar.recheck.button"), exact=True).click()
        recheck_dialog = page.get_by_role("dialog", name=tr("calendar.recheck.modal_title"), exact=True)
        playwright.expect(recheck_dialog).to_be_visible()
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
        recheck_dialog.get_by_role("button", name=tr("calendar.recheck.select_all"), exact=True).click()
        recheck_dialog.get_by_role("button", name=tr("Abbrechen"), exact=True).click()

        # Open Schedule Rule modal, fill draft, resize viewport, verify draft persists
        page.get_by_role("button", name=tr("calendar.add_schedule")).first.click()
        dialog = page.get_by_role("dialog", name=tr("calendar.rule.modal_add_title"), exact=True)
        playwright.expect(dialog).to_be_visible()
        loc_input = dialog.get_by_placeholder(tr("calendar.rule.location_placeholder"), exact=True)
        loc_input.fill("Hörsaal B001")
        page.set_viewport_size(dict(width=width, height=480))
        playwright.expect(loc_input).to_have_value("Hörsaal B001")
        dialog.get_by_role("button", name=tr("Abbrechen"), exact=True).click()

        # Open Export & Subscription modal and verify Escape key dismissal
        page.get_by_role("button", name=tr("calendar.export_subscribe"), exact=True).click()
        exp_dialog = page.get_by_role("dialog", name=tr("calendar.export_modal.title"), exact=True)
        playwright.expect(exp_dialog).to_be_visible()
        page.keyboard.press("Escape")
        playwright.expect(exp_dialog).to_be_hidden()
        browser.close()
