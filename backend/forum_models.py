"""Public forum DTOs. Native action URLs and CSRF fields remain server-side."""
from typing import Literal
from pydantic import BaseModel, Field


class ForumThread(BaseModel):
    id: str
    title: str
    author: str = ''
    last_post: str = ''
    post_count: int = 0
    view_count: int | None = None
    unread: bool = False
    closed: bool = False
    sticky: bool = False
    actions: list[str] = Field(default_factory=list)


class ForumOverview(BaseModel):
    ref_id: str
    title: str
    intro_html: str = ''
    threads: list[ForumThread] = Field(default_factory=list)
    can_create: bool = False
    can_edit_page: bool = False
    editor_url: str | None = None
    page: int = 0
    has_more: bool = False


class ForumAttachment(BaseModel):
    title: str
    url: str


class ForumPost(BaseModel):
    id: str
    subject: str = ''
    author: str = ''
    date: str = ''
    edited: str = ''
    html: str = ''
    avatar_url: str | None = None
    depth: int = 1
    can_reply: bool = False
    can_edit: bool = False
    attachments: list[ForumAttachment] = Field(default_factory=list)


class ForumConversation(BaseModel):
    ref_id: str
    thread_id: str
    title: str
    posts: list[ForumPost] = Field(default_factory=list)
    closed: bool = False
    page: int = 0
    has_more: bool = False


class ForumWrite(BaseModel):
    operation_id: str = Field(pattern=r'^[a-zA-Z0-9_-]{16,128}$')
    subject: str = Field(min_length=1, max_length=255)
    message: str = Field(min_length=1, max_length=200000)
    parent_id: str | None = Field(default=None, pattern=r'^\d+$')
    edit_post_id: str | None = Field(default=None, pattern=r'^\d+$')
    notify: bool = False
    page: int = Field(default=0,ge=0,le=1000)


class ForumModeration(BaseModel):
    action: Literal['close', 'reopen', 'makesticky', 'unmakesticky', 'delete']


class ForumWriteResult(BaseModel):
    thread_id: str
    post_id: str


class ForumTextBlock(BaseModel):
    id: str
    content: str
    characteristic: str = 'Standard'


class ForumPageElement(BaseModel):
    id: str
    text_block: ForumTextBlock | None = None
    preview_html: str = ''


class ForumPage(BaseModel):
    ref_id: str
    revision: str
    blocks: list[ForumTextBlock] = Field(default_factory=list)
    append_after_id: str = 'pg'
    preview_html: str = ''
    other_components: int = 0
    elements: list[ForumPageElement] = Field(default_factory=list)


class ForumPageWrite(BaseModel):
    operation_id: str = Field(pattern=r'^[a-zA-Z0-9_-]{16,128}$')
    revision: str = Field(pattern=r'^[a-f0-9]{64}$')
    action: Literal['insert','update','delete']
    block_id: str | None = Field(default=None,pattern=r'^[a-zA-Z0-9_-]{1,64}$')
    after_id: str = Field(default='pg',pattern=r'^[a-zA-Z0-9_-]{1,64}$')
    content: str = Field(default='',max_length=200000)
