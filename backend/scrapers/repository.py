"""Read repository categories without treating menu actions as content links."""
import re
from urllib.parse import urljoin

from bs4 import BeautifulSoup

from backend.config import settings
from backend.schemas import RepositoryItem, RepositoryResponse
from backend.scrapers.dashboard import _extract_ref_id_from_url
from backend.scrapers.dumper import safe_parser
from backend.scrapers.materials import _detect_material_type, _extract_breadcrumbs


@safe_parser(context_name="repository")
def parse_repository(html_content: str, container_ref_id: str) -> RepositoryResponse:
    soup = BeautifulSoup(html_content, "lxml")
    heading = soup.select_one("h1.il-page-content-header, h1.ilHeader, h1")
    title = heading.get_text(" ", strip=True) if heading else "Magazin"
    center = soup.select_one("#il_center_col, main, #ilContentContainer")
    items = []
    seen = set()
    if center:
        for el in center.select(".il-card, .ilContainerListItemOuter, .il-std-item"):
            title_el = el.select_one(".card-title, h3.il_ContainerItemTitle, .il-item-title")
            if not title_el:
                continue
            link = title_el.select_one("a[href], button[data-action]")
            href = (link.get("href") or link.get("data-action") or "") if link else ""
            ref_id = _extract_ref_id_from_url(href)
            # Locked courses still have an object ID and title, but no content link.
            if not ref_id:
                marker = el.get("data-list-item-id", "") or el.get("id", "")
                match = re.search(r"lg_div_(\d+)_pref_", marker)
                ref_id = match.group(1) if match else None
            if not ref_id or ref_id in seen:
                continue
            seen.add(ref_id)
            icon = el.select_one("img")
            meta = f"{href} {icon.get('src', '') if icon else ''} {icon.get('alt', '') if icon else ''}".lower()
            if "/go/cat/" in meta or "icon_cat" in meta or "category" in meta:
                item_type = "cat"
            elif "/go/crs/" in meta or "icon_crs" in meta or "course" in meta:
                item_type = "crs"
            elif "/go/grp/" in meta or "icon_grp" in meta or "group" in meta:
                item_type = "grp"
            else:
                item_type = _detect_material_type(href, "", meta)
            description = el.select_one(".il_Description, .il-item-description, .il-card-text")
            items.append(RepositoryItem(
                ref_id=ref_id,
                title=title_el.get_text(" ", strip=True),
                item_type=item_type,
                url=urljoin(settings.ilias_base_url, href) if href else "",
                description=description.get_text(" ", strip=True) if description else None,
                accessible=bool(href),
            ))
    return RepositoryResponse(
        container_ref_id=container_ref_id, title=title,
        breadcrumbs=_extract_breadcrumbs(soup), items=items,
    )
