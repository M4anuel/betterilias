from typing import Optional
from fastapi import APIRouter, Depends, Query
from backend.api.deps import get_ilias_client
from backend.schemas import DashboardResponse, SemesterScreenResponse
from backend.services.ilias_client import IliasClient

router = APIRouter(prefix="/dashboard", tags=["Dashboard"])


@router.get("/memberships", response_model=DashboardResponse)
async def get_my_courses(client: IliasClient = Depends(get_ilias_client)):
    return await client.get_my_courses()


@router.get("/courses", response_model=DashboardResponse)
async def get_courses(client: IliasClient = Depends(get_ilias_client)):
    """
    Fetch active courses and groups from the user's ILIAS Personal Desktop.
    """
    return await client.get_dashboard()


@router.get("/semesters", response_model=SemesterScreenResponse)
async def get_semester_courses(
    semester: Optional[str] = Query(None, description="Filter by semester code, e.g. HS2026, FS2026"),
    client: IliasClient = Depends(get_ilias_client)
):
    """
    Fetch courses grouped by semester and department using Uni Bern's iliLubModsSemesterGUI plugin.
    """
    return await client.get_semester_courses(semester=semester)

