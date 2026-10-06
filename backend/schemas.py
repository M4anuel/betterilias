from datetime import datetime, timezone
from typing import Dict, List, Optional, Any
from pydantic import BaseModel, Field

# ---------------------------------------------------------
# Auth Schemas
# ---------------------------------------------------------
class AuthStatus(BaseModel):
    authenticated: bool
    client_id: Optional[str] = None
    cookies_present: bool = False
    message: Optional[str] = None
    user_name: Optional[str] = None

class ManualCookiesInput(BaseModel):
    phpsessid: str = Field(..., description="Value of PHPSESSID cookie")
    il_client_id: Optional[str] = Field("ilias3_unibe", description="Value of ilClientId cookie")
    additional_cookies: Optional[Dict[str, str]] = Field(default_factory=dict)

# ---------------------------------------------------------
# Dashboard & Course Schemas
# ---------------------------------------------------------
class CourseItem(BaseModel):
    ref_id: str
    title: str
    description: Optional[str] = None
    url: str
    item_type: str = "crs"  # crs (course), grp (group), fold (folder), etc.
    icon: Optional[str] = None
    semester: Optional[str] = None

class DashboardResponse(BaseModel):
    courses: List[CourseItem]
    fetched_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

# ---------------------------------------------------------
# Course Materials Schemas
# ---------------------------------------------------------
class BreadcrumbItem(BaseModel):
    title: str
    ref_id: Optional[str] = None
    url: Optional[str] = None

class MaterialItem(BaseModel):
    ref_id: str
    title: str
    item_type: str  # fold, file, exc, tst, frm, webr, sess, mcst, etc.
    description: Optional[str] = None
    url: str
    download_url: Optional[str] = None
    file_size: Optional[str] = None
    properties: Dict[str, str] = Field(default_factory=dict)

class RichTextBlock(BaseModel):
    title: Optional[str] = None
    level: int = 3  # e.g. 1 for h1, 2 for h2, 3 for h3
    html_content: str  # Formatted HTML including MathML equations, lists, links
    plain_text: Optional[str] = None

class ContentGroup(BaseModel):
    title: str  # e.g. "Folien Organisation", "Übungsfragen Organisation"
    items: List[MaterialItem] = Field(default_factory=list)

class CourseSection(BaseModel):
    id: str  # Unique slug or identifier
    title: str  # e.g. "Teil Organisation", "Teil Personal"
    description: Optional[str] = None
    groups: List[ContentGroup] = Field(default_factory=list)
    items: List[MaterialItem] = Field(default_factory=list)
    rich_text_blocks: List[RichTextBlock] = Field(default_factory=list)

class CourseLogItem(BaseModel):
    title: str  # e.g. "One file has been added." or "Übungspartner:in"
    target: Optional[str] = None  # e.g. "File: 2_PO-Organisation_2026_Praxisfolien"
    date: Optional[str] = None  # e.g. "Today, 09:25" or "30. Sep 2026, 18:34"
    url: Optional[str] = None
    log_type: str = "file"  # "file", "forum", "exercise", "general"

class PodcastEpisode(BaseModel):
    id: str  # eid
    title: str
    date: Optional[str] = None
    presenter: Optional[str] = None
    location: Optional[str] = None
    stream_url: Optional[str] = None
    status: str = "available"  # "available" (recorded) or "scheduled" (future / upcoming)

class PodcastSeriesResponse(BaseModel):
    ref_id: str
    title: str
    total_episodes: int
    recorded_count: int
    scheduled_count: int
    pages_available: List[str] = Field(default_factory=list)
    episodes: List[PodcastEpisode] = Field(default_factory=list)
    fetched_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class CourseSessionItem(BaseModel):
    ref_id: str
    title: str
    date_str: Optional[str] = None
    time_str: Optional[str] = None
    location: Optional[str] = None
    materials: List[MaterialItem] = Field(default_factory=list)
    is_past: bool = False

