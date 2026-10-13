from unittest.mock import AsyncMock, patch
import pytest
from fastapi.testclient import TestClient

from backend.main import app
from backend.schemas import (
    CourseItem,
    CourseMaterialsResponse,
    DashboardResponse,
    ExerciseInfo,
    ExerciseSubmissionsResponse,
    GradeSubmissionResponse,
    MaterialItem,
    SubmissionItem,
    StudentAssignmentDetail,
)
from backend.services.ilias_client import SessionExpiredError

client = TestClient(app)


def test_health_check():
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"


def test_auth_status_endpoint():
    with patch("backend.services.ilias_client.session_manager.has_cookies", return_value=False):
        response = client.get("/api/auth/status")
        assert response.status_code == 200
        data = response.json()
        assert data["authenticated"] is False


def test_manual_cookies_endpoint(tmp_path, monkeypatch):
    from backend.config import settings
    monkeypatch.setattr(settings, "session_cookie_file", str(tmp_path / "cookies.json"))

    payload = {
        "phpsessid": "mock_php_sess_12345",
        "il_client_id": "ilias3_unibe"
    }
    response = client.post("/api/auth/cookies", json=payload)
    assert response.status_code == 200
    assert response.json()["success"] is True


def test_logout_endpoint(tmp_path, monkeypatch):
    from backend.config import settings
    test_cookie_file = tmp_path / "cookies.json"
    test_cookie_file.write_text("{}", encoding="utf-8")
    monkeypatch.setattr(settings, "session_cookie_file", str(test_cookie_file))

    response = client.post("/api/auth/logout")
    assert response.status_code == 200
    assert not test_cookie_file.exists()


def test_login_browser_endpoint_success():
    with patch(
        "backend.api.routes.auth.run_browser_login",
        new_callable=AsyncMock,
        return_value=(True, {"PHPSESSID": "dummy_sess"}, "Login successful")
    ):
        response = client.post("/api/auth/login-browser")
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert "PHPSESSID" in data["cookies_captured"]


def test_login_browser_endpoint_failure():
    with patch(
        "backend.api.routes.auth.run_browser_login",
        new_callable=AsyncMock,
        return_value=(False, {}, "Authentication timed out")
    ):
        response = client.post("/api/auth/login-browser")
        assert response.status_code == 400
        assert "Authentication timed out" in response.json()["detail"]


def test_dashboard_endpoint_authorized():
    mock_courses = [
        CourseItem(
            ref_id="101",
            title="Informatik I",
            url="https://ilias.unibe.ch/crs/101",
            item_type="crs"
        )
    ]
    with patch(
        "backend.api.routes.dashboard.IliasClient.get_dashboard",
        new_callable=AsyncMock,
        return_value=DashboardResponse(courses=mock_courses)
    ):
        response = client.get("/api/dashboard/courses")
        assert response.status_code == 200
        data = response.json()
        assert len(data["courses"]) == 1
        assert data["courses"][0]["title"] == "Informatik I"


def test_dashboard_endpoint_session_expired():
    with patch(
        "backend.api.routes.dashboard.IliasClient.get_dashboard",
        new_callable=AsyncMock,
        side_effect=SessionExpiredError("Session timed out")
    ):
        response = client.get("/api/dashboard/courses")
        assert response.status_code == 401
        data = response.json()
        assert data["code"] == "SESSION_EXPIRED"


def test_course_materials_endpoint():
    mock_res = CourseMaterialsResponse(
        container_ref_id="101",
        title="Informatik I",
        breadcrumbs=[],
        items=[
            MaterialItem(
                ref_id="202",
                title="Lecture Slides 1.pdf",
                item_type="file",
                url="https://ilias.unibe.ch/file/202",
            )
        ]
    )
    with patch(
        "backend.api.routes.materials.IliasClient.get_course_materials",
        new_callable=AsyncMock,
        return_value=mock_res
    ):
        response = client.get("/api/courses/101/materials")
        assert response.status_code == 200
        data = response.json()
        assert data["title"] == "Informatik I"
        assert len(data["items"]) == 1


