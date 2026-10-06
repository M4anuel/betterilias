import re
import urllib.parse
from typing import Dict, List, Optional
from bs4 import BeautifulSoup

from backend.config import settings
from backend.schemas import BreadcrumbItem, CourseMaterialsResponse, MaterialItem
from backend.scrapers.dashboard import _extract_ref_id_from_url
from backend.scrapers.dumper import safe_parser


def _detect_material_type(url: str, classes: str, icon_src: Optional[str], title: str = "") -> str:
    """Detect item type (fold, file, exc, frm, tst, webr, sess, mcst, etc.)."""
    s = f"{url} {classes} {icon_src or ''} {title}".lower()
    if "_fold_" in s or "/go/fold/" in s or "icon_fold" in s or "folder" in s:
        return "fold"
    if "_mcst_" in s or "/go/mcst/" in s or "icon_mcst" in s or "mediacast" in s or "video" in s or "xoct" in s or "podcast" in s or "opencast" in s:
        return "mcst"
    if "_file_" in s or "/go/file/" in s or "icon_file" in s or "sendfile" in s or (("file" in s or ".pdf" in s) and "xoct" not in s and "podcast" not in s):
        return "file"
    if "_exc_" in s or "/go/exc/" in s or "icon_exc" in s or "exercise" in s or "uebung" in s or "ilexercisehandlergui" in s:
        return "exc"
    if "_frm_" in s or "/go/frm/" in s or "icon_frm" in s or "forum" in s:
        return "frm"
    if "_tst_" in s or "/go/tst/" in s or "icon_tst" in s or "test" in s:
        return "tst"
    if "_webr_" in s or "/go/webr/" in s or "icon_webr" in s or "weblink" in s:
        return "webr"
    if "_sess_" in s or "/go/sess/" in s or "icon_sess" in s or "session" in s:
        return "sess"
    return "other"


def _extract_breadcrumbs(soup: BeautifulSoup) -> List[BreadcrumbItem]:
    """Extract breadcrumb hierarchy."""
    breadcrumbs: List[BreadcrumbItem] = []
    bc_container = soup.select_one("nav.breadcrumb-wrapper, ol.breadcrumb, ul.breadcrumb, .il-breadcrumb, .ilBreadcrumb")
    if not bc_container:
        return breadcrumbs

    # Modern ILIAS: .breadcrumb-crumb spans
    crumbs = bc_container.select(".breadcrumb-crumb")
    if crumbs:
        for c in crumbs:
            link = c.find(["a", "button"])
            if link:
                title = link.get_text(strip=True)
                href = link.get("href") or link.get("data-action") or ""
                ref_id = _extract_ref_id_from_url(href)
                full_url = urllib.parse.urljoin(settings.ilias_base_url, href) if href else None
                breadcrumbs.append(BreadcrumbItem(title=title, ref_id=ref_id, url=full_url))
            else:
                title = c.get_text(strip=True)
                if title:
                    breadcrumbs.append(BreadcrumbItem(title=title, ref_id=None, url=None))
        # If the container had dir="rtl", reverse so root is first
        if bc_container.select_one('[dir="rtl"]') or bc_container.get("dir") == "rtl":
            breadcrumbs.reverse()
        return breadcrumbs

    for li in bc_container.select("li"):
        link = li.find(["a", "button"])
        if link:
            title = link.get_text(strip=True)
            href = link.get("href") or link.get("data-action") or ""
            ref_id = _extract_ref_id_from_url(href)
            full_url = urllib.parse.urljoin(settings.ilias_base_url, href) if href else None
            breadcrumbs.append(BreadcrumbItem(title=title, ref_id=ref_id, url=full_url))
        else:
            title = li.get_text(strip=True)
            if title:
                breadcrumbs.append(BreadcrumbItem(title=title, ref_id=None, url=None))
    return breadcrumbs


def _clean_math_in_soup(soup: BeautifulSoup) -> None:
    """Normalize MathJax output to standard MathML for native browser rendering."""
    for mjx in soup.find_all("mjx-container"):
        assistive = mjx.find("mjx-assistive-mml")
        if assistive:
            math = assistive.find("math")
            if math:
                if "style" in math.attrs:
                    del math["style"]
                mjx.replace_with(math)


