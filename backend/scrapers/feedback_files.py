import re
from typing import List, Optional
from urllib.parse import urljoin
from bs4 import BeautifulSoup

from backend.config import settings
from backend.schemas import FeedbackFileItem, FeedbackFilesResponse
from backend.scrapers.dumper import safe_parser


@safe_parser(context_name="feedback_files")
def parse_feedback_files(html: str, base_url: str = settings.ilias_base_url) -> FeedbackFilesResponse:
    """
    Parses the ILIAS ilResourceCollectionGUI page (Feedback / Evaluation Files).
    Extracts student name, member ID, upload form action, remove form action,
    and the list of feedback files with download and remove links.
    """
    soup = BeautifulSoup(html, "lxml")

    # 1. Student name
    student_name: Optional[str] = None
    for h in soup.find_all(["h1", "h2", "h3", "h4"]):
        text = h.get_text(strip=True)
        if any(w in text for w in ["Evaluation Files:", "Korrektur-Dateien:", "Feedback Files:"]):
            parts = text.split(":", 1)
            if len(parts) > 1:
                student_name = parts[1].strip()
                break

    # 2. Member ID
    member_id = ""
    member_input = soup.select_one("input[name='member_id']")
    if member_input and member_input.get("value"):
        member_id = member_input.get("value", "").strip()
    else:
        m = re.search(r"member_id=(\d+)", html)
        if m:
            member_id = m.group(1)

    # 3. Upload URL / form action
    upload_url: Optional[str] = None
    post_form = soup.select_one("form[action*='cmd=postUpload']")
    if post_form and post_form.get("action"):
        upload_url = urljoin(base_url, post_form.get("action"))
    else:
        m_upload = re.search(r"['\"](ilias\.php\?[^'\"]*cmd=postUpload[^'\"]*)['\"]", html)
        if m_upload:
            upload_url = urljoin(base_url, m_upload.group(1))

    # 4. Remove form action
    remove_form = soup.select_one("form[action*='cmd=remove']")
    default_remove_url = urljoin(base_url, remove_form.get("action")) if remove_form and remove_form.get("action") else None

    # 5. Files Table
    files: List[FeedbackFileItem] = []
    table = soup.select_one(".c-table-data__table")
    if table:
        for row in table.select("tbody tr"):
            row_text = row.get_text(strip=True)
            if "No records" in row_text or "Keine Einträge" in row_text:
                continue

            # Valid file rows have a row-selector checkbox with the file UUID as value
            checkbox = row.select_one("input.c-table-data__row-selector")
            if not checkbox or not checkbox.get("value"):
                continue

            file_id = checkbox["value"].strip()

            # Parse columns cleanly by stripping internal col-title spans
            col_map = {}
            for cell in row.find_all("td"):
                cell_copy = BeautifulSoup(str(cell), "lxml")
                col_title_el = cell_copy.select_one(".c-table-data__cell__col-title")
                col_key = col_title_el.get_text(strip=True).rstrip(":").lower() if col_title_el else ""
                if col_title_el:
                    col_title_el.decompose()
                val = cell_copy.get_text(strip=True)
                if col_key:
                    col_map[col_key] = val

            cells = row.find_all("td")
            title = (
                col_map.get("title")
                or col_map.get("titel")
                or (cells[1].get_text(strip=True) if len(cells) > 1 else "File")
            )
            size = (
                col_map.get("size")
                or col_map.get("grösse")
                or col_map.get("groesse")
                or (cells[2].get_text(strip=True) if len(cells) > 2 else "")
            )
            created_on = (
                col_map.get("created on")
                or col_map.get("erstellt am")
                or (cells[3].get_text(strip=True) if len(cells) > 3 else "")
            )
            file_type = (
                col_map.get("file type")
                or col_map.get("dateityp")
                or (cells[4].get_text(strip=True) if len(cells) > 4 else "")
            )

            # Download link: check button[data-action*="cmd=download"], a[href*="cmd=download"], or row action
            dl_el = row.find(
                lambda el: el.name in ["button", "a"]
                and "cmd=download" in (el.get("data-action") or el.get("href") or "")
            )
            download_url: Optional[str] = None
            if dl_el:
                raw_dl = dl_el.get("data-action") or dl_el.get("href")
                if raw_dl:
                    download_url = urljoin(base_url, raw_dl)

            files.append(
                FeedbackFileItem(
                    id=file_id,
                    title=title,
                    size=size,
                    created_on=created_on,
                    file_type=file_type,
                    download_url=download_url,
                    remove_url=default_remove_url,
                )
            )

    return FeedbackFilesResponse(
        member_id=member_id,
        student_name=student_name,
        files=files,
        upload_url=upload_url,
    )