def test_exercise_submissions_and_grade_endpoint():
    mock_sub_res = ExerciseSubmissionsResponse(
        exercise=ExerciseInfo(
            ref_id="501",
            title="Assignment 1",
            total_participants=1,
            submitted_count=1,
            graded_count=0
        ),
        submissions=[
            SubmissionItem(
                member_id="999",
                student_name="Test Student",
                submission_status="submitted",
                files=[]
            )
        ]
    )
    with patch(
        "backend.api.routes.exercises.IliasClient.get_exercise_submissions",
        new_callable=AsyncMock,
        return_value=mock_sub_res
    ):
        response = client.get("/api/exercises/501/submissions")
        assert response.status_code == 200
        data = response.json()
        assert data["exercise"]["title"] == "Assignment 1"
        assert len(data["submissions"]) == 1

    # Grade submission
    mock_grade_res = GradeSubmissionResponse(
        success=True,
        message="Grade saved",
        member_id="999"
    )
    with patch(
        "backend.api.routes.exercises.IliasClient.grade_student_submission",
        new_callable=AsyncMock,
        return_value=mock_grade_res
    ):
        grade_payload = {
            "member_id": "999",
            "status": "passed",
            "mark": "5.5",
            "feedback": "Well done!"
        }
        res_grade = client.post("/api/exercises/501/submissions/999/grade", json=grade_payload)
        assert res_grade.status_code == 200
        assert res_grade.json()["success"] is True


def test_exercise_student_assignment_detail_endpoint():
    from backend.schemas import StudentAssignmentDetail, SubmissionFile

    mock_detail = StudentAssignmentDetail(
        exercise_ref_id="3803739",
        ass_id="53188",
        title="Übung 3: Heuristische Evaluation",
        instructions="Führen Sie die Evaluation durch.",
        start_time="Gestern, 00:00",
        ended_on="13. Okt 2026, 09:00",
        time_remaining="5 Tage, 15 Stunden",
        is_ended=False,
        exercise_files=[
            SubmissionFile(filename="3_Heuristische_Evaluation.pdf", download_url="http://test/file.pdf")
        ],
        team_members=["user1", "user2"],
        submitted_files=[],
        submission_status="not_submitted",
        passed_status="not_graded",
    )
    with patch(
        "backend.api.routes.exercises.IliasClient.get_student_assignment_detail",
        new_callable=AsyncMock,
        return_value=mock_detail,
    ):
        response = client.get("/api/exercises/3803739/assignment/53188")
        assert response.status_code == 200
        data = response.json()
        assert data["title"] == "Übung 3: Heuristische Evaluation"
        assert len(data["exercise_files"]) == 1
        assert data["team_members"] == ["user1", "user2"]



def test_semester_dashboard_endpoint():
    from backend.schemas import SemesterScreenResponse, SemesterItem
    mock_sem_res = SemesterScreenResponse(
        active_semester="HS2022",
        available_semesters=[
            SemesterItem(id="HS2022", name="HS2022", is_active=True, url="http://test/HS2022")
        ],
        courses=[
            CourseItem(ref_id="1001", title="Einführung in die Informatik", url="http://test/1001")
        ],
        grouped_by_category={"Informatik": [
            CourseItem(ref_id="1001", title="Einführung in die Informatik", url="http://test/1001")
        ]}
    )
    with patch(
        "backend.api.routes.dashboard.IliasClient.get_semester_courses",
        new_callable=AsyncMock,
        return_value=mock_sem_res
    ) as mock_get:
        response = client.get("/api/dashboard/semesters?semester=HS2022")
        assert response.status_code == 200
        mock_get.assert_called_once_with(semester="HS2022")
        data = response.json()
        assert data["active_semester"] == "HS2022"
        assert len(data["courses"]) == 1


def test_podcasts_endpoint():
    from backend.schemas import PodcastSeriesResponse, PodcastEpisode
    mock_podcast_res = PodcastSeriesResponse(
        ref_id="3762352",
        title="Mensch-Maschine-Schnittstelle",
        total_episodes=2,
        recorded_count=1,
        scheduled_count=1,
        pages_available=["http://test/page=0", "http://test/page=1"],
        episodes=[
            PodcastEpisode(
                id="ep-1",
                title="Lecture 1: Intro",
                date="30. Sep 2026",
                stream_url="http://test/stream/1",
                status="available",
            ),
            PodcastEpisode(
                id="ep-2",
                title="Lecture 2: Advanced",
                date="07. Oct 2026",
                status="scheduled",
            ),
        ],
    )
    with patch(
        "backend.api.routes.materials.IliasClient.get_podcast_series",
        new_callable=AsyncMock,
        return_value=mock_podcast_res,
    ):
        response = client.get("/api/podcasts/3762352")
        assert response.status_code == 200
        data = response.json()
        assert data["title"] == "Mensch-Maschine-Schnittstelle"
        assert data["recorded_count"] == 1
        assert data["scheduled_count"] == 1
        assert len(data["episodes"]) == 2
        assert data["episodes"][0]["status"] == "available"


