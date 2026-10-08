from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from typing import List, Optional

from backend.api.deps import get_ilias_client
from backend.schemas import CourseLogsResponse, CourseMaterialsResponse, MaterialItem, PodcastSeriesResponse
from backend.services.ilias_client import IliasClient

router = APIRouter(tags=["Materials"])


@router.get("/courses/{course_id}/materials", response_model=CourseMaterialsResponse)
async def get_materials(
    course_id: str,
    client: IliasClient = Depends(get_ilias_client)
):
    """
    Fetch materials, subfolders, files, and exercises within a course or folder.
    """
    return await client.get_course_materials(ref_id=course_id)


@router.get("/courses/{course_id}/sessions/{session_id}/materials", response_model=List[MaterialItem])
async def get_session_materials(
    course_id: str,
    session_id: str,
    expand_id: Optional[str] = Query(None, description="ILIAS expand parameter id"),
    client: IliasClient = Depends(get_ilias_client)
):
    """
    Fetch materials (slides, attachments) for a specific session drawer.
    """
    return await client.get_session_materials(
        course_ref_id=course_id,
        session_ref_id=session_id,
        expand_id=expand_id,
    )



@router.get("/courses/{course_id}/logs", response_model=CourseLogsResponse)
async def get_course_logs(
    course_id: str,
    page: int = Query(1, ge=1, description="News pagination page"),
    client: IliasClient = Depends(get_ilias_client)
):
    """
    Fetch full course activity logs and historical news for a course.
    """
    return await client.get_course_logs(course_id=course_id, page=page)


@router.get("/podcasts/{ref_id}", response_model=PodcastSeriesResponse)
async def get_podcasts(
    ref_id: str,
    client: IliasClient = Depends(get_ilias_client)
):
    """
    Fetch and parse Opencast / Mediacast episodes for a course or podcast series,
    automatically traversing pagination and ordering available recorded episodes first.
    """
    return await client.get_podcast_series(ref_id=ref_id)


@router.get("/materials/{ref_id}/download")
async def download_material_file(
    ref_id: str,
    custom_url: Optional[str] = Query(None, description="Explicit download URL if known"),
    client: IliasClient = Depends(get_ilias_client)
):
    """
    Stream and download a material file (PDF, slides, archive) directly via the authenticated backend.
    """
    download_target = custom_url or f"ilias.php?baseClass=ilRepositoryGUI&ref_id={ref_id}&cmd=sendfile"
    try:
        stream_gen, headers, status_code = await client.stream_download(download_target)
        return StreamingResponse(
            stream_gen,
            status_code=status_code,
            headers=headers
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to stream download: {str(e)}"
        )

