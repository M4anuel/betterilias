import re
import urllib.parse
from typing import List, Optional
from bs4 import BeautifulSoup

from backend.config import settings
from backend.schemas import PodcastEpisode, PodcastSeriesResponse
from backend.scrapers.dumper import safe_parser


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
    title = re.sub(r"^(Content:\s*)?(Podcast\s*(?:[A-Z0-9]+:\s*)?)?", "", raw_title).strip()
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
        if not ep_title or ep_title in seen_identifiers or ep_title in ["Content", "Functions"]:
            continue

        details_el = c.select_one(".c-entity__main-details")
        details_text = details_el.get_text(" ", strip=True) if details_el else ""

        # Date extraction: e.g. "Date 30. Sep 2026, 16:13" or "Date 15. Dec 2026, 09:13"
        date_match = re.search(
            r"Date\s+([0-9]{1,2}\.\s+[A-Za-z]+\s+[0-9]{4}(?:,\s+[0-9]{2}:[0-9]{2})?)",
            details_text,
        )
        ep_date = date_match.group(1).strip() if date_match else None

        # Presenter extraction
        pres_match = re.search(r"Presenter\s+(.+?)(?:\s+Location|$)", details_text)
        ep_pres = pres_match.group(1).strip() if pres_match else None

        # Location extraction
        loc_match = re.search(r"Location\s+(.+)$", details_text)
        ep_loc = loc_match.group(1).strip() if loc_match else None

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
                presenter=ep_pres,
                location=ep_loc,
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

