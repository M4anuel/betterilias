"""Cookie-owned public requests and separately authenticated moderation."""
import secrets
from typing import Literal

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, Response
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, field_validator
from starlette.concurrency import run_in_threadpool

from backend import feature_requests as board
from backend.api.routes.admin import administrator, browser_mutation
from backend.config import settings

router = APIRouter(prefix='/feature-requests', tags=['Community requests'])
admin_router = APIRouter(prefix='/admin/feature-requests', dependencies=[Depends(administrator)])
Category = Literal['feature', 'qol', 'ilias']
Status = Literal['open', 'planned', 'in_progress', 'completed', 'declined']


class CommunityBodyLimit:
    """Bound streams before JSON decoding, including chunked bodies."""
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        path = scope.get('path', '')
        if scope['type'] != 'http' or not path.startswith(('/api/feature-requests', '/api/admin/feature-requests')):
            return await self.app(scope, receive, send)
        limit = board.MAX_FILE if path == '/api/feature-requests/images' else 65536
        size = 0

        async def bounded_receive():
            nonlocal size
            message = await receive()
            size += len(message.get('body', b''))
            if size > limit:
                board.fail('image_limits' if limit == board.MAX_FILE else 'invalid', 413)
            return message

        return await self.app(scope, bounded_receive, send)


def reader(request: Request, response: Response):
    response.headers['Cache-Control'] = 'no-store'
    return board.identity(request.cookies.get(board.COOKIE))


def writer(request: Request, response: Response, x_community_request: str = Header(default='')):
    if x_community_request != '1':
        board.fail('invalid', 403)
    owner = reader(request, response)
    if not owner:
        board.fail('identity_required', 403)
    return owner


class RequestBody(BaseModel):
    title: str = Field(min_length=1, max_length=180)
    description: str = Field(min_length=1, max_length=12000)
    category: Category = 'feature'
    nickname: str = Field(default='', max_length=50)
    images: list[str] = Field(default_factory=list, max_length=5)

    @field_validator('title', 'description')
    @classmethod
    def nonblank(cls, value):
        if not value.strip():
            board.fail('required', 422)
        return value


class CommentBody(BaseModel):
    message: str = Field(min_length=1, max_length=6000)
    nickname: str = Field(default='', max_length=50)

    @field_validator('message')
    @classmethod
    def nonblank(cls, value):
        if not value.strip():
            board.fail('required', 422)
        return value


class VoteBody(BaseModel):
    value: Literal[-1, 0, 1]


class StatusBody(BaseModel):
    status: Status


@router.post('/identity')
def establish_identity(request: Request, response: Response, x_community_request: str = Header(default='')):
    if x_community_request != '1':
        board.fail('invalid', 403)
    response.headers['Cache-Control'] = 'no-store'
    if not board.identity(request.cookies.get(board.COOKIE)):
        response.set_cookie(board.COOKIE, secrets.token_hex(32), max_age=365 * 86400,
            httponly=True, secure=settings.app_env == 'production', samesite='strict', path='/api/feature-requests')
    return {'ready': True}


@router.get('')
def listing(owner=Depends(reader), search: str = Query(default='', max_length=180),
            category: Literal['', 'feature', 'qol', 'ilias'] = '',
            status: Literal['', 'open', 'planned', 'in_progress', 'completed', 'declined'] = '',
            sort: Literal['top', 'newest'] = 'top', page: int = Query(default=0, ge=0, le=100000)):
    return board.listing(owner, search, category, status, sort, page)


@router.post('/images')
async def upload(request: Request, owner=Depends(writer)):
    # Bound raw upload buffers across workers as well as decoder memory.
    async with board.SharedLock('community-intake:' + str(board.root()), timeout=30).async_():
        raw = bytearray()
        async for chunk in request.stream():
            raw.extend(chunk)
            if len(raw) > board.MAX_FILE:
                board.fail('image_limits', 413)
        return await run_in_threadpool(board.upload, bytes(raw), owner)


@router.api_route('/media/{image_id}/{width}', methods=['GET', 'HEAD'])
def media(image_id: str, width: int, request: Request):
    with board.database() as db:
        row = db.execute('SELECT * FROM images WHERE id=? AND request_id IS NOT NULL', (image_id,)).fetchone()
        if not row or width not in [v['width'] for v in board.json.loads(row['variants'])]:
            board.fail('not_found', 404)
    path = board.root() / 'media' / f'{image_id}-{width}.webp'
    if not path.is_file():
        board.fail('not_found', 404)
    etag = '"' + image_id + '-' + str(width) + '"'
    headers = {'Cache-Control': 'public, max-age=3600, must-revalidate', 'ETag': etag, 'X-Content-Type-Options': 'nosniff'}
    if request.headers.get('if-none-match') == etag:
        return Response(status_code=304, headers=headers)
    return FileResponse(path, media_type='image/webp', headers=headers)


@router.post('')
def create(payload: RequestBody, owner=Depends(writer)):
    return board.save(payload, owner)


@router.get('/{ref}')
def detail(ref: str, owner=Depends(reader)):
    return board.detail(ref, owner)


@router.patch('/{ref}')
def edit(ref: str, payload: RequestBody, owner=Depends(writer)):
    return board.save(payload, owner, ref)


@router.delete('/{ref}')
def delete(ref: str, owner=Depends(writer)):
    return board.delete(ref, owner)


@router.put('/{ref}/vote')
def vote(ref: str, payload: VoteBody, owner=Depends(writer)):
    return board.vote(ref, owner, payload.value)


@router.post('/{ref}/comments')
def comment(ref: str, payload: CommentBody, owner=Depends(writer)):
    return board.comment(ref, owner, payload)


@router.patch('/{ref}/comments/{comment_id}')
def edit_comment(ref: str, comment_id: str, payload: CommentBody, owner=Depends(writer)):
    return board.comment(ref, owner, payload, comment_id)


@router.delete('/{ref}/comments/{comment_id}')
def delete_comment(ref: str, comment_id: str, owner=Depends(writer)):
    return board.comment(ref, owner, comment_id=comment_id)


@admin_router.get('')
def admin_list(search: str = Query(default='', max_length=180),
               category: Literal['', 'feature', 'qol', 'ilias'] = '',
               status: Literal['', 'open', 'planned', 'in_progress', 'completed', 'declined'] = '',
               sort: Literal['top', 'newest'] = 'top', page: int = Query(default=0, ge=0, le=100000)):
    return {**board.listing('', search, category, status, sort, page), 'storage': board.storage()}


@admin_router.get('/{ref}')
def admin_detail(ref: str):
    return board.detail(ref)


@admin_router.patch('/{ref}', dependencies=[Depends(browser_mutation)])
def admin_edit(ref: str, payload: RequestBody):
    return board.save(payload, '', ref, admin=True)


@admin_router.put('/{ref}/status', dependencies=[Depends(browser_mutation)])
def admin_status(ref: str, payload: StatusBody):
    return board.set_status(ref, payload.status)


@admin_router.delete('/{ref}', dependencies=[Depends(browser_mutation)])
def admin_delete(ref: str):
    return board.delete(ref, admin=True)


@admin_router.patch('/{ref}/comments/{comment_id}', dependencies=[Depends(browser_mutation)])
def admin_edit_comment(ref: str, comment_id: str, payload: CommentBody):
    return board.comment(ref, '', payload, comment_id, admin=True)


@admin_router.delete('/{ref}/comments/{comment_id}', dependencies=[Depends(browser_mutation)])
def admin_delete_comment(ref: str, comment_id: str):
    return board.comment(ref, '', comment_id=comment_id, admin=True)
