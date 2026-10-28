from backend.i18n import t
from fastapi import APIRouter, Depends, HTTPException, Path, Query, Response, status, File, Form, UploadFile
import re, logging
from backend.schemas import AuthoringContext, AuthoringResult, CreateFolderRequest, PdfInfoResponse
logger = logging.getLogger(__name__)
from backend.schemas import ManagementResponse, ManageSelection, DeleteReview, DeleteMaterialsRequest, SaveMaterialOrderRequest
from backend.services.authoring import AuthoringError
from fastapi.responses import StreamingResponse
from typing import List, Optional, Literal

from backend.api.deps import get_ilias_client
from backend.schemas import CourseLogsResponse, CourseMaterialsResponse, MaterialItem, PodcastSeriesResponse, VideoStreamResponse
from backend.services.ilias_client import IliasClient
from backend.schemas import RepositoryResponse
from backend.schemas import MembershipFormResponse, MembershipRequest, MembershipResult

router = APIRouter(tags=["Materials"])


@router.get('/materials/{ref_id}/management', response_model=ManagementResponse)
async def get_management(ref_id: str = Path(pattern=r'^\d+$'), client: IliasClient = Depends(get_ilias_client)):
    try:
        return await client.get_management(ref_id)
    except AuthoringError as exc:
        raise HTTPException(exc.status_code, str(exc)) from exc


@router.post('/materials/{ref_id}/deletion-review', response_model=DeleteReview)
async def review_deletion(request: ManageSelection, ref_id: str = Path(pattern=r'^\d+$'), client: IliasClient = Depends(get_ilias_client)):
    try:
        return await client.review_material_deletion(ref_id, request.item_ids)
    except AuthoringError as exc:
        raise HTTPException(exc.status_code, str(exc)) from exc


@router.post('/materials/{ref_id}/batch/delete')
async def delete_materials(request: DeleteMaterialsRequest, ref_id: str = Path(pattern=r'^\d+$'), client: IliasClient = Depends(get_ilias_client)):
    try:
        return await client.delete_materials(ref_id, request)
    except AuthoringError as exc:
        raise HTTPException(exc.status_code, str(exc)) from exc


@router.post('/materials/{ref_id}/order')
async def save_material_order(request: SaveMaterialOrderRequest, ref_id: str = Path(pattern=r'^\d+$'), client: IliasClient = Depends(get_ilias_client)):
    try:
        return await client.save_material_order(ref_id, request)
    except AuthoringError as exc:
        raise HTTPException(exc.status_code, str(exc)) from exc


@router.get('/materials/{ref_id}/authoring-context', response_model=AuthoringContext)
async def get_authoring_context(ref_id: str = Path(pattern=r'^\d+$'), client: IliasClient = Depends(get_ilias_client)):
    try:
        return await client.get_authoring_context(ref_id)
    except AuthoringError as exc:
        raise HTTPException(exc.status_code, str(exc)) from exc


@router.get('/materials/{ref_id}/files/options')
async def get_file_creation_options(ref_id: str = Path(pattern=r'^\d+$'), client: IliasClient = Depends(get_ilias_client)):
    try:
        return await client.get_file_creation_options(ref_id)
    except AuthoringError as exc:
        raise HTTPException(exc.status_code, str(exc)) from exc


@router.get('/materials/{ref_id}/folders/options')
async def get_folder_creation_options(ref_id: str = Path(pattern=r'^\d+$'), client: IliasClient = Depends(get_ilias_client)):
    try:
        return await client.get_folder_creation_options(ref_id)
    except AuthoringError as exc:
        raise HTTPException(exc.status_code, str(exc)) from exc


@router.post('/materials/{ref_id}/folders', response_model=AuthoringResult)
async def create_folder(request: CreateFolderRequest, ref_id: str = Path(pattern=r'^\d+$'), client: IliasClient = Depends(get_ilias_client)):
    try:
        return await client.create_folder(ref_id, request)
    except AuthoringError as exc:
        raise HTTPException(exc.status_code, str(exc)) from exc