def test_course_logs_endpoint():
    from backend.schemas import CourseLogsResponse, CourseLogItem
    mock_logs_res = CourseLogsResponse(
        course_id="3715339",
        logs=[
            CourseLogItem(
                title="One file has been added.",
                target="File: 2_PO-Organisation_2026.pdf",
                date="23. Sep 2026, 08:11",
                log_type="file",
            )
        ],
        total_pages=5,
        current_page=1,
    )
    with patch(
        "backend.api.routes.materials.IliasClient.get_course_logs",
        new_callable=AsyncMock,
        return_value=mock_logs_res,
    ):
        response = client.get("/api/courses/3715339/logs?page=1")
        assert response.status_code == 200
        data = response.json()
        assert data["course_id"] == "3715339"
        assert len(data["logs"]) == 1
        assert data["total_pages"] == 5


def test_delete_student_assignment_submission_file_endpoint():
    mock_detail = StudentAssignmentDetail(
        exercise_ref_id="3803739",
        ass_id="53188",
        title="Übung 1",
        exercise_files=[],
        submitted_files=[],
    )
    with patch(
        "backend.api.routes.exercises.IliasClient.delete_student_assignment_file",
        new_callable=AsyncMock,
        return_value=mock_detail,
    ) as mock_delete:
        response = client.delete("/api/exercises/3803739/assignment/53188/submission/1145505")
        assert response.status_code == 200
        mock_delete.assert_called_once_with(
            exercise_ref_id="3803739", ass_id="53188", delivered_id="1145505"
        )
        data = response.json()
        assert data["ass_id"] == "53188"
        assert len(data["submitted_files"]) == 0


@pytest.mark.asyncio
async def test_ilias_client_delete_student_assignment_file():
    from backend.services.ilias_client import IliasClient
    from unittest.mock import MagicMock

    step1_html = """
    <html>
      <form action="ilias.php?cmd=post" method="post">
        <input type="hidden" name="rtoken" value="abc123token" />
        <input type="checkbox" name="delivered[]" value="1145505" />
      </form>
    </html>
    """
    step2_html = """
    <html>
      <form action="ilias.php?cmd=post&step=2" method="post">
        <input type="hidden" name="rtoken" value="abc123token" />
        <input type="hidden" name="confirmed" value="1" />
      </form>
    </html>
    """
    final_detail = StudentAssignmentDetail(exercise_ref_id="3803739", ass_id="53188", title="Done", exercise_files=[], submitted_files=[])

    ilias_cli = IliasClient()
    ilias_cli.session_manager = MagicMock()
    ilias_cli.session_manager.is_authenticated = True

    mock_http = AsyncMock()
    mock_http.get.return_value = MagicMock(status_code=200, text=step1_html, url="https://ilias.unibe.ch/sub")
    mock_http.post.return_value = MagicMock(status_code=200, text=step2_html, url="https://ilias.unibe.ch/post")

    mock_cm = AsyncMock()
    mock_cm.__aenter__.return_value = mock_http
    mock_cm.__aexit__.return_value = None
    ilias_cli.session_manager.get_http_client.return_value = mock_cm

    with patch.object(ilias_cli, "get_student_assignment_detail", new_callable=AsyncMock, return_value=final_detail):
        res = await ilias_cli.delete_student_assignment_file("3803739", "53188", "1145505")
        assert res.ass_id == "53188"
        assert mock_http.post.call_count == 2


def test_extension_sync_endpoint(tmp_path, monkeypatch):
    from backend.config import settings
    monkeypatch.setattr(settings, "sessions_dir", str(tmp_path / ".sessions"))

    with patch("backend.auth.session.SessionManager.verify_session", new_callable=AsyncMock, return_value=(True, "Test User")):
        payload = {
            "cookies": {"PHPSESSID": "tenant_sess_abc", "ilClientId": "ilias3_unibe"},
            "source": "chrome_extension"
        }
        response = client.post("/api/auth/sync", json=payload)
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["authenticated"] is True
        assert data["user_name"] == "Test User"
        session_id = data["session_id"]
        assert session_id

        # Check that this tenant can check its auth status with X-Session-Id header
        status_res = client.get("/api/auth/status", headers={"X-Session-Id": session_id})
        assert status_res.status_code == 200
        status_data = status_res.json()
        assert status_data["authenticated"] is True
        assert status_data["session_id"] == session_id

        # Check logout for this tenant
        logout_res = client.post("/api/auth/logout", headers={"X-Session-Id": session_id})
        assert logout_res.status_code == 200
        assert logout_res.json()["success"] is True



