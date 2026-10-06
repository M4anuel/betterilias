from fastapi import APIRouter, HTTPException, status
from fastapi.responses import HTMLResponse
from typing import List

from backend.schemas import FailedDumpSummary, FailedDumpDetail
from backend.scrapers.dumper import list_failed_dumps, get_dump_content
from backend.config import settings

router = APIRouter(prefix="/system", tags=["System & AI Maintenance"])


@router.get("/logs", response_model=List[FailedDumpSummary])
async def get_failed_logs():
    """
    List all failed HTML dumps created during scraping errors.
    Used for debugging and the AI Maintenance Protocol.
    """
    return list_failed_dumps()


@router.get("/logs/{filename}/raw", response_class=HTMLResponse)
async def view_dump_html(filename: str):
    """
    View the raw HTML content of a failed scraping dump directly in browser.
    """
    content = get_dump_content(filename)
    if content is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Dump file '{filename}' not found."
        )
    return HTMLResponse(content=content)


@router.get("/logs/{filename}", response_model=FailedDumpDetail)
async def get_dump_details(filename: str):
    """
    Get full details and raw HTML string of a failed dump for AI prompts.
    """
    content = get_dump_content(filename)
    if content is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Dump file '{filename}' not found."
        )

    # Context extraction from filename
    context = filename.split("_")[3] if len(filename.split("_")) > 3 else "unknown"
    return FailedDumpDetail(
        filename=filename,
        context=context,
        created_at="",
        html_content=content
    )


@router.delete("/logs/{filename}")
async def delete_dump_file(filename: str):
    """Delete a failed HTML dump once resolved."""
    safe_name = filename.split("/")[-1].split("\\")[-1]
    dump_path = settings.log_path / safe_name
    if dump_path.exists() and dump_path.is_file():
        dump_path.unlink()
        return {"success": True, "message": f"Dump '{safe_name}' deleted."}
    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail=f"Dump file '{safe_name}' not found."
    )

