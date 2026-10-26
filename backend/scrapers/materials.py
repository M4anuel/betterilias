from pathlib import Path
from backend.i18n import t
import copy
import hashlib
import re
import urllib.parse
from typing import Dict, List, Optional
from bs4 import BeautifulSoup, Comment

from backend.config import settings
from backend.schemas import BreadcrumbItem, CourseContentBlock, CourseMaterialsResponse, MaterialItem, CourseSessionItem
from backend.scrapers.dashboard import _extract_ref_id_from_url
from backend.scrapers.dumper import safe_parser
from backend.scrapers.membership import parse_membership, membership_form


def _clean_rich_html(raw_html: str, container_ref_id: str = "") -> str:
    """Strip ILIAS comment artifacts, transform Opencast video iframes into interactive player cards, and wrap tables."""
    if not raw_html:
        return ""
    cleaned = re.sub(r'<!--[\s\S]*?-->', '', raw_html)
    cleaned = re.sub(r'PageTocPH', '', cleaned)
    cleaned = re.sub(r'Break(?=\s*</|\s*$|\s*<)|\bBreak\b', '', cleaned)
    cleaned = re.sub(r'<h[1-6][^>]*>\s*</h[1-6]>', '', cleaned)

    if "<" in cleaned:
        from bs4 import BeautifulSoup
        soup = BeautifulSoup(cleaned, "html.parser")

        ilias_page_url = (
            f"https://ilias.unibe.ch/ilias.php?baseClass=ilrepositorygui&cmdNode=yv:oj&cmdClass=ilobjfoldergui&ref_id={container_ref_id}&item_ref_id=0"
            if container_ref_id
            else "https://ilias.unibe.ch"
        )

        uni_dumps_dir = Path(r"C:\Users\manue\OneDrive\Dokumente\_Uni\IliasAlternative\htmlfromilias")

        # Transform Opencast video containers into rich video players or exact-link cards
        for ocpc in soup.find_all(class_="ocpc-container"):
            ifr = ocpc.find("iframe")
            src = ifr.get("src", "") if ifr else ""

            mp4_url = None
            preview_url = None
            video_title = None
            duration_str = None

            if uni_dumps_dir.exists():
                target_name = Path(src.replace('./', '')).name if ('files' in src or 'ilias' in src) else None
                candidates = list(uni_dumps_dir.rglob(target_name)) if target_name else []
                if not candidates:
                    eid_match = re.search(r'eid=([a-f0-9\-]+)', src)
                    if eid_match:
                        target_eid = eid_match.group(1)
                        for f in uni_dumps_dir.rglob('*.html'):
                            if 'ilias' in f.name.lower():
                                try:
                                    f_txt = f.read_text(encoding='utf-8', errors='replace')
                                    if target_eid in f_txt and '.mp4' in f_txt:
                                        candidates.append(f)
                                        break
                                except Exception:
                                    pass
                for match_file in candidates:
                    try:
                        txt = match_file.read_text(encoding="utf-8", errors="replace")
                        mp4_m = re.search(r'"src":"(https?:\\/\\/[^"]+?\.mp4)"', txt)
                        prev_m = re.search(r'"preview":"(https?:\\/\\/[^"]+?)"', txt)
                        title_m = re.search(r'"title":"([^"]+)"', txt)
                        dur_m = re.search(r'"duration":(\d+)', txt)

                        if mp4_m:
                            mp4_url = mp4_m.group(1).replace(r"\/", "/")
                        if prev_m:
                            preview_url = prev_m.group(1).replace(r"\/", "/")
                        if title_m:
                            video_title = title_m.group(1)
                        if dur_m:
                            dur_sec = int(dur_m.group(1)) // 1000
                            duration_str = f"{dur_sec // 60:02d}:{dur_sec % 60:02d}"
                        break
                    except Exception:
                        pass

            if mp4_url:
                poster_attr = f'poster="{preview_url}"' if preview_url else ""
                title_text = f"{video_title} ({duration_str})" if (video_title and duration_str) else (video_title or "Video-Tutorial")
                player_html = f'''<div class="betterilias-video-player-container my-3" style="max-width: 960px;">
  <video controls playsinline preload="metadata" {poster_attr} class="w-full aspect-video rounded-xl bg-black shadow-md border border-slate-800">
    <source src="{mp4_url}" type="video/mp4" />
    Ihr Browser unterstützt das Video-Tag nicht.
  </video>
  <div class="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 mt-2 px-1">
    <span class="font-medium truncate">{title_text}</span>
    <a href="{ilias_page_url}" target="_blank" rel="noreferrer" class="inline-flex items-center gap-1 text-sky-600 hover:text-sky-500 font-semibold hover:underline shrink-0">
      <span>Auf ILIAS ansehen</span>
      <svg class="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
    </a>
  </div>
</div>'''
                ocpc.replace_with(BeautifulSoup(player_html, "html.parser").div)
            else:
                full_stream_src = src if src.startswith('http') else (f'https://ilias.unibe.ch/{src.lstrip("/")}' if src else ilias_page_url)
                card_html = f'''<div class="betterilias-video-player-container my-3" data-video-stream-url="{full_stream_src}" style="max-width: 960px;">
              <div class="betterilias-video-placeholder ocpc-video-card" data-video-url="{full_stream_src}">
                <div class="betterilias-video-inner">
                  <div class="betterilias-video-play-btn">
                    <svg viewBox="0 0 24 24" fill="currentColor" width="28" height="28"><polygon points="6 4 20 12 6 20 6 4"></polygon></svg>
                  </div>
                  <div class="betterilias-video-info">
                    <span class="betterilias-video-title">Video-Tutorial abspielen</span>
                    <span class="betterilias-video-desc">Opencast Vorlesungs-Player</span>
                  </div>
                  <a href="{ilias_page_url}" target="_blank" rel="noreferrer" class="betterilias-video-btn">
                    <span>Auf ILIAS ansehen</span>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
                  </a>
                </div>
              </div>
            </div>'''
                ocpc.replace_with(BeautifulSoup(card_html, 'html.parser').div)

        # Check remaining iframes
        for ifr in soup.find_all("iframe"):
            src = ifr.get("src", "")
            if ".pdf" in src.lower():
                if not src.startswith("http") and src.startswith("/"):
                    ifr["src"] = f"https://ilias.unibe.ch{src}"
                ifr_classes = ifr.get("class", [])
                if "pdf-embed" not in ifr_classes:
                    ifr["class"] = ifr_classes + ["pdf-embed"]
            elif not src.startswith("http"):
                if src.startswith("/"):
                    ifr["src"] = f"https://ilias.unibe.ch{src}"
                else:
                    fb_html = '''<div class="p-4 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-between gap-3 text-xs">
  <span>Eingebetteter Inhalt (ILIAS)</span>
  <a href="https://ilias.unibe.ch" target="_blank" rel="noreferrer" class="text-sky-600 font-bold hover:underline">In ILIAS öffnen →</a>
</div>'''
                    ifr.replace_with(BeautifulSoup(fb_html, "html.parser").div)

        # Wrap tables in responsive scroll wrapper
        for tbl in soup.find_all("table"):
            if tbl.parent and "ilc_table_StandardTable_wrapper" not in tbl.parent.get("class", []):
                wrapper = soup.new_tag("div", attrs={"class": "ilc_table_StandardTable_wrapper"})
                tbl.wrap(wrapper)

        cleaned = str(soup)

    return cleaned.strip()