def _parse_single_item(el, seen_ref_ids: set) -> Optional[MaterialItem]:
    """Parse a single ILIAS container list item."""
    # Exclude items located in sidebars, right column, news blocks, or footers
    if el.find_parent(["aside", "footer"]) or el.find_parent(id=re.compile(r"right_col|news", re.I)):
        return None
    if el.find_parent(lambda tag: bool(tag.get("id", "").startswith("block_news_") or "ilNewsForContextBlockGUI" in tag.get("class", []))):
        return None

    title_link = (
        el.select_one("h3 a, h4 a, .il_ContainerItemTitle a, a.il_ContainerItemTitle, .il-item-title a")
        or el.select_one("h3 button, h4 button, .il_ContainerItemTitle button, .il-item-title button")
        or el.select_one("a[href*='ref_id'], a[href*='goto_'], a[href*='/go/']")
        or el.select_one("button[data-action*='ref_id']")
    )
    if not title_link:
        return None

    raw_url = (title_link.get("href") or title_link.get("data-action") or "").strip()
    ref_id = _extract_ref_id_from_url(raw_url)
    if not ref_id or ref_id in seen_ref_ids:
        return None

    title = title_link.get_text(strip=True)
    if not title:
        return None
    if "previous sessions" in title.lower() or "previoussessions" in raw_url.lower():
        return None

    # Exclude news headlines that notify about added files/materials
    title_lower = title.lower()
    if any(k in title_lower for k in [
        "has been added", "have been added", "wurde hinzugefügt", "wurden hinzugefügt",
        "one file has been", "several files have been", "eine datei wurde", "dateien wurden"
    ]):
        return None

    # Extract description
    desc_elem = el.select_one(".il-item-description, .il_Description, .il-card-text")
    description = desc_elem.get_text(strip=True) if desc_elem else None

    # Extract icon & type
    icon_elem = el.select_one("img.il-item-icon, img.il-icon, img[src*='icon_']")
    icon_src = icon_elem.get("src") if icon_elem else None
    item_type = _detect_material_type(raw_url, " ".join(el.get("class", [])), icon_src, title)
    if item_type == "sess":
        return None

    full_url = urllib.parse.urljoin(settings.ilias_base_url, raw_url)

    # Detect download URL if available
    download_url = None
    download_elem = el.select_one("a[href*='cmd=sendfile'], a[href*='cmd=download'], a[href*='download=1']")
    if download_elem:
        download_url = urllib.parse.urljoin(settings.ilias_base_url, download_elem.get("href", ""))
    elif item_type == "file":
        download_url = full_url

    # Extract file size or properties
    file_size = None
    properties: Dict[str, str] = {}
    prop_elems = el.select(".il_ItemProperty, .il-item-properties .property, .text-muted")
    for p in prop_elems:
        txt = p.get_text(strip=True)
        size_match = re.search(r"(\d+(?:[.,]\d+)?\s*(?:KB|MB|GB|Bytes|kB))", txt, re.IGNORECASE)
        if size_match:
            file_size = size_match.group(1)
        elif ":" in txt:
            k, v = txt.split(":", 1)
            properties[k.strip()] = v.strip()
        elif txt:
            properties[f"prop_{len(properties)}"] = txt

    seen_ref_ids.add(ref_id)
    return MaterialItem(
        ref_id=ref_id,
        title=title,
        item_type=item_type,
        description=description,
        url=full_url,
        download_url=download_url,
        file_size=file_size,
        properties=properties,
    )


