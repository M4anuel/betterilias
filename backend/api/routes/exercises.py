from fastapi import APIRouter, Depends, HTTPException, status
from backend.api.deps import get_ilias_client
from backend.schemas import (
    ExerciseOverviewResponse,
    ExerciseSubmissionsResponse,
    GradeSubmissionRequest,
    GradeSubmissionResponse,
)
from backend.services.ilias_client import IliasClient

router = APIRouter(prefix="/exercises", tags=["Exercises & Grading"])


@router.get("/{exercise_id}/overview", response_model=ExerciseOverviewResponse)
async def get_overview(
    exercise_id: str,
    client: IliasClient = Depends(get_ilias_client)
):
    """
    Fetch the exercise overview, student assignments, deadlines, and TA grading link.
    """
    return await client.get_exercise_overview(ref_id=exercise_id)


@router.get("/{exercise_id}/submissions", response_model=ExerciseSubmissionsResponse)
async def get_submissions(
    exercise_id: str,
    client: IliasClient = Depends(get_ilias_client)
):
    """
    Fetch the list of student submissions for an exercise (TA grading view).
    """
    return await client.get_exercise_submissions(ref_id=exercise_id)


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

