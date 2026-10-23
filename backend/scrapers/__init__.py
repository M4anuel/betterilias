from backend.scrapers.dashboard import parse_dashboard
from backend.scrapers.dumper import ScrapingParsingError, dump_failed_html, list_failed_dumps, get_dump_content
from backend.scrapers.forms import (
    extract_grading_form,
    verify_grading_success,
    extract_feedback_modal_form,
    FeedbackModalFormData,
)
from backend.scrapers.logs import parse_course_logs
from backend.scrapers.materials import parse_course_materials
from backend.scrapers.podcasts import parse_podcast_series
from backend.scrapers.semester import parse_semester_courses
from backend.scrapers.submissions import (
    parse_exercise_submissions,
    parse_exercise_overview,
    parse_student_assignment_detail,
    parse_exercise_info,
    parse_student_submitted_files_screen,
    parse_student_upload_form,
    StudentUploadFormInfo,
    parse_team_management_screen,
    ParsedTeamManagementScreen,
    parse_course_users_list_screen,
    ParsedCourseUserListScreen,
    parse_remove_team_confirmation_screen,
    ParsedTeamConfirmRemoveScreen,
)
from backend.scrapers.feedback_files import parse_feedback_files

__all__ = [
    "parse_dashboard",
    "parse_course_logs",
    "parse_course_materials",
    "parse_podcast_series",
    "parse_exercise_submissions",
    "parse_exercise_overview",
    "parse_student_assignment_detail",
    "parse_exercise_info",
    "parse_student_submitted_files_screen",
    "parse_student_upload_form",
    "StudentUploadFormInfo",
    "parse_team_management_screen",
    "ParsedTeamManagementScreen",
    "parse_course_users_list_screen",
    "ParsedCourseUserListScreen",
    "parse_remove_team_confirmation_screen",
    "ParsedTeamConfirmRemoveScreen",
    "parse_feedback_files",
    "parse_semester_courses",
    "extract_grading_form",
    "extract_feedback_modal_form",
    "FeedbackModalFormData",
    "verify_grading_success",
    "ScrapingParsingError",
    "dump_failed_html",
    "list_failed_dumps",
    "get_dump_content",
]

