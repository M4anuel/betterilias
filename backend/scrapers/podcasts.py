import re
import urllib.parse
from datetime import datetime
from typing import List, Optional
from bs4 import BeautifulSoup

from backend.config import settings
from backend.schemas import PodcastEpisode, PodcastSeriesResponse
from backend.scrapers.dumper import safe_parser
from backend.scrapers.calendar import ZURICH_TZ
from backend.scrapers.native_text import label_key, parse_native_date, strip_page_prefix


def _date_iso(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    except ValueError:
        day = parse_native_date(value)
        if day is None:
            return None
        clock = re.search(r'(\d{1,2}):(\d{2})', value)
        try:
            parsed = datetime(day.year, day.month, day.day, int(clock[1]) if clock else 0, int(clock[2]) if clock else 0)
        except ValueError:
            return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=ZURICH_TZ)
    return parsed.isoformat()


@safe_parser(context_name="podcast_series")
def parse_podcast_series(html_content: str, ref_id: str) -> PodcastSeriesResponse:
    """
    Parse an ILIAS Opencast / Mediacast series page (xoctEventGUI).
    Extracts recorded episodes and scheduled upcoming sessions,
    with recorded episodes prioritized first.
    """
    soup = BeautifulSoup(html_content, "lxml")

    # Series Title
    title_elem = (
        soup.select_one("h1.il_Header, h1.il-page-content-header, .ilTopTitle, h1")
    )
    raw_title = title_elem.get_text(strip=True) if title_elem else f"Podcast {ref_id}"
    title = re.sub(r"^Podcast\s*(?:[A-Z0-9]+:\s*)?", "", strip_page_prefix(raw_title)).strip()
    if not title:
        title = raw_title

    # Pagination links
    pages_available: List[str] = []
    pag = soup.select_one(".il-viewcontrol-pagination, .pagination")
    if pag:
        for b in pag.find_all(["button", "a"]):
            action = b.get("data-action") or b.get("href")
            text = b.get_text(strip=True)
            if action and (text.isdigit() or "page=" in action):
                full_page_url = urllib.parse.urljoin(settings.ilias_base_url, action)
                if full_page_url not in pages_available:
                    pages_available.append(full_page_url)

    episodes: List[PodcastEpisode] = []
    seen_identifiers = set()

    # Find episode entity containers
    containers = soup.select("section.c-entity__container, .c-entity, .panel-body")

    for c in containers:
        title_el = c.select_one(".c-entity__primary-identifier, h3, h4, .title, a.c-entity__title")
        if not title_el:
            continue
        ep_title = title_el.get_text(strip=True)
        if not ep_title or ep_title in seen_identifiers or label_key(ep_title) in {'content', 'functions', 'inhalt', 'funktionen'}:
            continue

        details_el = c.select_one(".c-entity__main-details")
        details_text = details_el.get_text(" ", strip=True) if details_el else ""
        properties = {}
        if details_el:
            for label in details_el.select('dt'):
                value = label.find_next_sibling('dd')
                if value:
                    properties[label_key(label.get_text(' ', strip=True))] = value.get_text(' ', strip=True)

        field_labels = r'Date|Datum|Recording Date|Aufnahmedatum|Presenter|Vortragende[r]?|Referent(?:en)?|Location|Ort|Standort|Uploaded(?: on)?|Upload Date|Hochgeladen(?: am)?'
        def field(*names):
            direct = next((properties[label_key(name)] for name in names if label_key(name) in properties), None)
            if direct:
                return direct
            labels = '|'.join(re.escape(name) for name in names)
            match = re.search(rf'(?:^|\s)(?:{labels})\s*:?\s+(.+?)(?=\s+(?:{field_labels})\s*:?\s+|$)', details_text, re.I)
            return match[1].strip() if match else None
        ep_date = field('date', 'datum', 'recording date', 'aufnahmedatum')
        uploaded_date = next((properties[label] for label in ('uploaded', 'uploaded on', 'upload date', 'date uploaded', 'hochgeladen', 'hochgeladen am', 'hochladedatum', 'upload-datum') if label in properties), None)

        # Presenter extraction
        ep_pres = field('presenter', 'vortragende', 'vortragender', 'referent', 'referenten')

        # Location extraction
        ep_loc = field('location', 'ort', 'standort')

        # Preview image
        img_elem = c.select_one(".c-entity__secondary-identifier img, img.img-responsive, img")
        preview_image = (
            urllib.parse.urljoin(settings.ilias_base_url, img_elem.get("src", ""))
            if img_elem and img_elem.get("src")
            else None
        )

        # Stream / Player URL
        stream_elem = c.select_one("a[href*='streamVideo'], a[href*='xoctPlayerGUI'], a[href*='play']")
        stream_url = (
            urllib.parse.urljoin(settings.ilias_base_url, stream_elem.get("href", ""))
            if stream_elem
            else None
        )

        status = "available" if stream_url else "scheduled"

        # Event ID / eid
        eid_match = re.search(r"eid=([a-f0-9\-]+)", str(c))
        eid = eid_match.group(1) if eid_match else f"ep-{len(episodes) + 1}"

        episodes.append(
            PodcastEpisode(
                id=eid,
                title=ep_title,
                date=ep_date,
                recorded_at=_date_iso(ep_date),
                uploaded_date=uploaded_date,
                uploaded_at=_date_iso(uploaded_date),
                presenter=ep_pres,
                location=ep_loc,
                preview_image=preview_image,
                stream_url=stream_url,
                status=status,
            )
        )
        seen_identifiers.add(ep_title)

    # Prioritize available (recorded) episodes first, followed by upcoming scheduled events
    available_eps = [e for e in episodes if e.status == "available"]
    scheduled_eps = [e for e in episodes if e.status == "scheduled"]

    sorted_episodes = available_eps + scheduled_eps

    return PodcastSeriesResponse(
        ref_id=ref_id,
        title=title,
        total_episodes=len(sorted_episodes),
        recorded_count=len(available_eps),
        scheduled_count=len(scheduled_eps),
        pages_available=pages_available,
        episodes=sorted_episodes,
    )

