import asyncio
import io
import zipfile
import pytest
import httpx
from starlette.testclient import TestClient

from backend.main import app
from backend.schemas import SubmissionItem, SubmissionFile
from backend.services.exercise_bulk import create_submissions_zip_bundle


@pytest.mark.asyncio
async def test_create_submissions_zip_bundle_concurrent():
    submissions = [
        SubmissionItem(
            member_id=f"10{i}",
            student_name=f"Student {i}",
            submission_status="submitted",
            files=[
                SubmissionFile(
                    file_id=f"f_{i}",
                    filename=f"solution_{i}.py",
                    download_url=f"http://testserver/file_{i}.py"
                )
            ]
        )
        for i in range(10)
    ]

    async def mock_handler(request: httpx.Request) -> httpx.Response:
        await asyncio.sleep(0.01)
        return httpx.Response(200, content=b"print('hello world')", headers={"Content-Type": "text/plain"})

    transport = httpx.MockTransport(mock_handler)
    async with httpx.AsyncClient(transport=transport) as http_client:
        zip_bytes, is_complete, failed = await create_submissions_zip_bundle(
            assignment_title="Übung 1",
            exercise_ref_id="12345",
            ass_id="67890",
            submissions=submissions,
            http_client=http_client,
        )

    assert is_complete is True
    assert len(failed) == 0

    with zipfile.ZipFile(io.BytesIO(zip_bytes), "r") as zf:
        namelist = zf.namelist()
        assert "betterilias-feedback.json" in namelist
        for i in range(10):
            assert f"submissions/user-10{i}/solution_{i}.py" in namelist
            assert f"feedback/user-10{i}/.keep" in namelist
            assert zf.read(f"submissions/user-10{i}/solution_{i}.py") == b"print('hello world')"


def test_cors_expose_headers():
    client = TestClient(app)
    response = client.get(
        "/api/system/logs",
        headers={"Origin": "http://localhost:5173"}
    )
    exposed = response.headers.get("access-control-expose-headers", "")
    assert "Content-Length" in exposed
    assert "Content-Disposition" in exposed
    assert "X-Session-Id" in exposed
