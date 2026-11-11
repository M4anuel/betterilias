import re
from fastapi import APIRouter, Depends, File, Form, HTTPException, Path, Query, UploadFile
from pydantic import ValidationError
from backend.api.deps import get_ilias_client
from backend.forum_models import ForumOverview, ForumConversation, ForumWrite, ForumWriteResult, ForumModeration, ForumPage, ForumPageWrite
from backend.services.authoring import AuthoringError
from backend.i18n import t

router = APIRouter(tags=['Forums'])


async def execute(operation):
    try: return await operation
    except AuthoringError as exc: raise HTTPException(exc.status_code,str(exc)) from exc


@router.get('/forums/{ref_id}',response_model=ForumOverview)
async def overview(ref_id: str = Path(pattern=r'^\d+$'),page: int = Query(0,ge=0,le=1000),client=Depends(get_ilias_client)):
    return await execute(client.get_forum(ref_id,page))


@router.get('/forums/{ref_id}/page',response_model=ForumPage)
async def page(ref_id: str = Path(pattern=r'^\d+$'),client=Depends(get_ilias_client)):
    return await execute(client.get_forum_page(ref_id))


@router.post('/forums/{ref_id}/page',response_model=ForumPage)
async def write_page(request: ForumPageWrite,ref_id: str = Path(pattern=r'^\d+$'),client=Depends(get_ilias_client)):
    return await execute(client.write_forum_page(ref_id,request))


@router.get('/forums/{ref_id}/threads/{thread_id}',response_model=ForumConversation)
async def thread(ref_id: str = Path(pattern=r'^\d+$'),thread_id: str = Path(pattern=r'^\d+$'),page: int = Query(0,ge=0,le=1000),client=Depends(get_ilias_client)):
    return await execute(client.get_forum_thread(ref_id,thread_id,page))


@router.get('/forums/{ref_id}/threads/{thread_id}/posts/{post_id}/edit')
async def edit_post(ref_id: str = Path(pattern=r'^\d+$'),thread_id: str = Path(pattern=r'^\d+$'),post_id: str = Path(pattern=r'^\d+$'),page: int = Query(0,ge=0,le=1000),client=Depends(get_ilias_client)):
    return await execute(client.get_forum_edit_post(ref_id,thread_id,post_id,page))


@router.post('/forums/{ref_id}/threads/{thread_id}/moderate',response_model=ForumOverview)
async def moderate(request: ForumModeration,ref_id: str = Path(pattern=r'^\d+$'),thread_id: str = Path(pattern=r'^\d+$'),client=Depends(get_ilias_client)):
    return await execute(client.moderate_forum_thread(ref_id,thread_id,request.action))


async def submit(ref_id,thread_id,payload,files,client):
    try: request = ForumWrite.model_validate_json(payload)
    except ValidationError: raise HTTPException(422,t('validation.invalid'))
    uploads = []; total = 0
    if len(files)>10: raise HTTPException(413,t('forum.files_too_large'))
    for upload in files:
        content = await upload.read(25*1024*1024+1); total += len(content)
        if total>25*1024*1024: raise HTTPException(413,t('forum.files_too_large'))
        filename=(upload.filename or 'attachment').replace('\\','/').split('/')[-1]
        if not filename or len(filename)>255 or re.search(r'[\x00-\x1f\x7f]',filename): raise HTTPException(422,t('validation.invalid'))
        mime=upload.content_type or 'application/octet-stream'
        if not re.fullmatch(r'[A-Za-z0-9.+_-]+/[A-Za-z0-9.+_-]+',mime): mime='application/octet-stream'
        uploads.append((filename,content,mime))
    return await execute(client.write_forum_post(ref_id,request,thread_id,uploads))


@router.post('/forums/{ref_id}/threads',response_model=ForumWriteResult)
async def create(payload: str = Form(...),files: list[UploadFile] = File(default=[]),ref_id: str = Path(pattern=r'^\d+$'),client=Depends(get_ilias_client)):
    return await submit(ref_id,None,payload,files,client)


@router.post('/forums/{ref_id}/threads/{thread_id}/posts',response_model=ForumWriteResult)
async def post(payload: str = Form(...),files: list[UploadFile] = File(default=[]),ref_id: str = Path(pattern=r'^\d+$'),thread_id: str = Path(pattern=r'^\d+$'),client=Depends(get_ilias_client)):
    return await submit(ref_id,thread_id,payload,files,client)
