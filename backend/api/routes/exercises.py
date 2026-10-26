from backend.i18n import t
import logging
import httpx
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status, File, UploadFile, Form

logger = logging.getLogger(__name__)
from backend.api.deps import get_ilias_client
from backend.schemas import (
    AddTeamMembersRequest,
    ExerciseInfoResponse,
    ExerciseOverviewResponse,
    ExerciseSubmissionsResponse,
    GradeSubmissionRequest,
    GradeSubmissionResponse,
    RemoveTeamMembersRequest,
    StudentAssignmentDetail,
    FeedbackFilesResponse,
    TeamCandidatesResponse,
    TAAssignmentDetailResponse,
    TAAssignmentListItem,
    TAAssignmentListResponse,
    TAInstructionFileItem,
    AssignmentOrderUpdateRequest,
    SaveTAAssignmentRequest,
)
from backend.services.ilias_client import IliasClient, StudentUploadError, SessionExpiredError, AssignmentDeletionError
from backend.scrapers.dumper import ScrapingParsingError

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
    include_ilias_order: bool = Query(False, description="Resolve ILIAS surname order from evaluation-by-file recipients"),
    client: IliasClient = Depends(get_ilias_client)
):
    """
    Fetch the list of student submissions for an exercise (TA grading view).
    """
    if include_ilias_order:
        return await client.get_exercise_submissions(ref_id=exercise_id, ass_id=ass_id, include_ilias_order=True)
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
    try:
        return await client.upload_student_assignment_file(
            exercise_ref_id=exercise_id,
            ass_id=ass_id,
            filename=file.filename or "submission_file",
            file_bytes=content,
            content_type=file.content_type or "application/octet-stream",
        )
    except StudentUploadError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc

    except httpx.RequestError as exc:
        raise HTTPException(status_code=502, detail=t('upload.network_error')) from exc


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


@router.post("/{exercise_id}/assignment/{ass_id}/team/create", response_model=StudentAssignmentDetail)
async def create_student_team(
    exercise_id: str,
    ass_id: str,
    client: IliasClient = Depends(get_ilias_client)
):
    """
    Create a student team for an exercise assignment in ILIAS and return the updated assignment details.
    """
    return await client.create_student_team(exercise_ref_id=exercise_id, ass_id=ass_id)


@router.get("/{exercise_id}/assignment/{ass_id}/team/candidates", response_model=TeamCandidatesResponse)
async def get_student_team_candidates(
    exercise_id: str,
    ass_id: str,
    client: IliasClient = Depends(get_ilias_client)
):
    """
    Fetch current team members and the searchable list of course participants for team management.
    """
    return await client.get_team_candidates(exercise_ref_id=exercise_id, ass_id=ass_id)


@router.post("/{exercise_id}/assignment/{ass_id}/team/add", response_model=StudentAssignmentDetail)
async def add_student_team_members(
    exercise_id: str,
    ass_id: str,
    payload: AddTeamMembersRequest,
    client: IliasClient = Depends(get_ilias_client)
):
    """
    Add one or more course participants to the student's team by user_id or user_login.
    """
    return await client.add_student_team_members(
        exercise_ref_id=exercise_id,
        ass_id=ass_id,
        user_ids=payload.user_ids,
        user_logins=payload.user_logins,
    )


@router.post("/{exercise_id}/assignment/{ass_id}/team/remove", response_model=StudentAssignmentDetail)
async def remove_student_team_members(
    exercise_id: str,
    ass_id: str,
    payload: RemoveTeamMembersRequest,
    client: IliasClient = Depends(get_ilias_client)
):
    """
    Remove one or more members from the student's team.
    """
    return await client.remove_student_team_members(
        exercise_ref_id=exercise_id,
        ass_id=ass_id,
        member_ids=payload.member_ids,
    )


@router.delete("/{exercise_id}/assignment/{ass_id}/team", response_model=StudentAssignmentDetail)
async def delete_student_team(
    exercise_id: str,
    ass_id: str,
    client: IliasClient = Depends(get_ilias_client)
):
    """
    Delete the student's entire team. Automatically removes any other team members first
    to satisfy ILIAS's single-member team deletion constraint.
    """
    return await client.delete_student_team(exercise_ref_id=exercise_id, ass_id=ass_id)



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
    feedback_url: Optional[str] = Query(None, description="Direct evaluation by file URL if known"),
    client: IliasClient = Depends(get_ilias_client)
):
    """
    Fetch existing feedback/evaluation files and upload URL for a student submission.
    """
    return await client.get_submission_feedback_files(
        exercise_ref_id=exercise_id,
        member_id=member_id,
        ass_id=ass_id,
        feedback_url=feedback_url,
    )


@router.post("/{exercise_id}/submissions/{member_id}/feedback-files", response_model=FeedbackFilesResponse)
async def upload_feedback_file(
    exercise_id: str,
    member_id: str,
    file: UploadFile = File(...),
    ass_id: Optional[str] = Form(None),
    feedback_url: Optional[str] = Form(None),
    client: IliasClient = Depends(get_ilias_client)
):
    """
    Upload a feedback/evaluation file for a student submission in ILIAS.
    """
    content = await file.read()
    try:
        return await client.upload_submission_feedback_file(
            exercise_ref_id=exercise_id,
            member_id=member_id,
            filename=file.filename or "feedback_file",
            file_bytes=content,
            content_type=file.content_type or "application/octet-stream",
            ass_id=ass_id,
            feedback_url=feedback_url,
        )
    except StudentUploadError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    except httpx.RequestError as exc:
        raise HTTPException(status_code=502, detail=t('upload.network_error')) from exc


