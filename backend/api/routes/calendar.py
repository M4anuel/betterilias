from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response

from backend.api.deps import get_ilias_client
from backend.schemas import (
    CalendarCourseImportRequest,
    CalendarIcsImportRequest,
    CalendarSubscriptionResponse,
    CourseColorUpdateRequest,
    CourseIgnoreScheduleUpdateRequest,
    CourseScheduleRuleInput,
    SemesterCalendarResponse,
)
from backend.services.calendar_service import calendar_service
from backend.services.ilias_client import IliasClient
from backend.services.semester_utils import get_current_semester

router = APIRouter(prefix="/calendar", tags=["Calendar & Timetable"])


def _resolve_tenant_key(request: Request, client: IliasClient) -> str:
    sid = getattr(client.session_manager, "session_id", None)
    if not sid:
        sid = request.headers.get("X-Session-Id") or request.cookies.get("betterilias_session")
    return calendar_service._sanitize_tenant_key(sid)


def _resolve_base_url(request: Request) -> str:
    return str(request.base_url).rstrip("/")


@router.get("", response_model=SemesterCalendarResponse)
async def get_semester_calendar(
    request: Request,
    semester: Optional[str] = Query(None, description="Optional semester filter, e.g. HS2026 or ALL"),
    client: IliasClient = Depends(get_ilias_client),
):
    tenant_key = _resolve_tenant_key(request, client)
    base_url = _resolve_base_url(request)
    return calendar_service.build_semester_response(
        tenant_key=tenant_key,
        semester=semester,
        base_url=base_url,
    )


@router.post("/sync", response_model=SemesterCalendarResponse)
async def sync_semester_calendar(
    payload: CalendarCourseImportRequest,
    request: Request,
    client: IliasClient = Depends(get_ilias_client),
):
    tenant_key = _resolve_tenant_key(request, client)
    base_url = _resolve_base_url(request)
    return await calendar_service.sync_semester_calendar(
        tenant_key=tenant_key,
        client=client,
        semester=payload.semester,
        courses=payload.courses,
        force_refresh=payload.force_refresh,
        base_url=base_url,
    )