def _clean_plain_text(raw_text: str) -> str:
    """Clean plain text from ILIAS comment artifacts and phantom Break tokens."""
    if not raw_text:
        return ""
    cleaned = raw_text.replace('\xa0', ' ').replace('&nbsp;', ' ')
    cleaned = re.sub(r'<!--[\s\S]*?-->', '', cleaned)
    cleaned = re.sub(r'PageTocPH', '', cleaned)
    cleaned = re.sub(r'Break(?=\s*</|\s*$|\s*<)|\bBreak\b', '', cleaned)
    return " ".join(cleaned.split()).strip()



def _detect_material_type(url: str, classes: str, icon_src: Optional[str], title: str = "") -> str:
    """Detect item type (fold, file, exc, frm, tst, webr, sess, mcst, voting, etc.)."""
    s_meta = f"{url} {classes} {icon_src or ''}".lower()
    s_full = f"{s_meta} {title}".lower()

    if "_fold_" in s_meta or "/go/fold/" in s_meta or "icon_fold" in s_meta or "folder" in s_meta:
        return "fold"
    if "_mcst_" in s_meta or "/go/mcst/" in s_meta or "icon_mcst" in s_meta or "mediacast" in s_meta or "video" in s_meta or "xoct" in s_meta or "podcast" in s_full or "opencast" in s_meta:
        return "mcst"
    if "voting" in s_meta or "xlvo" in s_meta or "voting" in title.lower():
        return "voting"
    if "_file_" in s_meta or "/go/file/" in s_meta or "icon_file" in s_meta or "sendfile" in s_meta or "ilobjfilegui" in s_meta or (("file" in s_meta or ".pdf" in s_full) and "xoct" not in s_meta and "podcast" not in s_full):
        return "file"

    if "_exc_" in s_meta or "/go/exc/" in s_meta or "icon_exc" in s_meta or "ilexercise" in s_meta or "ilobjexercisegui" in s_meta:
        return "exc"
    if "_frm_" in s_meta or "/go/frm/" in s_meta or "icon_frm" in s_meta or "forum" in s_full:
        return "frm"
    if "_tst_" in s_meta or "/go/tst/" in s_meta or "icon_tst" in s_meta or "test" in s_meta:
        return "tst"
    if "_webr_" in s_meta or "/go/webr/" in s_meta or "icon_webr" in s_meta or "weblink" in s_meta:
        return "webr"
    if "_sess_" in s_meta or "/go/sess/" in s_meta or "icon_sess" in s_meta or "session" in s_meta:
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
    """Parse a single ILIAS container list or tile card item."""
    # Exclude items located in sidebars, right column, news blocks, or footers
    if el.find_parent(["aside", "footer"]) or el.find_parent(id=re.compile(r"right_col|news", re.I)):
        return None
    if el.find_parent(lambda tag: bool(tag.get("id", "").startswith("block_news_") or "ilNewsForContextBlockGUI" in tag.get("class", []))):
        return None

    # Priority 1: Specific title link (including tile card title links)
    title_link = (
        el.select_one(".caption.card-title a, .card-title a, .il-card-title a")
        or el.select_one("h3 a, h4 a, .il_ContainerItemTitle a, a.il_ContainerItemTitle, .il-item-title a")
        or el.select_one("h3 button, h4 button, .il_ContainerItemTitle button, .il-item-title button")
    )

    # Priority 2: Any non-action link with meaningful text
    if not title_link:
        for a in el.select("a[href*='ref_id'], a[href*='goto_'], a[href*='/go/'], button[data-action*='ref_id']"):
            txt = a.get_text(strip=True)
            if txt and not any(k in txt.lower() for k in ["download", "info", "add to favourites", "notes", "set tags"]):
                title_link = a
                break

    # Priority 3: Fallback link
    if not title_link:
        title_link = el.select_one("a[href*='ref_id'], a[href*='goto_'], a[href*='/go/'], button[data-action*='ref_id']")

    if not title_link:
        return None

    raw_url = (title_link.get("href") or title_link.get("data-action") or "").strip()
    ref_id = _extract_ref_id_from_url(raw_url)
    if not ref_id or ref_id in seen_ref_ids:
        return None

    title = title_link.get_text(strip=True)
    if not title:
        img_alt = el.select_one("img[alt]")
        if img_alt and img_alt.get("alt"):
            alt_txt = img_alt.get("alt", "").replace("Open ", "").strip()
            if alt_txt:
                title = alt_txt
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

    # Extract custom card / tile banner image
    img_elem = el.select_one(".il-card-image-container img, .thumbnail img.img-responsive, img.il-card-img")
    image_url = None
    if img_elem and img_elem.get("src"):
        src = img_elem.get("src")
        if "default_sess" not in src:
            image_url = urllib.parse.urljoin(settings.ilias_base_url, src)

    # Extract icon & type
    icon_elem = el.select_one(".il-card-repository-head img, img.il-item-icon, img.il-icon, img[src*='icon_']")
    icon_src = icon_elem.get("src") if icon_elem else None

    if el.find("img", alt="Session") or (icon_src and "icon_sess" in icon_src) or "/go/sess/" in raw_url:
        item_type = "sess"
    elif "/go/fold/" in raw_url or (icon_src and "icon_fold" in icon_src):
        item_type = "fold"
    elif "/go/file/" in raw_url or (icon_src and "icon_file" in icon_src):
        item_type = "file"
    else:
        item_type = _detect_material_type(raw_url, " ".join(el.get("class", [])), icon_src, title)

    if item_type == "sess":
        return None

    full_url = urllib.parse.urljoin(settings.ilias_base_url, raw_url)

    # Detect download URL if available
    download_url = None
    download_elem = el.select_one("a[href*='cmd=sendfile'], a[href*='cmd=download'], a[href*='download=1'], button[data-action*='cmd=download']")
    if download_elem:
        dl_raw = download_elem.get("href") or download_elem.get("data-action") or ""
        download_url = urllib.parse.urljoin(settings.ilias_base_url, dl_raw)
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
        image_url=image_url,
    )