@router.delete("/{exercise_id}/submissions/{member_id}/feedback-files/{file_id}", response_model=FeedbackFilesResponse)
async def delete_feedback_file(
    exercise_id: str,
    member_id: str,
    file_id: str,
    ass_id: Optional[str] = Query(None, description="Optional assignment ID"),
    feedback_url: Optional[str] = Query(None, description="Direct evaluation by file URL if known"),
    client: IliasClient = Depends(get_ilias_client)
):
    """
    Delete a feedback/evaluation file from a student submission in ILIAS.
    """
    try:
        return await client.delete_submission_feedback_file(
            exercise_ref_id=exercise_id,
            member_id=member_id,
            file_id=file_id,
            ass_id=ass_id,
            feedback_url=feedback_url,
        )
    except httpx.RequestError as exc:
        raise HTTPException(status_code=502, detail=t('upload.network_error')) from exc



# ---------------------------------------------------------
# TA Exercise Editor Routes
# ---------------------------------------------------------
@router.get("/{exercise_id}/ta/assignments", response_model=TAAssignmentListResponse)
async def get_ta_assignments(
    exercise_id: str,
    client: IliasClient = Depends(get_ilias_client)
):
    """
    Fetch TA assignment list with ordering, dates, submission type, and mandatory status.
    """
    return await client.get_ta_assignments_list(ref_id=exercise_id)


@router.post("/{exercise_id}/ta/assignments/order", response_model=TAAssignmentListResponse)
async def update_ta_assignment_order(
    exercise_id: str,
    req: AssignmentOrderUpdateRequest,
    client: IliasClient = Depends(get_ilias_client)
):
    """
    Update the presentation order for assignments.
    """
    return await client.update_ta_assignment_order(ref_id=exercise_id, orders=req.orders)


@router.get("/{exercise_id}/ta/assignment-detail", response_model=TAAssignmentDetailResponse)
async def get_ta_assignment_detail(
    exercise_id: str,
    ass_id: Optional[str] = Query(None, description="Optional assignment ID. Omit to fetch creation form."),
    type_id: int = Query(1, description="Submission type ID (1=file, 4=team, etc.)"),
    client: IliasClient = Depends(get_ilias_client)
):
    """
    Fetch assignment editor form and attached instruction files.
    """
    return await client.get_ta_assignment_detail(ref_id=exercise_id, ass_id=ass_id, type_id=type_id)


@router.post("/{exercise_id}/ta/assignment-detail", response_model=TAAssignmentDetailResponse)
async def save_ta_assignment(
    exercise_id: str,
    req: SaveTAAssignmentRequest,
    client: IliasClient = Depends(get_ilias_client)
):
    """
    Create or edit an assignment.
    """
    try:
        return await client.save_ta_assignment(ref_id=exercise_id, data=req)
    except (SessionExpiredError, ScrapingParsingError):
        raise
    except ValueError as e:
        logger.error(f"Validation error saving assignment in exercise {exercise_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )
    except Exception as e:
        logger.exception(f"Unexpected error saving assignment in exercise {exercise_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=t('Failed to save assignment: {p0}', p0=str(e)),
        )


@router.delete("/{exercise_id}/ta/assignments/{ass_id}")
async def delete_ta_assignment(
    exercise_id: str,
    ass_id: str,
    client: IliasClient = Depends(get_ilias_client)
):
    """
    Delete an assignment.
    """
    try:
        success = await client.delete_ta_assignment(ref_id=exercise_id, ass_id=ass_id)
    except AssignmentDeletionError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    except httpx.RequestError as exc:
        raise HTTPException(status_code=502, detail=t('delete.network_error')) from exc
    if not success:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=t('Failed to delete assignment on ILIAS.')
        )
    return {"success": True, "ass_id": ass_id}


@router.get("/{exercise_id}/ta/assignments/{ass_id}/instruction-files")
async def get_ta_instruction_files(
    exercise_id: str,
    ass_id: str,
    client: IliasClient = Depends(get_ilias_client)
):
    """
    Fetch instruction files attached to an assignment.
    """
    return await client.get_ta_instruction_files(ref_id=exercise_id, ass_id=ass_id)


@router.post("/{exercise_id}/ta/assignments/{ass_id}/instruction-files")
async def upload_ta_instruction_file(
    exercise_id: str,
    ass_id: str,
    file: UploadFile = File(...),
    client: IliasClient = Depends(get_ilias_client)
):
    """
    Upload an instruction file to an assignment.
    """
    content = await file.read()
    try:
        return await client.upload_instruction_file(
            ref_id=exercise_id,
            ass_id=ass_id,
            filename=file.filename or "instruction_file",
            file_bytes=content,
            content_type=file.content_type or "application/octet-stream",
        )
    except StudentUploadError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


@router.delete("/{exercise_id}/ta/assignments/{ass_id}/instruction-files/{file_id}")
async def delete_ta_instruction_file(
    exercise_id: str,
    ass_id: str,
    file_id: str,
    client: IliasClient = Depends(get_ilias_client)
):
    """
    Delete an instruction file from an assignment.
    """
    success = await client.delete_instruction_file(ref_id=exercise_id, ass_id=ass_id, file_id=file_id)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=t('Failed to delete instruction file.')
        )
    return {"success": True, "file_id": file_id}