class CourseLogsResponse(BaseModel):
    course_id: str
    logs: List[CourseLogItem] = Field(default_factory=list)
    total_pages: int = 1
    current_page: int = 1
    fetched_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class CourseMaterialsResponse(BaseModel):
    container_ref_id: str
    title: Optional[str] = None
    breadcrumbs: List[BreadcrumbItem] = Field(default_factory=list)
    items: List[MaterialItem] = Field(default_factory=list)
    sections: List[CourseSection] = Field(default_factory=list)
    rich_text_blocks: List[RichTextBlock] = Field(default_factory=list)
    sessions: List[CourseSessionItem] = Field(default_factory=list)
    logs: List[CourseLogItem] = Field(default_factory=list)
    fetched_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

# ---------------------------------------------------------
# Exercises & Submissions Schemas
# ---------------------------------------------------------
class SubmissionFile(BaseModel):
    filename: str
    download_url: str
    upload_time: Optional[str] = None
    file_size: Optional[str] = None

class SubmissionItem(BaseModel):
    member_id: str  # participant/user ID or submission ID
    student_name: str
    login: Optional[str] = None
    submission_status: str  # submitted, not_submitted, late, etc.
    submission_time: Optional[str] = None
    files: List[SubmissionFile] = Field(default_factory=list)
    mark: Optional[str] = None  # grade/points (e.g. 5.5 or 10/10)
    passed_status: Optional[str] = None  # passed, failed, not_graded
    feedback: Optional[str] = None
    notice: Optional[str] = None
    can_grade: bool = True
    hidden_form_fields: Optional[Dict[str, str]] = None

class ExerciseInfo(BaseModel):
    ref_id: str
    title: str
    instructions: Optional[str] = None
    deadline: Optional[str] = None
    total_participants: int = 0
    submitted_count: int = 0
    graded_count: int = 0

class ExerciseSubmissionsResponse(BaseModel):
    exercise: ExerciseInfo
    submissions: List[SubmissionItem]
    fetched_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class GradeSubmissionRequest(BaseModel):
    member_id: str
    status: Optional[str] = Field(None, description="e.g. 'passed', 'failed', 'not_graded'")
    mark: Optional[str] = Field(None, description="Grade or points (e.g. '6.0' or '10')")
    feedback: Optional[str] = Field(None, description="TA Feedback text visible to student")
    notice: Optional[str] = Field(None, description="Internal notice/notes for tutors")

class GradeSubmissionResponse(BaseModel):
    success: bool
    message: str
    member_id: str

# ---------------------------------------------------------
# Assignments Overview Schemas
# ---------------------------------------------------------
class AssignmentItem(BaseModel):
    ass_id: Optional[str] = None
    title: str
    url: str
    time_remaining: Optional[str] = None
    edit_until: Optional[str] = None
    requirement: Optional[str] = None
    status: Optional[str] = None
    properties: Dict[str, str] = Field(default_factory=dict)

class ExerciseOverviewResponse(BaseModel):
    exercise_ref_id: str
    title: str
    breadcrumbs: List[BreadcrumbItem] = Field(default_factory=list)
    submissions_and_grades_url: Optional[str] = None
    assignments: List[AssignmentItem] = Field(default_factory=list)
    fetched_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

# ---------------------------------------------------------
# Uni Bern Semester Screen Schemas
# ---------------------------------------------------------
class SemesterItem(BaseModel):
    id: str  # e.g. HS2026
    name: str
    is_active: bool = False
    url: str

class SemesterScreenResponse(BaseModel):
    active_semester: Optional[str] = None
    available_semesters: List[SemesterItem] = Field(default_factory=list)
    courses: List[CourseItem] = Field(default_factory=list)
    grouped_by_category: Dict[str, List[CourseItem]] = Field(default_factory=dict)
    fetched_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

# ---------------------------------------------------------
# AI Protocol & Debug Schemas
# ---------------------------------------------------------
class FailedDumpSummary(BaseModel):
    filename: str
    context: str
    created_at: str
    size_bytes: int
    file_path: str

class FailedDumpDetail(BaseModel):
    filename: str
    context: str
    created_at: str
    html_content: str
