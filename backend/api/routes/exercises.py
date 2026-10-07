from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status, File, UploadFile, Form
from backend.api.deps import get_ilias_client
from backend.schemas import (
    ExerciseInfoResponse,
    ExerciseOverviewResponse,
    ExerciseSubmissionsResponse,
    GradeSubmissionRequest,
    GradeSubmissionResponse,
    StudentAssignmentDetail,
    FeedbackFilesResponse,
)
from backend.services.ilias_client import IliasClient

router = APIRouter(prefix="/exercises", tags=["Exercises & Grading"])


@router.get("/{exercise_id}/overview", response_model=ExerciseOverviewResponse)
async def get_overview(
    exercise_id: str,
    mode: str = Query("all", description="View mode: all, ongoing, future, past"),
    client: IliasClient = Depends(get_ilias_client)
):
    """
    Fetch the exercise overview, student assignments, deadlines, and TA grading link.
    """
    return await client.get_exercise_overview(ref_id=exercise_id, mode=mode)


@router.get("/{exercise_id}/info", response_model=ExerciseInfoResponse)
async def get_exercise_info(
    exercise_id: str,
    client: IliasClient = Depends(get_ilias_client)
):
    """
    Fetch the exercise info screen (summary, mandatory rules, evaluation, metadata).
    """
    return await client.get_exercise_info(ref_id=exercise_id)


@router.get("/{exercise_id}/submissions", response_model=ExerciseSubmissionsResponse)
async def get_submissions(
    exercise_id: str,
    ass_id: Optional[str] = Query(None, description="Optional assignment ID to filter by specific assignment"),
    client: IliasClient = Depends(get_ilias_client)
):
    """
    Fetch the list of student submissions for an exercise (TA grading view).
    """
    return await client.get_exercise_submissions(ref_id=exercise_id, ass_id=ass_id)


@router.get("/{exercise_id}/assignment/{ass_id}", response_model=StudentAssignmentDetail)
async def get_assignment_detail(
    exercise_id: str,
    ass_id: str,
    client: IliasClient = Depends(get_ilias_client)
):
    """
    Fetch the student view for a specific assignment (instructions, materials, team, submission, tutor feedback).
    """
    return await client.get_student_assignment_detail(ref_id=exercise_id, ass_id=ass_id)


@router.post("/{exercise_id}/assignment/{ass_id}/upload", response_model=StudentAssignmentDetail)
async def upload_student_assignment_file(
    exercise_id: str,
    ass_id: str,
    file: UploadFile = File(...),
    client: IliasClient = Depends(get_ilias_client)
):
    """
    Upload a file as student submission for an exercise assignment in ILIAS.
    """
    content = await file.read()
    return await client.upload_student_assignment_file(
        exercise_ref_id=exercise_id,
        ass_id=ass_id,
        filename=file.filename or "submission_file",
        file_bytes=content,
        content_type=file.content_type or "application/octet-stream",
    )


@router.delete("/{exercise_id}/assignment/{ass_id}/submission/{delivered_id}", response_model=StudentAssignmentDetail)
async def delete_assignment_submission_file(
    exercise_id: str,
    ass_id: str,
    delivered_id: str,
    client: IliasClient = Depends(get_ilias_client)
):
    """
    Delete a submitted file for an exercise assignment in ILIAS.
    """
    return await client.delete_student_assignment_file(
        exercise_ref_id=exercise_id,
        ass_id=ass_id,
        delivered_id=delivered_id,
    )



@router.post("/{exercise_id}/submissions/{member_id}/grade", response_model=GradeSubmissionResponse)
async def grade_submission(
    exercise_id: str,
    member_id: str,
    grade_data: GradeSubmissionRequest,
    client: IliasClient = Depends(get_ilias_client)
):
    """
    Phase 3: Submit grade (points/mark, passed status, feedback text) for a student submission.
    Extracts CSRF tokens and hidden fields from the form and executes the POST request.
    """
    if grade_data.member_id != member_id:
        grade_data.member_id = member_id

    result = await client.grade_student_submission(exercise_ref_id=exercise_id, grade_data=grade_data)
    if not result.success:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=result.message
        )
    return result


@router.get("/{exercise_id}/submissions/{member_id}/feedback-files", response_model=FeedbackFilesResponse)
async def get_feedback_files(
    exercise_id: str,
    member_id: str,
    ass_id: Optional[str] = Query(None, description="Optional assignment ID"),
    client: IliasClient = Depends(get_ilias_client)
):
    """
    Fetch existing feedback/evaluation files and upload URL for a student submission.
    """
    return await client.get_submission_feedback_files(exercise_ref_id=exercise_id, member_id=member_id, ass_id=ass_id)


@router.post("/{exercise_id}/submissions/{member_id}/feedback-files", response_model=FeedbackFilesResponse)
async def upload_feedback_file(
    exercise_id: str,
    member_id: str,
    file: UploadFile = File(...),
    ass_id: Optional[str] = Form(None),
    client: IliasClient = Depends(get_ilias_client)
):
    """
    Upload a feedback/evaluation file for a student submission in ILIAS.
    """
    content = await file.read()
    return await client.upload_submission_feedback_file(
        exercise_ref_id=exercise_id,
        member_id=member_id,
        filename=file.filename or "feedback_file",
        file_bytes=content,
        content_type=file.content_type or "application/octet-stream",
        ass_id=ass_id,
    )


