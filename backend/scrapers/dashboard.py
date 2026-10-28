import re
import urllib.parse
from typing import List, Optional
from bs4 import BeautifulSoup

from backend.config import settings
from backend.schemas import CourseItem
from backend.scrapers.dumper import safe_parser


def _extract_ref_id_from_url(url: str) -> Optional[str]:
    """Extract ref_id parameter from URL or goto link."""
    if not url:
        return None
    # Check query param ref_id=12345
    parsed = urllib.parse.urlparse(url)
    params = urllib.parse.parse_qs(parsed.query)
    if "ref_id" in params and params["ref_id"]:
        return params["ref_id"][0]
    
    # Check Uni Bern short URL /go/{type}/{ref_id} (e.g. /go/crs/3695522, /go/fold/3782760)
    match_go = re.search(r"/go/[a-zA-Z]+/(\d+)", url)
    if match_go:
        return match_go.group(1)

    # Check goto_ilias3_unibe_crs_12345.html or similar
    match = re.search(r"goto_.*_([a-zA-Z]+)_(\d+)\.html", url)
    if match:
        return match.group(2)
        
    # Check general ref_id=(\d+) pattern anywhere in url
    match_general = re.search(r"ref_id=(\d+)", url)
    if match_general:
        return match_general.group(1)

    return None


def _detect_item_type(url: str, elem_classes: str, icon_src: Optional[str]) -> str:
    """Detect whether item is course (crs), group (grp), folder (fold), etc."""
    # Saved-page asset directories can contain "Courses and Groups". Only the
    # icon filename identifies the object, never the directory containing it.
    icon_name = (icon_src or '').rsplit('/', 1)[-1]
    combined = f"{url} {elem_classes} {icon_name}".lower()
    if "_grp_" in combined or "/go/grp/" in combined or "icon_grp" in combined or "group" in combined:
        return "grp"
    if "_fold_" in combined or "/go/fold/" in combined or "icon_fold" in combined or "folder" in combined:
        return "fold"
    if "_exc_" in combined or "/go/exc/" in combined or "ilexercisehandlergui" in combined:
        return "exc"
    return "crs"


@safe_parser(context_name="dashboard")
def parse_dashboard(html_content: str) -> List[CourseItem]:
    """
    Parse the ILIAS Personal Desktop HTML to extract user's enrolled courses and groups.
    """
    soup = BeautifulSoup(html_content, "lxml")
    courses: List[CourseItem] = []
    seen_ref_ids = set()

    # Strategy 1: Modern ILIAS items (.il-item, .il-std-item, .il-card)
    items = soup.select(".il-item, .il-std-item, .il-card, .ilContainerListItem, .il_ContainerListItem")
    
    for item in items:
        # Locate title link (supports both <a> and Uni Bern <button data-action="...">)
        title_link = (
            item.select_one("h3 a, h4 a, .il-item-title a, .il_ContainerItemTitle a, a.il_ContainerItemTitle")
            or item.select_one("h3 button, h4 button, .il-item-title button, button.btn-link")
            or item.select_one("a[href*='ref_id'], a[href*='goto_'], a[href*='/go/']")
            or item.select_one("button[data-action*='ref_id']")
        )
        if not title_link:
            continue

        raw_url = (title_link.get("href") or title_link.get("data-action") or "").strip()
        ref_id = _extract_ref_id_from_url(raw_url)
        if not ref_id or ref_id in seen_ref_ids:
            continue

        title = title_link.get_text(strip=True)
        if not title:
            continue

        # Extract description or properties
        desc_elem = item.select_one(".il-item-description, .il_Description, .il-card-text, .text-muted")
        description = desc_elem.get_text(strip=True) if desc_elem else None
        if not description:
            for prop in item.select(".il-multi-line-cap-3"):
                pn = prop.select_one(".il-item-property-name")
                pv = prop.select_one(".il-item-property-value")
                if pn and pv:
                    description = f"{pn.get_text(strip=True)}: {pv.get_text(strip=True)}"
                    break

        # Extract icon
        icon_elem = item.select_one("img.il-item-icon, img.il-icon, img[src*='icon_']")
        icon_src = icon_elem.get("src") if icon_elem else None

        item_type = _detect_item_type(raw_url, " ".join(item.get("class", [])), icon_src)

        # Normalize relative URLs
        full_url = urllib.parse.urljoin(settings.ilias_base_url, raw_url)

        courses.append(
            CourseItem(
                ref_id=ref_id,
                title=title,
                description=description,
                url=full_url,
                item_type=item_type,
                icon=icon_src,
            )
        )
        seen_ref_ids.add(ref_id)

    # Strategy 2: Fallback to all repository links if no structured items found
    if not courses:
        for link in soup.find_all("a", href=True):
            href = link.get("href", "")
            # Look for course or group links
            if ("ref_id=" in href or "goto_" in href) and ("crs" in href or "grp" in href or "cmd=jumpTo" in href or "ilrepositorygui" in href.lower()):
                ref_id = _extract_ref_id_from_url(href)
                title = link.get_text(strip=True)
                if ref_id and title and len(title) > 2 and ref_id not in seen_ref_ids:
                    # Ignore navigation headers like "Repository" or "Magazin"
                    if title.lower() in ["repository", "magazin", "uebersicht", "zurück", "back"]:
                        continue
                    courses.append(
                        CourseItem(
                            ref_id=ref_id,
                            title=title,
                            description=None,
                            url=urllib.parse.urljoin(settings.ilias_base_url, href),
                            item_type=_detect_item_type(href, "", None),
                        )
                    )
                    seen_ref_ids.add(ref_id)

    return courses


@safe_parser(context_name="my_courses_and_groups")
def parse_my_courses(html_content: str) -> List[CourseItem]:
    """Read the membership overview, excluding notifications and bulk dialogs."""
    soup = BeautifulSoup(html_content, 'lxml')
    main = soup.select_one('main') or soup
    for dialog in main.select('[role="dialog"], .modal'):
        dialog.decompose()
    courses = parse_dashboard(str(main))
    items = {}
    for item in main.select('.il-item, .il-std-item, .ilContainerListItem, .il_ContainerListItem'):
        link = item.select_one('.il-item-title a, h3 a, h4 a')
        if link:
            ref_id = _extract_ref_id_from_url(link.get('href', ''))
            if ref_id:
                items[ref_id] = item
    for course in courses:
        match = re.search(r'\b(HS|FS)\s*(20\d{2})\b', course.title)
        course.semester = ''.join(match.groups()) if match else None
        item = items.get(course.ref_id)
        if item:
            course.is_favourite = any(
                urllib.parse.parse_qs(urllib.parse.urlparse(action.get('data-action') or action.get('href', '')).query)
                .get('cmd', [''])[0].lower() in {'dropfromdesk', 'removefromdesk'}
                for action in item.select('[data-action], a[href]')
            )
    return courses