def _calc_layout_hash(blocks: List[CourseContentBlock]) -> str:
    """Compute a deterministic hash representing the ILIAS layout structure."""
    tokens = []
    for b in blocks:
        tokens.append(f"{b.id}:{b.title_key or b.title or ''}:{b.block_type}")
        for cb in b.child_blocks:
            tokens.append(f"  {cb.id}:{cb.title_key or cb.title or ''}:{cb.block_type}")
    return hashlib.md5("||".join(tokens).encode("utf-8")).hexdigest()


def _parse_column_blocks(
    col_el, child_idx: int, col_idx: int, block_seen_ref_ids: set, container_ref_id: str = ""
) -> List[CourseContentBlock]:
    """Extract sequential content blocks within a single column of a multi-column row."""
    sub_blocks: List[CourseContentBlock] = []

    # 1. Accordions (Drawers) in this column
    acc_cntrs = col_el.select("[class*='AccordCntr'], .ilc_va_cntr_AccordCntr, .ilc_va_cntr_VAccordCntr, .ilc_ha_cntr_HAccordCntr")
    if acc_cntrs:
        for acc in acc_cntrs:
            icntrs = acc.select("[class*='AccordICntr'], .ilc_va_icntr_AccordICntr, .ilc_va_icntr_VAccordICntr")
            for acc_idx, ic in enumerate(icntrs):
                head_el = ic.select_one("[class*='AccordIHeadCap'], [class*='AccordIHead']")
                head_title = _clean_plain_text(head_el.get_text(" ", strip=True)) if head_el else f"Abschnitt {child_idx}-{col_idx}"
                cont_el = ic.select_one(".il_VAccordionContentDef, .ilc_va_icont_VAccordICont, [class*='AccordICont']")
                if not cont_el:
                    continue

                acc_cards = cont_el.select(".ilContainerTileRows .il-card, .il-deck .il-card, .il-card.thumbnail")
                is_acc_tiles = bool(acc_cards)
                acc_item_nodes = acc_cards if acc_cards else cont_el.select(".il_ContainerListItem, .ilContainerListItem, .il-item, .il-std-item")
                acc_items: List[MaterialItem] = []
                for item_el in acc_item_nodes:
                    item = _parse_single_item(item_el, block_seen_ref_ids)
                    if item:
                        acc_items.append(item)

                clone = copy.copy(cont_el)
                for cb in clone.select(".ilContainerBlock, .ilContainerItemsContainer, .il_ContainerListItem, .ilCLI, .dropdown, .ilFloatRight"):
                    cb.decompose()
                for c in clone.find_all(string=lambda s: isinstance(s, Comment)):
                    c.extract()

                rem_html = _clean_rich_html(clone.decode_contents().strip(), container_ref_id)
                rem_text = _clean_plain_text(clone.get_text(" ", strip=True))
                has_media = bool(clone.find_all(["img", "figure", "video", "audio", "iframe"]))
                html_content = rem_html if (rem_text or has_media) else None
                plain_text = rem_text if rem_text else None

                slug = re.sub(r'[^a-zA-Z0-9]+', '-', head_title.lower()).strip('-')
                drawer = CourseContentBlock(
                    id=f"drawer-{slug or child_idx}-{child_idx}-{col_idx}-{acc_idx}",
                    block_type="drawer",
                    presentation="tiles" if is_acc_tiles else "list",
                    title=head_title,
                    html_content=html_content,
                    plain_text=plain_text,
                    items=acc_items,
                    child_blocks=[],
                )
                sub_blocks.append(drawer)

    # 2. Direct items in this column
    col_cards = col_el.select(".ilContainerTileRows .il-card, .il-deck .il-card, .il-card.thumbnail")
    is_col_tiles = bool(col_cards)
    col_item_nodes = col_cards if col_cards else col_el.select(".il_ContainerListItem, .ilContainerListItem, .il-item, .il-std-item")
    col_items: List[MaterialItem] = []
    for item_el in col_item_nodes:
        # Avoid items already captured in accordions
        if item_el.find_parent(class_=re.compile(r"Accord")):
            continue
        item = _parse_single_item(item_el, block_seen_ref_ids)
        if item:
            col_items.append(item)
    if col_items:
        sub_blocks.append(CourseContentBlock(
            id=f"items-col-{child_idx}-{col_idx}",
            block_type="items",
            presentation="tiles" if is_col_tiles else "list",
            title="Inhalte",
            items=col_items,
        ))

    return sub_blocks

