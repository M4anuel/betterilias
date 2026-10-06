import re
import urllib.parse
from typing import List, Optional
from bs4 import BeautifulSoup

from backend.config import settings
from backend.schemas import CourseLogItem, CourseLogsResponse
from backend.scrapers.dumper import safe_parser


def parse_log_item_element(el, seen_keys: set) -> Optional[CourseLogItem]:
    """Parse a single news/activity log element."""
    title_el = el.select_one(".il-item-title, h4, h5, a")
    if not title_el:
        return None
    log_title = title_el.get_text(strip=True)
    if not log_title or log_title in ["News", "Calendar", "Portal", "Inbox"]:
        return None

    full_text = el.get_text(" ", strip=True)
    if "Inbox" in full_text and "mails in your inbox" in full_text:
        return None

    # Target extraction (File, Forum, Exercise, Course)
    target = None
    target_match = re.search(r"(File|Forum|Exercise|Course):\s*([^\|]+?)(?=\s*Date|\s*$)", full_text, re.I)
    if target_match:
        target = target_match.group(0).strip()

    # Date extraction (Today, Yesterday, DD. MMM YYYY, HH:MM)
    date_str = None
    date_match = re.search(
        r"(Today|Yesterday|[0-9]{1,2}\.\s+[A-Za-z]+(?:\s+[0-9]{4})?),\s*[0-9]{2}:[0-9]{2}",
        full_text,
    )
    if date_match:
        date_str = date_match.group(0).strip()

    link_el = el.find("a", href=True)
    log_url = (
        urllib.parse.urljoin(settings.ilias_base_url, link_el.get("href"))
        if link_el
        else None
    )

    key = f"{log_title}_{target}_{date_str}"
    if key in seen_keys:
        return None
    seen_keys.add(key)

    log_type = (
        "file"
        if "file" in full_text.lower()
        else "forum"
        if "forum" in full_text.lower()
        else "general"
    )

    return CourseLogItem(
        title=log_title,
        target=target,
        date=date_str,
        url=log_url,
        log_type=log_type,
    )


@safe_parser(context_name="course_logs")
def parse_course_logs(html_content: str, course_id: str) -> CourseLogsResponse:
    """
    Parse a course news / logs page (e.g. showNews or course content right col).
    Extracts all activity items and pagination details.
    """
    soup = BeautifulSoup(html_content, "lxml")
    logs: List[CourseLogItem] = []
    seen_keys = set()

    # Determine pagination
    total_pages = 1
    current_page = 1
    pag = soup.select(".pagination, .il-viewcontrol-pagination, a[href*='news_page']")
    for p in pag:
        href = p.get("href") or p.get("data-action") or ""
        match = re.search(r"news_page=([0-9]+)", href)
        if match:
            page_num = int(match.group(1))
            if page_num > total_pages:
                total_pages = page_num

    # Find log items in main container or right col
    elements = soup.select(".il-item, .il-std-item, .ilNewsItem, .il_NewsItem")
    for el in elements:
        item = parse_log_item_element(el, seen_keys)
        if item:
            logs.append(item)

    return CourseLogsResponse(
        course_id=course_id,
        logs=logs,
        total_pages=total_pages,
        current_page=current_page,
    )

