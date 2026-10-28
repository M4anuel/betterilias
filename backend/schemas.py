from datetime import datetime, timezone
from typing import Dict, List, Optional, Any, Literal
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
    session_id: Optional[str] = None

class ManualCookiesInput(BaseModel):
    phpsessid: str = Field(..., description="Value of PHPSESSID cookie")
    il_client_id: Optional[str] = Field("ilias3_unibe", description="Value of ilClientId cookie")
    additional_cookies: Optional[Dict[str, str]] = Field(default_factory=dict)
    session_id: Optional[str] = Field(None, description="Existing session ID to update, or None to create new")

class ExtensionSyncInput(BaseModel):
    cookies: Dict[str, str] = Field(..., description="Cookies dictionary from ILIAS")
    session_id: Optional[str] = Field(None, description="Existing session ID to refresh or update")
    source: Optional[str] = Field("chrome_extension", description="Sync source identifier")
    user_agent: Optional[str] = Field(None, description="Browser User-Agent header from extension client")

class ExtensionSyncResponse(BaseModel):
    success: bool
    authenticated: bool
    session_id: str
    user_name: Optional[str] = None
    message: str


class MobileSessionResponse(BaseModel):
    session_id: str

# ---------------------------------------------------------
# Dashboard & Course Schemas
# ---------------------------------------------------------
class CourseItem(BaseModel):
    ref_id: str
    title: str
    description: Optional[str] = None
    url: str = ""
    item_type: str = "crs"  # crs (course), grp (group), fold (folder), etc.
    icon: Optional[str] = None
    semester: Optional[str] = None
    subject: Optional[str] = None
    faculty: Optional[str] = None

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
    image_url: Optional[str] = None

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
    expand_id: Optional[str] = None
    materials_count: Optional[int] = None

class CourseContentBlock(BaseModel):
    id: str
    block_type: str  # 'heading' | 'drawer' | 'items' | 'text' | 'sessions' | 'all_files' | 'columns' | 'column'
    presentation: Optional[str] = None  # 'tiles' | 'list'
    title: Optional[str] = None
    # Only generated headings have a translation key. ILIAS titles stay untouched.
    title_key: Optional[str] = None
    title_values: Dict[str, Any] = Field(default_factory=dict)

    items: List[MaterialItem] = Field(default_factory=list)
    html_content: Optional[str] = None
    plain_text: Optional[str] = None
    level: Optional[int] = 3
    child_blocks: List['CourseContentBlock'] = Field(default_factory=list)
    sessions: List[CourseSessionItem] = Field(default_factory=list)
    columns: Optional[int] = None

class CourseLogsResponse(BaseModel):
    course_id: str
    logs: List[CourseLogItem] = Field(default_factory=list)
    total_pages: int = 1
    current_page: int = 1
    fetched_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class CourseMembership(BaseModel):
    is_enrolled: Optional[bool] = None
    can_join: bool = False
    can_leave: bool = False


class MembershipField(BaseModel):
    name: str
    label: str
    field_type: Literal['text', 'password', 'checkbox'] = 'text'
    required: bool = False
    value: str = ''


class MembershipFormResponse(BaseModel):
    action: Literal['join', 'leave']
    available: bool
    message: str
    fields: List[MembershipField] = Field(default_factory=list)
    ilias_url: str


class MembershipRequest(BaseModel):
    action: Literal['join', 'leave']
    values: Dict[str, str] = Field(default_factory=dict)


class MembershipResult(BaseModel):
    success: bool
    is_enrolled: Optional[bool] = None
    message: str


class AuthoringContext(BaseModel):
    ref_id: str
    can_create: bool = False
    can_manage: bool = False
    can_edit_page: bool = False
    creatable_types: List[str] = Field(default_factory=list)
    creation_urls: Dict[str, str] = Field(default_factory=dict, exclude=True)
    manage_url: Optional[str] = Field(default=None, exclude=True)
    sorting_url: Optional[str] = Field(default=None, exclude=True)
    page_editor_url: Optional[str] = Field(default=None, exclude=True)
    content_url: Optional[str] = Field(default=None, exclude=True)


