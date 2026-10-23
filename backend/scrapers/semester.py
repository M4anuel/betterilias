import re
import urllib.parse
from typing import Dict, List, Optional
from bs4 import BeautifulSoup
from pydantic import BaseModel, Field

from backend.config import settings
from backend.schemas import CourseItem, SemesterItem, SemesterScreenResponse
from backend.scrapers.dashboard import _extract_ref_id_from_url
from backend.scrapers.dumper import safe_parser


@safe_parser(context_name="semester_courses")
def parse_semester_courses(html_content: str) -> SemesterScreenResponse:
    """
    Parse the Uni Bern specific semester screen (iliLubModsSemesterGUI).
    Extracts available semesters, current active semester, and enrolled courses.
    """
    soup = BeautifulSoup(html_content, "lxml")

    # 1. Extract Semesters
    available_semesters: List[SemesterItem] = []
    active_semester: Optional[str] = None

    for btn in soup.find_all("button", attrs={"data-action": True}):
        action = btn.get("data-action", "")
        if "iliLubModsSemesterGUI" in action and "semester=" in action:
            label = btn.get_text(strip=True)
            # Avoid the "rep_add_to_favourites" buttons which also have semester in URL
            if not re.match(r"^(HS|FS)\d{4}$", label):
                continue

            match = re.search(r"semester=([A-Z0-9]+)", action)
            sem_id = match.group(1) if match else label

            is_pressed = btn.get("aria-pressed") == "true" or "engaged" in btn.get("class", [])
            if is_pressed:
                active_semester = sem_id

            full_url = urllib.parse.urljoin(settings.ilias_base_url, action)
            available_semesters.append(
                SemesterItem(
                    id=sem_id,
                    name=label,
                    is_active=is_pressed,
                    url=full_url
                )
            )

    # Fallback to page title if active_semester was not marked on button
    if not active_semester:
        title_elem = soup.find("title")
        if title_elem:
            title_match = re.search(r"\b(HS|FS)\d{4}\b", title_elem.get_text())
            if title_match:
                active_semester = title_match.group(0)

    # Ensure SemesterItem is_active matches active_semester
    if active_semester:
        for s in available_semesters:
            if s.id == active_semester:
                s.is_active = True

    # 2. Extract Courses grouped by categories (e.g. Informatik, Betriebswirtschaftslehre)
    courses: List[CourseItem] = []
    grouped: Dict[str, List[CourseItem]] = {}
    seen_ref_ids = set()

    # In Uni Bern markup, categories are represented by H2 followed by .il-item-group
    # Iterate through siblings
    current_category = "General"
    for elem in soup.find_all(["h2", "div"]):
        if elem.name == "h2":
            text = elem.get_text(strip=True)
            if text and text not in ["Portal Point", "Terms of Service", "Tabs"]:
                current_category = text
            continue

        classes = elem.get("class", [])
        if "il-item" in classes and "il-std-item" in classes:
            # Course Item
            title_btn = elem.select_one("h4.il-item-title button, h4.il-item-title a, .il-item-title button, .il-item-title a")
            if not title_btn:
                continue

            title = title_btn.get_text(strip=True)
            action = title_btn.get("data-action") or title_btn.get("href") or ""
            ref_id = _extract_ref_id_from_url(action)
            if not ref_id or ref_id in seen_ref_ids:
                continue

            full_url = urllib.parse.urljoin(settings.ilias_base_url, action)

            # Extract contact / properties
            contact = None
            for prop in elem.select(".il-multi-line-cap-3"):
                pn = prop.select_one(".il-item-property-name")
                pv = prop.select_one(".il-item-property-value")
                if pn and pv and "contact" in pn.get_text().lower():
                    contact = pv.get_text(strip=True)

            course_obj = CourseItem(
                ref_id=ref_id,
                title=title,
                description=f"Contact: {contact}" if contact else None,
                url=full_url,
                item_type="crs",
                semester=active_semester,
                subject=current_category,
            )

            courses.append(course_obj)
            seen_ref_ids.add(ref_id)

            if current_category not in grouped:
                grouped[current_category] = []
            grouped[current_category].append(course_obj)

    return SemesterScreenResponse(
        active_semester=active_semester,
        available_semesters=available_semesters,
        courses=courses,
        grouped_by_category=grouped,
    )