def parse_course_blocks(
    soup: BeautifulSoup,
    container_ref_id: str,
    sessions: Optional[List[CourseSessionItem]] = None,
    fallback_items: Optional[List[MaterialItem]] = None,
) -> List[CourseContentBlock]:
    """
    Extract the sequential content blocks as structured on the ILIAS page.
    Preserves lecturer-defined ordering of text, item groups, drawers, and sessions.
    """
    center = soup.select_one("#il_center_col") or soup.select_one(".il-layout-page-content, main, #ilContentContainer")
    if not center:
        return []

    # Clean out any comment nodes upfront so they never leak into text/HTML representations
    for comment in center.find_all(string=lambda s: isinstance(s, Comment)):
        comment.extract()

    block_seen_ref_ids = set()
    blocks: List[CourseContentBlock] = []

    # Flatten composite section blocks (ilc_section_Block) that contain divider titles before accordions/grids/items
    raw_children = []
    for el in center.find_all(recursive=False):
        if "ilc_section_Block" in el.get("class", []):
            sub_els = [s for s in el.find_all(recursive=False) if s.name not in ["script", "style", "nav"]]
            has_composite = False
            for sub in sub_els:
                if (
                    sub.select("[class*='AccordCntr']")
                    or (sub.has_attr("class") and "row-flex" in sub["class"])
                    or sub.select(".il_ContainerListItem, .ilContainerListItem, .ilContainerTileRows, .il-deck")
                ):
                    has_composite = True
                    break
            if has_composite:
                raw_children.extend(sub_els)
                continue
        raw_children.append(el)

    child_idx = 0
    for child in raw_children:
        child_idx += 1
        if child.name in ["script", "style", "nav"]:
            continue
        if child.name == "a" and "ilPageShowAdvContent" in child.get("class", []):
            continue
        if "il-copg-mob-fullscreen-modal" in child.get("class", []):
            continue

        # 0. Multi-column rows (e.g. 2-column layout in Einführung in die Mathematik für WISO I)
        flex_row = child if ("row" in child.get("class", []) and "row-flex" in child.get("class", [])) else child.find(lambda t: t.name == "div" and t.has_attr("class") and "row" in t["class"] and "row-flex" in t["class"])
        if flex_row:
            cols = flex_row.find_all(
                lambda t: t.name == "div" and t.has_attr("class") and any(re.match(r"col-(?:sm|md|lg|xl)-\d+", c) for c in t["class"]),
                recursive=False
            )
            side_by_side = [c for c in cols if any("col-md-6" in " ".join(c["class"]) or "col-md-4" in " ".join(c["class"]) for _ in [1])]
            if len(cols) > 1 and len(side_by_side) > 1:
                col_blocks: List[CourseContentBlock] = []
                for c_idx, c in enumerate(cols):
                    sub_blocks = _parse_column_blocks(c, child_idx, c_idx, block_seen_ref_ids, container_ref_id)
                    col_blocks.append(CourseContentBlock(
                        id=f"col-{child_idx}-{c_idx}",
                        block_type="column",
                        child_blocks=sub_blocks,
                    ))
                if col_blocks and any(cb.child_blocks for cb in col_blocks):
                    blocks.append(CourseContentBlock(
                        id=f"columns-{child_idx}",
                        block_type="columns",
                        columns=len(cols),
                        child_blocks=col_blocks,
                    ))
                    continue

        # 1. Section Heading: H1 / H2 headings (e.g. "Teil Organisation", "Teil Personal", "Organisation + Personal")
        is_heading = child.name in ["h1", "h2"] and (
            "ilc_heading1" in "".join(child.get("class", []))
            or "ilc_heading2" in "".join(child.get("class", []))
            or "ilc_Paragraph" in "".join(child.get("class", []))
        )
        if is_heading:
            sec_title = _clean_plain_text(child.get_text(" ", strip=True))
            if sec_title:
                slug = re.sub(r'[^a-zA-Z0-9]+', '-', sec_title.lower()).strip('-')
                h_block = CourseContentBlock(
                    id=f"heading-{slug or child_idx}-{child_idx}",
                    block_type="heading",
                    title=sec_title,
                )
                blocks.append(h_block)
                continue

        # 2. Page Accordions (Drawers)
        acc_cntrs = child.select("[class*='AccordCntr'], .ilc_va_cntr_AccordCntr, .ilc_va_cntr_VAccordCntr, .ilc_ha_cntr_HAccordCntr")
        if not acc_cntrs and any("accordcntr" in c.lower() for c in child.get("class", [])):
            acc_cntrs = [child]

        if acc_cntrs:
            for acc in acc_cntrs:
                icntrs = acc.select("[class*='AccordICntr'], .ilc_va_icntr_AccordICntr, .ilc_va_icntr_VAccordICntr")
                for acc_idx, ic in enumerate(icntrs):
                    head_el = ic.select_one("[class*='AccordIHeadCap'], [class*='AccordIHead']")
                    head_title = _clean_plain_text(head_el.get_text(" ", strip=True)) if head_el else t("Abschnitt {p0}", p0=child_idx)
                    head_title_key = None if head_el else "Abschnitt {p0}"
                    head_title_values = {} if head_el else {"p0": child_idx}


                    cont_el = ic.select_one(".il_VAccordionContentDef, .ilc_va_icont_VAccordICont, [class*='AccordICont']")
                    if not cont_el:
                        continue

                    # Check if this drawer contains sessions
                    acc_sess_lis = [
                        li for li in cont_el.select("li.ilObjListRow, .ilContainerItemsContainer > li")
                        if "sess" in li.get("id", "") or li.find("img", alt="Session") or li.select_one("img[src*='icon_sess']")
                    ]
                    if acc_sess_lis:
                        session_items: List[CourseSessionItem] = []
                        for sli in acc_sess_lis:
                            title_a = sli.select_one("h3 a, h4 a, .il_ContainerItemTitle a, .il-item-title a") or sli.find("a")
                            if not title_a or not title_a.get_text(strip=True):
                                continue
                            sess_title = title_a.get_text(strip=True)
                            if not sess_title or "previous sessions" in sess_title.lower():
                                continue
                            raw_sess_id = sli.get("id", "")
                            sess_m = re.search(r"sess-(\d+)", raw_sess_id)
                            sess_ref_id = sess_m.group(1) if sess_m else ""
                            if not sess_ref_id or sess_ref_id in block_seen_ref_ids:
                                continue
                            block_seen_ref_ids.add(sess_ref_id)
                            date_m = re.search(r"(\d{1,2}\.\s+[A-Za-z]+\s+\d{4})", sess_title)
                            date_str = date_m.group(1).strip() if date_m else None
                            time_m = re.search(r"(\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2})", sess_title)
                            time_str = time_m.group(1).strip() if time_m else None

                            expand_id = None
                            expand_a = sli.find("a", href=re.compile(r"expand="))
                            if expand_a:
                                m = re.search(r"expand=(-?\d+)", expand_a.get("href", ""))
                                if m:
                                    expand_id = m.group(1)

                            materials_count = None
                            full_text = sli.get_text(" ", strip=True)
                            mat_m = re.search(r"Session Materials:\s*(\d+)", full_text, re.I)
                            if mat_m:
                                materials_count = int(mat_m.group(1))

                            sess_materials: List[MaterialItem] = []
                            for sub_el in sli.select(".ilContainerListItemOuter"):
                                if sub_el.get("id", "") == raw_sess_id:
                                    continue
                                sub_item = _parse_single_item(sub_el, block_seen_ref_ids)
                                if sub_item and sub_item.ref_id != sess_ref_id:
                                    sess_materials.append(sub_item)

                            if sess_materials:
                                materials_count = len(sess_materials)
                            elif materials_count is None:
                                materials_count = 0

                            session_items.append(CourseSessionItem(
                                ref_id=sess_ref_id,
                                title=sess_title,
                                date_str=date_str,
                                time_str=time_str,
                                materials=sess_materials,
                                expand_id=expand_id,
                                materials_count=materials_count,
                            ))

                        slug = re.sub(r'[^a-zA-Z0-9]+', '-', head_title.lower()).strip('-')
                        sess_block = CourseContentBlock(
                            id=f"sessions-{slug or child_idx}-{child_idx}-{acc_idx}",
                            block_type="sessions",
                            title=head_title or t("Sitzungen & Termine"),
                            title_key=head_title_key if head_title else "Sitzungen & Termine",
                            title_values=head_title_values,
                            sessions=session_items,
                        )
                        blocks.append(sess_block)
                        continue

                    # Normal container items inside accordion (list or cards)
                    acc_cards = cont_el.select(".ilContainerTileRows .il-card, .il-deck .il-card, .il-card.thumbnail")
                    is_acc_tiles = bool(acc_cards)
                    acc_item_nodes = acc_cards if acc_cards else cont_el.select(".il_ContainerListItem, .ilContainerListItem, .il-item, .il-std-item")
                    acc_items: List[MaterialItem] = []
                    for item_el in acc_item_nodes:
                        item = _parse_single_item(item_el, block_seen_ref_ids)
                        if item:
                            acc_items.append(item)

                    # Check if rich content / media remains outside container blocks
                    clone = copy.copy(cont_el)
                    for cb in clone.select(".ilContainerBlock, .ilContainerItemsContainer, .il_ContainerListItem, .ilCLI, .dropdown, .ilFloatRight"):
                        cb.decompose()
                    for c in clone.find_all(string=lambda s: isinstance(s, Comment)):
                        c.extract()

                    rem_html = _clean_rich_html(clone.decode_contents().strip(), container_ref_id)
                    rem_text = _clean_plain_text(clone.get_text(" ", strip=True))
                    has_media = bool(clone.find_all(["img", "figure", "video", "audio", "iframe"]))

                    html_content = rem_html if (rem_text or has_media) else None
                    plain_text = rem_text if rem_text else None

                    slug_title = head_title if head_el else f"Abschnitt {child_idx}"
                    slug = re.sub(r'[^a-zA-Z0-9]+', '-', slug_title.lower()).strip('-')
                    acc_drawer = CourseContentBlock(
                        id=f"drawer-{slug or child_idx}-{child_idx}-{acc_idx}",
                        block_type="drawer",
                        presentation="tiles" if is_acc_tiles else "list",
                        title=head_title,
                        title_key=head_title_key,
                        title_values=head_title_values,
                        html_content=html_content,
                        plain_text=plain_text,
                        items=acc_items,
                        child_blocks=[],
                    )
                    blocks.append(acc_drawer)
            continue

        # 3. Sessions Block
        sess_lis = [
            li for li in child.select("li.ilObjListRow, .ilContainerItemsContainer > li")
            if "sess" in li.get("id", "") or li.find("img", alt="Session") or li.select_one("img[src*='icon_sess']")
        ]
        if sess_lis and ("sess" in "".join(child.get("class", [])) or "session" in child.get_text(" ", strip=True).lower() or any("sess" in li.get("id", "") for li in sess_lis)):
            session_items: List[CourseSessionItem] = []
            for sli in sess_lis:
                title_a = sli.select_one("h3 a, h4 a, .il_ContainerItemTitle a, .il-item-title a") or sli.find("a")
                if not title_a or not title_a.get_text(strip=True):
                    continue
                sess_title = title_a.get_text(strip=True)
                if not sess_title or "previous sessions" in sess_title.lower():
                    continue

                raw_sess_id = sli.get("id", "")
                sess_m = re.search(r"sess-(\d+)", raw_sess_id)
                sess_ref_id = sess_m.group(1) if sess_m else _extract_ref_id_from_url(title_a.get("href", ""))
                if not sess_ref_id or sess_ref_id in block_seen_ref_ids:
                    continue
                block_seen_ref_ids.add(sess_ref_id)

                date_m = re.search(r"(\d{1,2}\.\s+[A-Za-z]+\s+\d{4})", sess_title)
                date_str = date_m.group(1).strip() if date_m else None
                time_m = re.search(r"(\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2})", sess_title)
                time_str = time_m.group(1).strip() if time_m else None

                # Expand ID and materials count
                expand_id = None
                expand_a = sli.find("a", href=re.compile(r"expand="))
                if expand_a:
                    m = re.search(r"expand=(-?\d+)", expand_a.get("href", ""))
                    if m:
                        expand_id = m.group(1)

                materials_count = None
                full_text = sli.get_text(" ", strip=True)
                mat_m = re.search(r"Session Materials:\s*(\d+)", full_text, re.I)
                if mat_m:
                    materials_count = int(mat_m.group(1))

                sess_materials: List[MaterialItem] = []
                for sub_el in sli.select(".ilContainerListItemOuter"):
                    if sub_el.get("id", "") == raw_sess_id:
                        continue
                    sub_item = _parse_single_item(sub_el, block_seen_ref_ids)
                    if sub_item and sub_item.ref_id != sess_ref_id:
                        sess_materials.append(sub_item)

                if sess_materials:
                    materials_count = len(sess_materials)
                elif materials_count is None:
                    materials_count = 0

                session_items.append(
                    CourseSessionItem(
                        ref_id=sess_ref_id,
                        title=sess_title,
                        date_str=date_str,
                        time_str=time_str,
                        materials=sess_materials,
                        expand_id=expand_id,
                        materials_count=materials_count,
                    )
                )

            if session_items:
                sess_header = child.select_one("h2, h3, .ilHeader, .ilBlockHeader, legend")
                sess_title = sess_header.get_text(strip=True) if sess_header else t("Sitzungen & Termine")
                sess_block = CourseContentBlock(
                    id=f"sessions-{child_idx}",
                    block_type="sessions",
                    title=sess_title,
                    title_key=None if sess_header else "Sitzungen & Termine",
                    sessions=session_items,
                )
                blocks.append(sess_block)
                continue

        # 4. Item Groups / Container Blocks (List or Tiles)
        tile_cards = child.select(".ilContainerTileRows .il-card, .il-deck .il-card, .il-card.thumbnail")
        is_tiles = bool(tile_cards) or bool(child.select(".ilContainerTileRows, .il-deck"))
        items_in_child = tile_cards if tile_cards else child.select(".il_ContainerListItem, .ilContainerListItem, .il-item, .il-std-item")
        if items_in_child:
            hdr_elem = child.select_one("h2, h3, h4, .ilHeader, .ilBlockHeader, legend")
            raw_hdr = hdr_elem.get_text(strip=True) if hdr_elem else ""
            generic_content = raw_hdr.lower() in ("content", "inhalt", "kursinhalte", "kursinhalt", "inhalte")
            group_title = "Inhalte" if generic_content else raw_hdr
            generated_heading = generic_content or not bool(raw_hdr)

            parsed_items: List[MaterialItem] = []
            for item_el in items_in_child:
                item = _parse_single_item(item_el, block_seen_ref_ids)
                if item:
                    parsed_items.append(item)

            if parsed_items:
                if not group_title:
                    if all(it.item_type == "fold" for it in parsed_items):
                        group_title = "Ordner"
                    elif all(it.item_type == "file" for it in parsed_items):
                        group_title = 'Dateien & Unterlagen'
                    elif all(it.item_type == "mcst" for it in parsed_items):
                        group_title = 'Podcasts & Aufzeichnungen'
                    elif all(it.item_type == "exc" for it in parsed_items):
                        group_title = 'Übungen & Aufgaben'
                    elif all(it.item_type == "frm" for it in parsed_items):
                        group_title = "Forum"
                    else:
                        group_title = "Inhalte"

                block_slug = re.sub(r'[^a-zA-Z0-9]+', '-', group_title.lower()).strip('-')
                item_block = CourseContentBlock(
                    id=f"items-{block_slug or child_idx}-{child_idx}",
                    block_type="items",
                    presentation="tiles" if is_tiles else "list",
                    title=t(group_title) if generated_heading else group_title,
                    title_key=group_title if generated_heading else None,
                    items=parsed_items,
                )
                blocks.append(item_block)
                continue

        # 5. Rich Text / Info Paragraphs
        is_text = ("ilc_text_block_Standard" in child.get("class", []) or child.name in ["p", "blockquote", "ul", "ol", "div", "h2", "h3", "h4", "h5"])
        if is_text:
            inner_html = _clean_rich_html(child.decode_contents().strip(), container_ref_id)
            plain_txt = _clean_plain_text(child.get_text(" ", strip=True))

            if (plain_txt or inner_html) and not child.select(".ilContainerBlock, .il_ContainerListItem"):
                if child.name in ["h2", "h3", "h4", "h5"]:
                    hdr = plain_txt
                    lvl = int(child.name[1]) if child.name[1].isdigit() else 3
                    t_block = CourseContentBlock(
                        id=f"text-{child_idx}",
                        block_type="text",
                        title=hdr,
                        html_content="",
                        plain_text="",
                        level=lvl,
                    )
                    blocks.append(t_block)
                    continue

                if child.name in ["ul", "ol", "blockquote"]:
                    snippet = f"<{child.name}>{inner_html}</{child.name}>"
                elif "<ul" in inner_html or "<ol" in inner_html or "<table" in inner_html:
                    snippet = f"<div>{inner_html}</div>"
                else:
                    snippet = f"<p>{inner_html}</p>"

                is_accent_divider = bool(child.find(class_="ilc_text_inline_Accent")) or (plain_txt and len(plain_txt) < 80 and child.find("strong"))
                if blocks and blocks[-1].block_type == "text" and not is_accent_divider:
                    if blocks[-1].html_content:
                        blocks[-1].html_content = (blocks[-1].html_content + "\n" + snippet).strip()
                    else:
                        blocks[-1].html_content = snippet

                    if blocks[-1].plain_text:
                        blocks[-1].plain_text = (blocks[-1].plain_text + " " + plain_txt).strip()
                    else:
                        blocks[-1].plain_text = plain_txt
                else:
                    t_block = CourseContentBlock(
                        id=f"text-{child_idx}",
                        block_type="text",
                        title=None,
                        html_content=snippet,
                        plain_text=plain_txt,
                        level=3,
                    )
                    blocks.append(t_block)
                continue


    # Fallback if no blocks were produced (e.g. standard subfolder with flat items)
    if not blocks and fallback_items:
        fold_items = [i for i in fallback_items if i.item_type == "fold"]
        file_items = [i for i in fallback_items if i.item_type == "file"]
        other_items = [i for i in fallback_items if i.item_type not in ["fold", "file"]]

        if fold_items:
            blocks.append(
                CourseContentBlock(
                    id=f"items-folders-{container_ref_id}",
                    block_type="items",
                    title=t("Ordner"),
                    title_key="Ordner",
                    items=fold_items,
                )
            )
        if file_items:
            blocks.append(
                CourseContentBlock(
                    id=f"items-files-{container_ref_id}",
                    block_type="items",
                    title=t("Dateien & Unterlagen"),
                    title_key="Dateien & Unterlagen",
                    items=file_items,
                )
            )
        if other_items:
            blocks.append(
                CourseContentBlock(
                    id=f"items-other-{container_ref_id}",
                    block_type="items",
                    title=t("Materialien & Übungen"),
                    title_key="Materialien & Übungen",
                    items=other_items,
                )
            )

    # If sessions were detected globally but not added inside any block
    if sessions:
        has_sess = any(b.block_type == "sessions" or any(cb.block_type == "sessions" for cb in b.child_blocks) for b in blocks)
        if not has_sess:
            blocks.insert(
                0,
                CourseContentBlock(
                    id=f"sessions-{container_ref_id}",
                    block_type="sessions",
                    title=t("Sitzungen & Termine"),
                    title_key="Sitzungen & Termine",
                    sessions=sessions,
                ),
            )

    return blocks