class ManagedMaterial(MaterialItem):
    can_delete: bool = False


class ManagementResponse(BaseModel):
    ref_id: str
    authoring: AuthoringContext
    items: List[ManagedMaterial] = Field(default_factory=list)
    can_sort: bool = False
    order: List[str] = Field(default_factory=list)
    order_revision: str = ''
    editor_url: Optional[str] = None


class ManageSelection(BaseModel):
    item_ids: List[str] = Field(min_length=1, max_length=100)


class DeleteReviewItem(BaseModel):
    ref_id: str
    title: str
    item_type: str
    children: List['DeleteReviewItem'] = Field(default_factory=list)


class DeleteReview(BaseModel):
    items: List[DeleteReviewItem]
    revision: str
    descendants: int


class DeleteMaterialsRequest(ManageSelection):
    revision: str = Field(min_length=64, max_length=64)


class SaveMaterialOrderRequest(BaseModel):
    item_ids: List[str] = Field(min_length=1, max_length=500)
    revision: str = Field(min_length=64, max_length=64)


class CreateFolderRequest(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(default='', max_length=4000)
    template_id: Optional[str] = None


class AuthoringResult(BaseModel):
    success: bool = True
    items: List[MaterialItem] = Field(default_factory=list)


class CourseMaterialsResponse(BaseModel):
    container_ref_id: str
    authoring: Optional[AuthoringContext] = None
    title: Optional[str] = None
    is_enrolled: Optional[bool] = None
    membership: Optional[CourseMembership] = None
    breadcrumbs: List[BreadcrumbItem] = Field(default_factory=list)
    items: List[MaterialItem] = Field(default_factory=list)
    sections: List[CourseSection] = Field(default_factory=list)
    rich_text_blocks: List[RichTextBlock] = Field(default_factory=list)
    sessions: List[CourseSessionItem] = Field(default_factory=list)
    columns: Optional[int] = None
    logs: List[CourseLogItem] = Field(default_factory=list)
    blocks: List[CourseContentBlock] = Field(default_factory=list)
    layout_hash: Optional[str] = None
    fetched_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class RepositoryItem(MaterialItem):
    accessible: bool = True
    membership: Optional[CourseMembership] = None


class RepositoryResponse(BaseModel):
    container_ref_id: str
    title: str
    breadcrumbs: List[BreadcrumbItem] = Field(default_factory=list)
    items: List[RepositoryItem] = Field(default_factory=list)

# ---------------------------------------------------------
# Exercises & Submissions Schemas
# ---------------------------------------------------------
class SubmissionFile(BaseModel):
    filename: str
    download_url: str
    upload_time: Optional[str] = None
    file_size: Optional[str] = None
    delivered_id: Optional[str] = None

class SubmissionItem(BaseModel):
    member_id: str  # participant/user ID or submission ID
    student_name: str
    team_members: List[str] = Field(default_factory=list)
    login: Optional[str] = None
    team_name: Optional[str] = None
    team_id: Optional[str] = None
    submission_status: str  # submitted, not_submitted, late, etc.
    submission_time: Optional[str] = None
    graded_on: Optional[str] = None
    evaluation_on: Optional[str] = None
    sent_on: Optional[str] = None
    individual_deadline: Optional[str] = None
    files: List[SubmissionFile] = Field(default_factory=list)
    download_url: Optional[str] = None
    mark: Optional[str] = None  # grade/points (e.g. 5.5 or 10/10)
    passed_status: Optional[str] = None  # passed, failed, not_graded
    feedback: Optional[str] = None
    notice: Optional[str] = None
    feedback_mail_url: Optional[str] = None
    feedback_recipient_surname: Optional[str] = None
    team_log_url: Optional[str] = None
    evaluation_by_file_url: Optional[str] = None
    can_grade: bool = True
    hidden_form_fields: Optional[Dict[str, str]] = None
    additional_columns: Dict[str, str] = Field(default_factory=dict)

class ExerciseInfo(BaseModel):
    ref_id: str
    title: str
    instructions: Optional[str] = None
    deadline: Optional[str] = None
    total_participants: int = 0
    submitted_count: int = 0
    graded_count: int = 0

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
    is_ongoing: bool = False
    is_ended: bool = False
    create_team_url: Optional[str] = None
    ass_type: Optional[str] = None
    is_selected: bool = False
    properties: Dict[str, str] = Field(default_factory=dict)

class ExerciseSubmissionsResponse(BaseModel):
    exercise: ExerciseInfo
    available_assignments: List[AssignmentItem] = Field(default_factory=list)
    active_assignment_id: Optional[str] = None
    submissions: List[SubmissionItem]
    form_action_url: Optional[str] = None
    rtoken: Optional[str] = None
    fetched_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class GradeSubmissionRequest(BaseModel):
    member_id: str
    ass_id: Optional[str] = None
    status: Optional[str] = Field(None, description="e.g. 'passed', 'failed', 'not_graded'")
    mark: Optional[str] = Field(None, description="Grade or points (e.g. '6.0' or '10')")
    feedback: Optional[str] = Field(None, description="TA Feedback text visible to student")
    notice: Optional[str] = Field(None, description="Internal notice/notes for tutors")
    rtoken: Optional[str] = None

class GradeSubmissionResponse(BaseModel):
    success: bool
    message: str
    member_id: str
    status: Optional[str] = None
    feedback: Optional[str] = None


class TeamMemberInfo(BaseModel):
    user_id: Optional[str] = None
    login: str
    name: Optional[str] = None
    is_self: bool = False


class CourseUserCandidate(BaseModel):
    user_id: str
    login: str
    firstname: str = ""
    lastname: str = ""
    full_name: str = ""
    in_team: bool = False
    is_self: bool = False


class TeamCandidatesResponse(BaseModel):
    exercise_ref_id: str
    ass_id: str
    current_user_id: Optional[str] = None
    team_members: List[TeamMemberInfo] = Field(default_factory=list)
    candidates: List[CourseUserCandidate] = Field(default_factory=list)
    fetched_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class AddTeamMembersRequest(BaseModel):
    user_ids: List[str] = Field(default_factory=list)
    user_logins: List[str] = Field(default_factory=list)


class RemoveTeamMembersRequest(BaseModel):
    member_ids: List[str] = Field(default_factory=list)


class StudentAssignmentDetail(BaseModel):
    exercise_ref_id: str
    ass_id: str
    title: str
    instructions: Optional[str] = None
    is_team_upload: bool = False
    start_time: Optional[str] = None
    ended_on: Optional[str] = None
    time_remaining: Optional[str] = None
    is_ended: bool = False
    exercise_files: List[SubmissionFile] = Field(default_factory=list)
    team_members: List[str] = Field(default_factory=list)
    team_member_details: List[TeamMemberInfo] = Field(default_factory=list)
    team_status_text: Optional[str] = None
    create_team_url: Optional[str] = None
    manage_team_url: Optional[str] = None
    delete_team_url: Optional[str] = None
    upload_form_url: Optional[str] = None
    submission_screen_url: Optional[str] = None
    submitted_files: List[SubmissionFile] = Field(default_factory=list)
    last_submission: Optional[str] = None
    submission_status: str = "not_submitted"
    evaluation_statement: Optional[str] = None
    passed_status: Optional[str] = None
    mark: Optional[str] = None
    fetched_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class ExerciseOverviewResponse(BaseModel):
    exercise_ref_id: str
    title: str
    breadcrumbs: List[BreadcrumbItem] = Field(default_factory=list)
    submissions_and_grades_url: Optional[str] = None
    edit_assignments_url: Optional[str] = None
    has_ta_access: bool = False
    active_mode: str = "all"
    assignments: List[AssignmentItem] = Field(default_factory=list)
    fetched_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

# ---------------------------------------------------------
# TA Exercise Management Schemas
# ---------------------------------------------------------
class TAAssignmentListItem(BaseModel):
    ass_id: str
    title: str
    order_val: int = 0
    type_name: str = "File"
    type_id: int = 1
    start_time: Optional[str] = None
    deadline: Optional[str] = None
    mandatory: bool = True
    instruction_files_count: int = 0
    has_work_instructions: bool = False
    edit_url: Optional[str] = None

class TAAssignmentListResponse(BaseModel):
    exercise_ref_id: str
    assignments: List[TAAssignmentListItem] = Field(default_factory=list)
    form_action_url: Optional[str] = None
    rtoken: Optional[str] = None
    add_action_url: Optional[str] = None
    add_submit_command: Optional[str] = None
    available_types: Dict[int, str] = Field(default_factory=dict)
    fetched_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class AssignmentOrderUpdateRequest(BaseModel):
    orders: Dict[str, int]

class TAInstructionFileItem(BaseModel):
    file_id: str
    filename: str
    file_size: Optional[str] = None
    download_url: Optional[str] = None

class TAAssignmentDetailResponse(BaseModel):
    ass_id: Optional[str] = None
    exercise_ref_id: str
    title: str = ""
    type_id: int = 1
    type_name: str = "File"
    mandatory: bool = True
    instruction_html: str = ""
    start_time: Optional[str] = None
    deadline_mode: int = 0  # 0: fixed date, -1: no deadline
    deadline: Optional[str] = None
    has_grace_period: bool = False
    deadline2: Optional[str] = None
    max_file_enabled: bool = False
    max_file: Optional[int] = None
    instruction_files: List[TAInstructionFileItem] = Field(default_factory=list)
    form_action: Optional[str] = None
    rtoken: Optional[str] = None
    hidden_inputs: Dict[str, str] = Field(default_factory=dict)
    form_values: Dict[str, str] = Field(default_factory=dict)
    form_fields: List[str] = Field(default_factory=list)
    form_dependencies: Dict[str, Dict[str, str]] = Field(default_factory=dict)
    disabled_fields: List[str] = Field(default_factory=list)
    file_inputs: List[str] = Field(default_factory=list)
    submit_command: Optional[str] = None
    available_types: Dict[int, str] = Field(default_factory=dict)
    existing_assignment_ids: List[str] = Field(default_factory=list)
    fetched_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class SaveTAAssignmentRequest(BaseModel):
    ass_id: Optional[str] = None
    title: str
    type_id: int = 1
    mandatory: bool = True
    instruction_html: str = ""
    start_time: Optional[str] = None
    deadline_mode: int = 0
    deadline: Optional[str] = None
    has_grace_period: bool = False
    deadline2: Optional[str] = None
    max_file_enabled: bool = False
    max_file: Optional[int] = None

class ExerciseInfoSection(BaseModel):
    title: str
    properties: Dict[str, str] = Field(default_factory=dict)

class ExerciseInfoResponse(BaseModel):
    ref_id: str
    title: str
    sections: List[ExerciseInfoSection] = Field(default_factory=list)
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

# ---------------------------------------------------------
# Feedback / Evaluation File Schemas
# ---------------------------------------------------------
class FeedbackFileItem(BaseModel):
    id: str
    title: str
    size: Optional[str] = None
    created_on: Optional[str] = None
    file_type: Optional[str] = None
    download_url: Optional[str] = None
    remove_url: Optional[str] = None

class FeedbackFilesResponse(BaseModel):
    member_id: str
    student_name: Optional[str] = None
    files: List[FeedbackFileItem] = Field(default_factory=list)
    upload_url: Optional[str] = None

class PdfInfoResponse(BaseModel):
    width: Optional[float] = None
    height: Optional[float] = None
    aspect_ratio: float = 2.16
    pages: int = 1


# ---------------------------------------------------------
# Semester Calendar & Timetable Schemas
# ---------------------------------------------------------
CourseCalendarFeedStatus = Literal[
    "imported_with_lectures",
    "imported_deadlines_only",
    "valid_empty",
    "unavailable",
    "failed",
    "session_expired",
    "not_imported",
]

CalendarEventSource = Literal[
    "ilias_ical",
    "ilias_session",
    "ilias_calendar_block",
    "custom_rule",
]

CalendarEventKind = Literal[
    "lecture",
    "deadline",
    "appointment",
]


class CalendarEvent(BaseModel):
    uid: str
    course_ref_id: str
    course_title: str
    title: str
    description: Optional[str] = None
    location: Optional[str] = None
    date: str  # YYYY-MM-DD in Europe/Zurich
    end_date: Optional[str] = None  # YYYY-MM-DD in Europe/Zurich
    start_time: Optional[str] = None  # HH:MM in Europe/Zurich (None if all_day)
    end_time: Optional[str] = None  # HH:MM in Europe/Zurich (None if all_day)
    start_iso: str
    end_iso: str
    all_day: bool = False
    source: CalendarEventSource
    kind: CalendarEventKind = "lecture"
    rule_id: Optional[str] = None
    cancelled: bool = False


class CourseScheduleRuleInput(BaseModel):
    course_ref_id: str
    course_title: Optional[str] = None
    semester: str
    title: Optional[str] = None
    location: Optional[str] = None
    weekdays: List[int] = Field(..., description="0=Mon, 1=Tue, 2=Wed, 3=Thu, 4=Fri, 5=Sat, 6=Sun")
    start_time: str = Field(..., description="HH:MM in Europe/Zurich")
    end_time: str = Field(..., description="HH:MM in Europe/Zurich")
    start_date: str = Field(..., description="YYYY-MM-DD")
    end_date: str = Field(..., description="YYYY-MM-DD")
    exceptions: List[str] = Field(default_factory=list, description="Skipped YYYY-MM-DD dates")
    enabled: bool = True


class CourseScheduleRule(CourseScheduleRuleInput):
    id: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class CourseCalendarInfo(BaseModel):
    course_ref_id: str
    course_title: str
    semester: Optional[str] = None
    color: str
    status: CourseCalendarFeedStatus = "not_imported"
    status_message: str = ""
    needs_manual_schedule: bool = True
    has_calendar_block: bool = False
    ical_modal_url: Optional[str] = None
    ical_feed_url: Optional[str] = None
    open_calendar_url: Optional[str] = None
    imported_event_count: int = 0
    imported_lecture_count: int = 0
    imported_deadline_count: int = 0
    custom_rule_count: int = 0
    last_imported_at: Optional[datetime] = None


class SemesterCalendarResponse(BaseModel):
    semester: str
    semester_start_date: str
    semester_end_date: str
    semester_mid_date: str
    timezone: str = "Europe/Zurich"
    courses: List[CourseCalendarInfo] = Field(default_factory=list)
    rules: List[CourseScheduleRule] = Field(default_factory=list)
    events: List[CalendarEvent] = Field(default_factory=list)
    subscription_token: Optional[str] = None
    subscription_url: Optional[str] = None
    webcal_url: Optional[str] = None
    is_local_host: bool = True
    fetched_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class CalendarCourseImportRequest(BaseModel):
    semester: str
    courses: List[CourseItem] = Field(default_factory=list)
    force_refresh: bool = False


class CourseColorUpdateRequest(BaseModel):
    course_ref_id: Optional[str] = None
    color: str


class CalendarIcsImportRequest(BaseModel):
    course_ref_id: str
    course_title: Optional[str] = None
    semester: Optional[str] = None
    ics_content: Optional[str] = None
    ics_text: Optional[str] = None


class CalendarSubscriptionResponse(BaseModel):
    token: str
    subscription_url: str
    webcal_url: str
    download_url: str
    is_local_host: bool = True
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