@router.post('/materials/{ref_id}/files', response_model=AuthoringResult)
async def upload_course_file(ref_id: str = Path(pattern=r'^\d+$'), file: UploadFile = File(...),
                             license: str = Form(...), client: IliasClient = Depends(get_ilias_client)):
    try:
        return await client.upload_course_file(ref_id, file, license)
    except AuthoringError as exc:
        raise HTTPException(exc.status_code, str(exc)) from exc
    finally:
        await file.close()


@router.get("/repository/{ref_id}", response_model=RepositoryResponse)
async def get_repository(
    ref_id: str = Path(pattern=r"^\d+$"),
    client: IliasClient = Depends(get_ilias_client),
):
    return await client.get_repository(ref_id)



@router.get("/courses/video-stream-info", response_model=VideoStreamResponse)
async def get_video_stream_info(
    response: Response,
    url: str = Query(..., description="Opencast streamVideo URL"),
    client: IliasClient = Depends(get_ilias_client)
):
    """
    Resolve an Opencast streamVideo URL to direct MP4 stream and metadata.
    """
    response.headers['Cache-Control'] = 'private, no-store'
    return await client.resolve_video_stream(url)

@router.get("/courses/{course_id}/materials", response_model=CourseMaterialsResponse)
async def get_materials(
    course_id: str,
    client: IliasClient = Depends(get_ilias_client)
):
    """
    Fetch materials, subfolders, files, and exercises within a course or folder.
    """
    return await client.get_course_materials(ref_id=course_id)


@router.get('/courses/{course_id}/membership', response_model=MembershipFormResponse)
async def get_membership_form(
    course_id: str = Path(pattern=r'^\d+$'),
    action: Literal['join', 'leave'] = Query(...),
    client: IliasClient = Depends(get_ilias_client),
):
    try:
        return await client.get_membership_form(course_id, action)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post('/courses/{course_id}/membership', response_model=MembershipResult)
async def change_membership(
    request: MembershipRequest,
    course_id: str = Path(pattern=r'^\d+$'),
    client: IliasClient = Depends(get_ilias_client),
):
    try:
        return await client.change_course_membership(course_id, request)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


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
            detail=t('Failed to stream download: {p0}', p0=str(e))
        )

@router.get("/pdf/info", response_model=PdfInfoResponse)
async def get_pdf_info(
    url: str = Query(..., description="PDF URL to inspect"),
    client: IliasClient = Depends(get_ilias_client)
):
    """
    Fetch PDF metadata (MediaBox, Rotate, Count) to determine exact aspect ratio
    and page count so embedded course PDFs fit any aspect ratio without letterboxing.
    """
    full_url = url.split("#")[0]
    if not full_url.startswith("http"):
        full_url = f"https://ilias.unibe.ch/{full_url.lstrip('/')}"

    try:
        async with client.session_manager.get_http_client() as http:
            resp = await http.get(full_url, headers={"Range": "bytes=0-32767"}, follow_redirects=True)
            content = resp.content
            if b"/MediaBox" not in content and len(content) < 131072:
                resp = await http.get(full_url, follow_redirects=True)
                content = resp.content[:262144]

            mb = re.search(rb'/MediaBox\s*\[\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\]', content)
            if not mb:
                mb = re.search(rb'/CropBox\s*\[\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\]', content)

            if mb:
                x0, y0, x1, y1 = [float(v) for v in mb.groups()]
                w = abs(x1 - x0)
                h = abs(y1 - y0)
                rot = re.search(rb'/Rotate\s*(\d+)', content)
                if rot and int(rot.group(1)) % 360 in (90, 270):
                    w, h = h, w

                count_m = re.search(rb'/Type\s*/Pages\b[^\>]*?/Count\s+(\d+)', content)
                pages = int(count_m.group(1)) if count_m else 1

                if w > 0 and h > 0:
                    return PdfInfoResponse(
                        width=round(w, 2),
                        height=round(h, 2),
                        aspect_ratio=round(w / h, 4),
                        pages=pages
                    )
    except Exception as e:
        logger.warning(f"Failed to inspect PDF dimensions for {url}: {e}")

    return PdfInfoResponse(aspect_ratio=2.16, pages=1)