@safe_parser(context_name="course_materials")
def parse_course_materials(html_content: str, container_ref_id: str) -> CourseMaterialsResponse:
    """
    Parse an ILIAS course or folder repository page to extract materials, subfolders,
    structured sections/accordions, and rich text with MathML.
    """
    soup = BeautifulSoup(html_content, "lxml")
    _clean_math_in_soup(soup)

    # Extract Page / Course Title
    title_elem = (
        soup.select_one("h1.il-page-content-header, h1.ilHeader:not(.modal-title), h1.media-heading:not(.modal-title), h1.il-item-title, .ilMainHeader h1, h1:not(.modal-title)")
        or soup.select_one(".ilTopTitle")
    )
    raw_title = title_elem.get_text(strip=True) if title_elem else f"Container {container_ref_id}"
    # Clean leading "View: Content: " or "Content: "
    container_title = re.sub(r'^(View:\s*)?(Content:\s*)?', '', raw_title).strip()

    # Extract Breadcrumbs
    breadcrumbs = _extract_breadcrumbs(soup)

    from backend.schemas import ContentGroup, CourseSection, CourseSessionItem, RichTextBlock

    items: List[MaterialItem] = []
    sections: List[CourseSection] = []
    rich_text_blocks: List[RichTextBlock] = []
    sessions: List[CourseSessionItem] = []
    seen_ref_ids: set = set()

    # Extract Course Sessions ("Sitzungen" / Drawers)
    session_lis = [
        li for li in soup.select("li.ilObjListRow, .ilContainerItemsContainer > li")
        if "sess" in li.get("id", "") or li.find("img", alt="Session") or li.select_one("img[src*='icon_sess']")
    ]
    for sli in session_lis:
        title_a = sli.select_one("h3 a, h4 a, .il_ContainerItemTitle a, .il-item-title a")
        if not title_a or not title_a.get_text(strip=True):
            for a in sli.find_all("a"):
                if a.get_text(strip=True):
                    title_a = a
                    break
        if not title_a:
            continue
        sess_title = title_a.get_text(strip=True)
        if not sess_title or "previous sessions" in sess_title.lower():
            continue

        raw_sess_id = sli.get("id", "")
        sess_m = re.search(r"sess-(\d+)", raw_sess_id)
        sess_ref_id = sess_m.group(1) if sess_m else _extract_ref_id_from_url(title_a.get("href", ""))
        if not sess_ref_id or sess_ref_id in seen_ref_ids:
            continue
        seen_ref_ids.add(sess_ref_id)

        # Date & time parsing
        date_m = re.search(r"(\d{1,2}\.\s+[A-Za-z]+\s+\d{4})", sess_title)
        date_str = date_m.group(1).strip() if date_m else None

        time_m = re.search(r"(\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2})", sess_title)
        time_str = time_m.group(1).strip() if time_m else None

        # Check if past session
        is_past = False
        if date_str:
            try:
                parts = date_str.replace(".", "").split()
                if len(parts) >= 3:
                    day = int(parts[0])
                    month_str = parts[1][:3].lower()
                    year = int(parts[2])
                    month_map = {
                        "jan": 1, "feb": 2, "mär": 3, "mar": 3, "apr": 4, "mai": 5, "may": 5,
                        "jun": 6, "jul": 7, "aug": 8, "sep": 9, "okt": 10, "oct": 10, "nov": 11, "dez": 12, "dec": 12
                    }
                    if month_str in month_map:
                        from datetime import date
                        s_date = date(year, month_map[month_str], day)
                        is_past = s_date < date.today()
            except Exception:
                pass

        # Extract nested materials in this session drawer
        sess_materials: List[MaterialItem] = []
        for sub_el in sli.select(".ilContainerListItemOuter"):
            if sub_el.get("id", "") == raw_sess_id:
                continue
            sub_item = _parse_single_item(sub_el, seen_ref_ids)
            if sub_item and sub_item.ref_id != sess_ref_id:
                sess_materials.append(sub_item)

        sessions.append(
            CourseSessionItem(
                ref_id=sess_ref_id,
                title=sess_title,
                date_str=date_str,
                time_str=time_str,
                materials=sess_materials,
                is_past=is_past,
            )
        )

    center = soup.select_one("#il_center_col") or soup.select_one(".il-layout-page-content, main, #ilContentContainer")

    if center:
        current_section: Optional[CourseSection] = None
        current_rich_block: Optional[RichTextBlock] = None

        for child in center.find_all(recursive=False):
            if child.name in ["script", "style", "nav"]:
                continue
            if child.name == "a" and "ilPageShowAdvContent" in child.get("class", []):
                continue
            if "il-copg-mob-fullscreen-modal" in child.get("class", []):
                continue

            # 1. Section Divider: H1 / H2 headlines (e.g. "Teil Organisation", "Teil Personal")
            if child.name in ["h1", "h2"] and ("ilc_heading1_Headline1" in child.get("class", []) or "ilc_Paragraph" in child.get("class", [])):
                sec_title = child.get_text(strip=True)
                sec_title = re.sub(r'<!--.*?-->', '', sec_title).strip()
                if sec_title:
                    slug = re.sub(r'[^a-zA-Z0-9]+', '-', sec_title.lower()).strip('-')
                    current_section = CourseSection(
                        id=slug or f"section-{len(sections) + 1}",
                        title=sec_title,
                        groups=[],
                        items=[],
                        rich_text_blocks=[]
                    )
                    sections.append(current_section)
                    current_rich_block = None
                    continue

            # 2. Rich Text Header: H2, H3, H4 (e.g. "Suggested Literature", "Grading Policy")
            if child.name in ["h2", "h3", "h4", "h5"] and not child.select(".ilContainerBlock, .il_ContainerListItem"):
                hdr_text = child.get_text(strip=True)
                level = int(child.name[1]) if child.name[1].isdigit() else 3
                current_rich_block = RichTextBlock(
                    title=hdr_text,
                    level=level,
                    html_content="",
                    plain_text=""
                )
                if current_section:
                    current_section.rich_text_blocks.append(current_rich_block)
                else:
                    rich_text_blocks.append(current_rich_block)
                continue

            # 3. Rich Text Content: Paragraphs, blockquotes, lists containing text or MathML
            is_text = ("ilc_text_block_Standard" in child.get("class", []) or child.name in ["p", "blockquote", "ul", "ol", "div"])
            has_items = bool(child.select(".il_ContainerListItem, .ilContainerListItem, .il-item, .il-std-item, .ilContainerBlock"))

            if is_text and not has_items:
                inner_html = "".join(str(c) for c in child.contents).strip()
                # Clean comments, PageToc anchors, and phantom "Break" tokens from ILIAS
                inner_html = re.sub(r'<!--.*?-->', '', inner_html)
                inner_html = re.sub(r'\bBreak\b', '', inner_html).strip()
                plain_txt = child.get_text(" ", strip=True)
                plain_txt = re.sub(r'\bBreak\b', '', plain_txt).strip()
                if inner_html and plain_txt:
                    if child.name in ["ul", "ol", "blockquote"]:
                        snippet = f"<{child.name}>{inner_html}</{child.name}>"
                    elif "<ul" in inner_html or "<ol" in inner_html or "<table" in inner_html:
                        snippet = f"<div>{inner_html}</div>"
                    else:
                        snippet = f"<p>{inner_html}</p>"

                    if current_rich_block:
                        current_rich_block.html_content += snippet
                        current_rich_block.plain_text = (current_rich_block.plain_text + " " + plain_txt).strip()
                    else:
                        block = RichTextBlock(
                            title=None,
                            level=3,
                            html_content=snippet,
                            plain_text=plain_txt
                        )
                        if current_section:
                            current_section.rich_text_blocks.append(block)
                        else:
                            rich_text_blocks.append(block)
                continue

            # 4. Container Blocks / Course Materials Items
            container_blocks = child.select(".ilContainerBlock")
            if not container_blocks and has_items:
                container_blocks = [child]

            if container_blocks:
                for cb in container_blocks:
                    hdr_elem = cb.select_one("h2, h3, .ilHeader, .ilBlockHeader, legend")
                    group_title = hdr_elem.get_text(strip=True) if hdr_elem else "Inhalte"

                    group_items: List[MaterialItem] = []
                    for item_el in cb.select(".il_ContainerListItem, .ilContainerListItem, .il-item, .il-std-item"):
                        item = _parse_single_item(item_el, seen_ref_ids)
                        if item:
                            group_items.append(item)
                            items.append(item)

                    if group_items:
                        grp = ContentGroup(title=group_title, items=group_items)
                        if current_section:
                            current_section.groups.append(grp)
                            current_section.items.extend(group_items)
                        else:
                            if not sections:
                                sections.append(CourseSection(
                                    id="general",
                                    title="Inhalte",
                                    groups=[],
                                    items=[],
                                    rich_text_blocks=[]
                                ))
                            sections[-1].groups.append(grp)
                            sections[-1].items.extend(group_items)

    # Strategy 2: Collect any missed container items within the main content area
    search_scope = center if center else soup.select_one("main, #ilContentContainer") or soup
    for item_el in search_scope.select(".ilContainerListItem, .il_ContainerListItem, .il-item, .il-std-item"):
        if item_el.find_parent(["aside", "footer"]) or item_el.find_parent(id=re.compile(r"right_col|news", re.I)):
            continue
        item = _parse_single_item(item_el, seen_ref_ids)
        if item:
            items.append(item)
            if not sections:
                sections.append(CourseSection(
                    id="general",
                    title="Inhalte",
                    groups=[ContentGroup(title="Materialien", items=[item])],
                    items=[item],
                    rich_text_blocks=[]
                ))
            else:
                sections[-1].items.append(item)

    # Strategy 3: Fallback for direct links
    if not items:
        search_scope = center if center else soup.select_one("main, #ilContentContainer") or soup
        for a in search_scope.find_all("a", href=True):
            if a.find_parent(["aside", "footer"]) or a.find_parent(id=re.compile(r"right_col|news", re.I)):
                continue
            href = a.get("href", "")
            if "ref_id=" in href and ("cmd=sendfile" in href or "file" in href or "fold" in href or "exc" in href or "target=" in href):
                ref_id = _extract_ref_id_from_url(href)
                title = a.get_text(strip=True)
                if ref_id and title and ref_id not in seen_ref_ids:
                    item_type = _detect_material_type(href, "", None, title)
                    full_url = urllib.parse.urljoin(settings.ilias_base_url, href)
                    mat = MaterialItem(
                        ref_id=ref_id,
                        title=title,
                        item_type=item_type,
                        url=full_url,
                        download_url=full_url if item_type == "file" else None,
                    )
                    items.append(mat)
                    seen_ref_ids.add(ref_id)

    # Extract Course Activity Logs / News from aside.il_right_col
    from backend.schemas import CourseLogItem
    logs: List[CourseLogItem] = []
    seen_log_keys = set()
    aside = soup.select_one("aside.il_right_col, #il_right_col")
    if aside:
        for el in aside.select(".il-item, .il-std-item, li"):
            title_el = el.select_one(".il-item-title, h4, h5, a")
            if not title_el:
                continue
            log_title = title_el.get_text(strip=True)
            if not log_title or log_title in ["News", "Calendar", "Portal"]:
                continue

            full_text = el.get_text(" ", strip=True)
            target = None
            target_match = re.search(r"(File|Forum|Exercise|Course):\s*([^\|]+?)(?=\s*Date|\s*$)", full_text, re.I)
            if target_match:
                target = target_match.group(0).strip()

            date_str = None
            date_match = re.search(r"(Today|Yesterday|[0-9]{1,2}\.\s+[A-Za-z]+(?:\s+[0-9]{4})?),\s*[0-9]{2}:[0-9]{2}", full_text)
            if date_match:
                date_str = date_match.group(0).strip()

            link_el = el.find("a", href=True)
            log_url = urllib.parse.urljoin(settings.ilias_base_url, link_el.get("href")) if link_el else None

            key = f"{log_title}_{target}_{date_str}"
            if key in seen_log_keys:
                continue
            seen_log_keys.add(key)

            log_type = "file" if "file" in full_text.lower() else "forum" if "forum" in full_text.lower() else "general"

            logs.append(
                CourseLogItem(
                    title=log_title,
                    target=target,
                    date=date_str,
                    url=log_url,
                    log_type=log_type,
                )
            )

    return CourseMaterialsResponse(
        container_ref_id=container_ref_id,
        title=container_title,
        breadcrumbs=breadcrumbs,
        items=items,
        sections=sections,
        rich_text_blocks=rich_text_blocks,
        sessions=sessions,
        logs=logs,
    )

