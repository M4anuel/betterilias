from typing import List, Optional
import re
from bs4 import BeautifulSoup
from urllib.parse import urljoin
from backend.schemas import FeedbackFileItem, FeedbackFilesResponse


def parse_feedback_files(html: str, base_url: str = "https://ilias.unibe.ch") -> FeedbackFilesResponse:
    """
    Parses the ILIAS ilResourceCollectionGUI page (Feedback / Evaluation Files).
    """
    soup = BeautifulSoup(html, "html.parser")

    # 1. Student name
    student_name: Optional[str] = None
    for h in soup.find_all(["h1", "h2", "h3"]):
        text = h.get_text(strip=True)
        if "Evaluation Files:" in text or "Korrektur-Dateien:" in text or "Feedback Files:" in text:
            parts = text.split(":", 1)
            if len(parts) > 1:
                student_name = parts[1].strip()
                break

    # 2. Member ID & Ref ID
    member_id = ""
    member_input = soup.select_one("input[name='member_id']")
    if member_input and member_input.get("value"):
        member_id = member_input.get("value", "").strip()
    else:
        # Check in forms or scripts
        m = re.search(r"member_id=(\d+)", html)
        if m:
            member_id = m.group(1)

    # 3. Upload URL
    upload_url: Optional[str] = None
    form = soup.select_one("form[action*='cmd=postUpload'], form[action*='ilResourceCollectionGUI']")
    if form and form.get("action"):
        upload_url = urljoin(base_url, form.get("action"))
    else:
        # Check script Dropzone / Input.File.init
        m_upload = re.search(r"['\"](ilias\.php\?[^'\"]*cmd=(?:postUpload|upload)[^'\"]*)['\"]", html)
        if m_upload:
            upload_url = urljoin(base_url, m_upload.group(1))

    # 4. Files Table
    files: List[FeedbackFileItem] = []
    table = soup.select_one(".c-table-data__table")
    if table:
        for row in table.select("tbody tr"):
            row_text = row.get_text(strip=True)
            if "No records" in row_text or "Keine Einträge" in row_text:
                continue

            cells = row.find_all("td")
            if len(cells) >= 4:
                title = cells[0].get_text(strip=True)
                size = cells[1].get_text(strip=True)
                created_on = cells[2].get_text(strip=True)
                file_type = cells[3].get_text(strip=True)

                # Check download link
                download_link = row.select_one("a[href*='cmd=download']")
                download_url: Optional[str] = None
                if download_link and download_link.get("href"):
                    download_url = urljoin(base_url, download_link.get("href"))

                # Check remove link
                remove_link = row.select_one("a[href*='cmd=remove'], a[href*='renderConfirmRemove']")
                remove_url: Optional[str] = None
                if remove_link and remove_link.get("href"):
                    remove_url = urljoin(base_url, remove_link.get("href"))

                file_id = row.get("data-rowid") or row.get("id") or str(len(files) + 1)
                files.append(
                    FeedbackFileItem(
                        id=str(file_id),
                        title=title,
                        size=size,
                        created_on=created_on,
                        file_type=file_type,
                        download_url=download_url,
                        remove_url=remove_url,
                    )
                )

    return FeedbackFilesResponse(
        member_id=member_id,
        student_name=student_name,
        files=files,
        upload_url=upload_url,
    )