@router.post("/rules", response_model=SemesterCalendarResponse)
async def create_schedule_rule(
    payload: CourseScheduleRuleInput,
    request: Request,
    client: IliasClient = Depends(get_ilias_client),
):
    tenant_key = _resolve_tenant_key(request, client)
    base_url = _resolve_base_url(request)
    try:
        return calendar_service.create_rule(
            tenant_key=tenant_key,
            rule_in=payload,
            base_url=base_url,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.put("/rules/{rule_id}", response_model=SemesterCalendarResponse)
async def update_schedule_rule(
    rule_id: str,
    payload: CourseScheduleRuleInput,
    request: Request,
    client: IliasClient = Depends(get_ilias_client),
):
    tenant_key = _resolve_tenant_key(request, client)
    base_url = _resolve_base_url(request)
    try:
        return calendar_service.update_rule(
            tenant_key=tenant_key,
            rule_id=rule_id,
            rule_in=payload,
            base_url=base_url,
        )
    except KeyError:
        raise HTTPException(status_code=404, detail="Not Found")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/rules/{rule_id}/duplicate", response_model=SemesterCalendarResponse)
async def duplicate_schedule_rule(
    rule_id: str,
    request: Request,
    semester: Optional[str] = Query(None),
    client: IliasClient = Depends(get_ilias_client),
):
    tenant_key = _resolve_tenant_key(request, client)
    base_url = _resolve_base_url(request)
    try:
        return calendar_service.duplicate_rule(
            tenant_key=tenant_key,
            rule_id=rule_id,
            semester=semester,
            base_url=base_url,
        )
    except KeyError:
        raise HTTPException(status_code=404, detail="Not Found")


@router.delete("/rules/{rule_id}", response_model=SemesterCalendarResponse)
async def delete_schedule_rule(
    rule_id: str,
    request: Request,
    semester: Optional[str] = Query(None),
    client: IliasClient = Depends(get_ilias_client),
):
    tenant_key = _resolve_tenant_key(request, client)
    base_url = _resolve_base_url(request)
    try:
        return calendar_service.delete_rule(
            tenant_key=tenant_key,
            rule_id=rule_id,
            semester=semester,
            base_url=base_url,
        )
    except KeyError:
        raise HTTPException(status_code=404, detail="Not Found")


@router.put("/courses/{course_ref_id}/color", response_model=SemesterCalendarResponse)
async def update_course_color(
    course_ref_id: str,
    payload: CourseColorUpdateRequest,
    request: Request,
    semester: Optional[str] = Query(None),
    client: IliasClient = Depends(get_ilias_client),
):
    tenant_key = _resolve_tenant_key(request, client)
    base_url = _resolve_base_url(request)
    try:
        return calendar_service.update_course_color(
            tenant_key=tenant_key,
            course_ref_id=course_ref_id,
            color=payload.color,
            semester=semester,
            base_url=base_url,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.put("/courses/{course_ref_id}/ignore-schedule", response_model=SemesterCalendarResponse)
async def update_course_ignore_schedule(
    course_ref_id: str,
    payload: CourseIgnoreScheduleUpdateRequest,
    request: Request,
    semester: Optional[str] = Query(None),
    client: IliasClient = Depends(get_ilias_client),
):
    tenant_key = _resolve_tenant_key(request, client)
    base_url = _resolve_base_url(request)
    return calendar_service.update_course_ignored_missing_schedule(
        tenant_key=tenant_key,
        course_ref_id=course_ref_id,
        ignored=payload.ignored,
        semester=semester,
        base_url=base_url,
    )


@router.post("/import-ics", response_model=SemesterCalendarResponse)
async def import_course_ics(
    payload: CalendarIcsImportRequest,
    request: Request,
    client: IliasClient = Depends(get_ilias_client),
):
    tenant_key = _resolve_tenant_key(request, client)
    base_url = _resolve_base_url(request)
    return calendar_service.import_raw_ics_for_course(
        tenant_key=tenant_key,
        course_ref_id=payload.course_ref_id,
        ics_content=(payload.ics_content or payload.ics_text or ''),
        course_title=payload.course_title,
        semester=payload.semester,
        base_url=base_url,
    )


@router.get("/export.ics")
async def export_semester_ics(
    request: Request,
    semester: Optional[str] = Query(None),
    course_ids: Optional[str] = Query(None, description="Comma-separated course ref_ids"),
    client: IliasClient = Depends(get_ilias_client),
):
    tenant_key = _resolve_tenant_key(request, client)
    cid_list = [c.strip() for c in course_ids.split(",") if c.strip()] if course_ids else None
    ics_text = calendar_service.export_semester_ics(
        tenant_key=tenant_key,
        semester=semester,
        course_ids=cid_list,
    )
    file_sem = semester or get_current_semester()
    filename = f"betterilias-{file_sem}.ics"
    return Response(
        content=ics_text,
        media_type="text/calendar; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-store",
        },
    )


@router.post("/subscription/rotate", response_model=CalendarSubscriptionResponse)
async def rotate_subscription(
    request: Request,
    semester: Optional[str] = Query(None),
    client: IliasClient = Depends(get_ilias_client),
):
    tenant_key = _resolve_tenant_key(request, client)
    base_url = _resolve_base_url(request)
    return calendar_service.rotate_subscription_token(
        tenant_key=tenant_key,
        semester=semester,
        base_url=base_url,
    )


@router.delete("/subscription")
async def revoke_subscription(
    request: Request,
    client: IliasClient = Depends(get_ilias_client),
):
    tenant_key = _resolve_tenant_key(request, client)
    calendar_service.revoke_subscription_token(tenant_key=tenant_key)
    return {"revoked": True}


@router.get("/feed/{token_part}")
async def get_subscription_feed(
    token_part: str,
    semester: Optional[str] = Query(None),
):
    token = token_part[:-4] if token_part.lower().endswith(".ics") else token_part
    found = calendar_service.get_feed_by_token(token=token, semester_override=semester)
    if not found:
        raise HTTPException(status_code=404, detail="Not Found")
    sem, ics_text = found
    return Response(
        content=ics_text,
        media_type="text/calendar; charset=utf-8",
        headers={
            "Content-Disposition": f'inline; filename="betterilias-{sem}.ics"',
            "Cache-Control": "no-cache, max-age=0",
        },
    )