@safe_parser(context_name="course_materials")
def parse_course_materials(html_content: str, container_ref_id: str) -> CourseMaterialsResponse:
    """
    Parse an ILIAS course or folder repository page to extract materials, subfolders,
    structured sections/accordions, and rich text with MathML.
    """
    soup = BeautifulSoup(html_content, "lxml")
    membership = parse_membership(soup, container_ref_id)
    # Registration is handled by our membership dialog, not embedded upstream forms.
    for action in ('join', 'leave'):
        form, _ = membership_form(soup, container_ref_id, action)
        if form:
            form.decompose()
    _clean_math_in_soup(soup)

    # Extract Page / Course Title
    title_elem = (
        soup.select_one("h1.il-page-content-header, h1.ilHeader:not(.modal-title), h1.media-heading:not(.modal-title), h1.il-item-title, .ilMainHeader h1, h1:not(.modal-title)")
        or soup.select_one(".ilTopTitle")
    )
    raw_title = title_elem.get_text(strip=True) if title_elem else t("Container {p0}", p0=container_ref_id)
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

        # Expand ID and materials count
        expand_id = None
        expand_a = sli.find("a", href=re.compile(r"expand="))
        if expand_a:
            m = re.search(r"expand=(-?\d+)", expand_a.get("href", ""))
            if m:
                expand_id = m.group(1)

        materials_count = None
        full_text = sli.get_text(" ", strip=True)
        mat_m = re.search(r"Session Materials:\s*(\d+)", full_text, re.I)
        if mat_m:
            materials_count = int(mat_m.group(1))

        # Extract nested materials in this session drawer
        sess_materials: List[MaterialItem] = []
        for sub_el in sli.select(".ilContainerListItemOuter"):
            if sub_el.get("id", "") == raw_sess_id:
                continue
            sub_item = _parse_single_item(sub_el, seen_ref_ids)
            if sub_item and sub_item.ref_id != sess_ref_id:
                sess_materials.append(sub_item)

        if sess_materials:
            materials_count = len(sess_materials)
        elif materials_count is None:
            materials_count = 0

        sessions.append(
            CourseSessionItem(
                ref_id=sess_ref_id,
                title=sess_title,
                date_str=date_str,
                time_str=time_str,
                materials=sess_materials,
                is_past=is_past,
                expand_id=expand_id,
                materials_count=materials_count,
            )
        )

    center = soup.select_one("#il_center_col") or soup.select_one(".il-layout-page-content, main, #ilContentContainer")

    if center:
        # Clean out any comment nodes upfront
        for comment in center.find_all(string=lambda s: isinstance(s, Comment)):
            comment.extract()

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
                sec_title = _clean_plain_text(child.get_text(strip=True))
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
                hdr_text = _clean_plain_text(child.get_text(strip=True))
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
                inner_html = _clean_rich_html(child.decode_contents().strip(), container_ref_id)
                plain_txt = _clean_plain_text(child.get_text(" ", strip=True))
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
                    group_title = hdr_elem.get_text(strip=True) if hdr_elem else t("Inhalte")

                    group_items: List[MaterialItem] = []
                    cb_tiles = cb.select(".ilContainerTileRows .il-card, .il-deck .il-card, .il-card.thumbnail")
                    cb_nodes = cb_tiles if cb_tiles else cb.select(".il_ContainerListItem, .ilContainerListItem, .il-item, .il-std-item")
                    for item_el in cb_nodes:
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
                                    title=t("Inhalte"),
                                    groups=[],
                                    items=[],
                                    rich_text_blocks=[]
                                ))
                            sections[-1].groups.append(grp)
                            sections[-1].items.extend(group_items)

    # Strategy 2: Collect any missed container items within the main content area
    search_scope = center if center else soup.select_one("main, #ilContentContainer") or soup
    tile_scope_cards = search_scope.select(".ilContainerTileRows .il-card, .il-deck .il-card, .il-card.thumbnail")
    for item_el in (tile_scope_cards if tile_scope_cards else search_scope.select(".ilContainerListItem, .il_ContainerListItem, .il-item, .il-std-item")):
        if item_el.find_parent(["aside", "footer"]) or item_el.find_parent(id=re.compile(r"right_col|news", re.I)):
            continue
        item = _parse_single_item(item_el, seen_ref_ids)
        if item:
            items.append(item)
            if not sections:
                sections.append(CourseSection(
                    id="general",
                    title=t("Inhalte"),
                    groups=[ContentGroup(title=t("Materialien"), items=[item])],
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

    blocks = parse_course_blocks(soup, container_ref_id, sessions=sessions, fallback_items=items)
    layout_hash = _calc_layout_hash(blocks)

    return CourseMaterialsResponse(
        container_ref_id=container_ref_id,
        title=container_title,
        is_enrolled=membership.is_enrolled,
        membership=membership,
        breadcrumbs=breadcrumbs,
        items=items,
        sections=sections,
        rich_text_blocks=rich_text_blocks,
        sessions=sessions,
        logs=logs,
        blocks=blocks,
        layout_hash=layout_hash,
    )
