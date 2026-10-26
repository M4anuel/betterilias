import os
from unittest.mock import AsyncMock, MagicMock
import pytest

from backend.scrapers.feedback_files import parse_feedback_files
from backend.scrapers.submissions import parse_native_file_upload_form, parse_exercise_submissions
from backend.services.ilias_client import IliasClient

FIXTURE_DIR = os.path.join(os.path.dirname(__file__), "fixtures", "evaluation_by_file")


def read_fixture(name: str) -> str:
    path = os.path.join(FIXTURE_DIR, name)
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        return f.read()


def test_parse_feedback_files_with_uploaded_file():
    html = read_fixture("uploaded_now_remove.html")
    res = parse_feedback_files(html, base_url="https://ilias.unibe.ch")

    assert res.member_id == "3216297"
    assert res.student_name is not None and "Flückiger" in res.student_name
    assert len(res.files) == 1

    file = res.files[0]
    assert file.id == "37646162663135642d333936302d343466342d623239632d323632656665646633613661"
    assert file.title == "downloadfile.pdf"
    assert "24.87 KB" in file.size
    assert file.file_type.lower() == "application/pdf"
    assert file.download_url is not None
    assert "cmd=download" in file.download_url
    assert file.remove_url is not None
    assert "cmd=remove" in file.remove_url


def test_parse_feedback_files_empty():
    html = read_fixture("upload_1.html")
    res = parse_feedback_files(html, base_url="https://ilias.unibe.ch")

    assert res.member_id == "3216297"
    assert res.student_name is not None and "Flückiger" in res.student_name
    assert res.files == []
    assert res.upload_url is not None
    assert "cmd=postUpload" in res.upload_url


def test_parse_native_file_upload_form_for_feedback():
    html = read_fixture("upload_1.html")
    form = parse_native_file_upload_form(html, "https://ilias.unibe.ch/ilias.php", command="postUpload")

    assert form.disabled is False
    assert form.upload_url is not None
    assert "cmd=upload" in form.upload_url
    assert form.form_action is not None
    assert "cmd=postUpload" in form.form_action
    assert form.file_field == "file[0]"
    assert form.file_identifier == "resource_id"
    assert form.token_input_name == "form/input_0[input_0][]"


def test_parse_exercise_submissions_includes_evaluation_by_file_url():
    html = read_fixture("submissions_and_grades_view.html")
    res = parse_exercise_submissions(html, "3803739")

    # Manuel Flückiger should be in the list
    manuel = next((s for s in res.submissions if s.member_id == "3216297"), None)
    assert manuel is not None
    assert "Flückiger" in manuel.student_name
    assert manuel.evaluation_by_file_url is not None
    assert "ilResourceCollectionGUI" in manuel.evaluation_by_file_url
    assert "member_id=3216297" in manuel.evaluation_by_file_url


@pytest.mark.asyncio
async def test_upload_submission_feedback_file_flow():
    client = IliasClient()
    client.is_authenticated = True

    page_html = read_fixture("upload_1.html")
    uploaded_html = read_fixture("uploaded_now_remove.html")

    mock_http = AsyncMock()

    # Step 0: GET page
    page_resp = MagicMock()
    page_resp.text = page_html
    page_resp.url = "https://ilias.unibe.ch/ilias.php?ref_id=3803739&cmdClass=ilResourceCollectionGUI"
    page_resp.status_code = 200

    # Step 1: POST file to Dropzone
    dropzone_resp = MagicMock()
    dropzone_resp.status_code = 200
    dropzone_resp.text = '{"status": 1, "resource_id": "37646162663135642d333936302d343466342d623239632d323632656665646633613661"}'
    dropzone_resp.json.return_value = {
        "status": 1,
        "resource_id": "37646162663135642d333936302d343466342d623239632d323632656665646633613661",
    }

    # Step 2: POST form action
    post_resp = MagicMock()
    post_resp.text = uploaded_html
    post_resp.url = "https://ilias.unibe.ch/ilias.php?ref_id=3803739&cmd=postUpload"
    post_resp.status_code = 200

    mock_http.get.return_value = page_resp
    mock_http.post.side_effect = [dropzone_resp, post_resp]

    result = await client.upload_submission_feedback_file(
        exercise_ref_id="3803739",
        member_id="3216297",
        filename="downloadfile.pdf",
        file_bytes=b"test-pdf-bytes",
        content_type="application/pdf",
        ass_id="53188",
        http_client=mock_http,
    )

    assert len(result.files) == 1
    assert result.files[0].title == "downloadfile.pdf"
    assert mock_http.post.call_count == 2


@pytest.mark.asyncio
async def test_delete_submission_feedback_file_flow():
    client = IliasClient()
    client.is_authenticated = True

    uploaded_html = read_fixture("uploaded_now_remove.html")
    empty_html = read_fixture("upload_1.html")

    mock_http = AsyncMock()

    delete_resp = MagicMock()
    delete_resp.status_code = 200
    delete_resp.text = empty_html
    delete_resp.url = "https://ilias.unibe.ch/ilias.php?cmd=remove"

    refreshed_resp = MagicMock()
    refreshed_resp.status_code = 200
    refreshed_resp.text = empty_html
    refreshed_resp.url = "https://ilias.unibe.ch/ilias.php?cmdClass=ilResourceCollectionGUI"

    mock_http.post.return_value = delete_resp
    mock_http.get.return_value = refreshed_resp

    result = await client.delete_submission_feedback_file(
        exercise_ref_id="3803739",
        member_id="3216297",
        file_id="37646162663135642d333936302d343466342d623239632d323632656665646633613661",
        ass_id="53188",
        http_client=mock_http,
    )

    assert result.files == []
    mock_http.post.assert_called_once()
    assert "cmd=remove" in mock_http.post.call_args[0][0]
    assert mock_http.post.call_args[1]["data"]["interruptive_items[]"] == "37646162663135642d333936302d343466342d623239632d323632656665646633613661"



def test_feedback_files_url_resolution():
    client = IliasClient()
    # Case 1: default base node "dc:o5"
    url1 = client._get_feedback_files_url("3803739", "3216297", "53188")
    assert "cmdNode=dc:o5:dd:z6" in url1
    assert "cmdNode=dc:o5:o5" not in url1

    # Case 2: cached base node ending with :dd
    client._exercise_cmd_nodes["3803739"] = "dc:o5:dd"
    url2 = client._get_feedback_files_url("3803739", "3216297", "53188")
    assert "cmdNode=dc:o5:dd:z6" in url2
    assert "dd:dd" not in url2

    # Case 3: custom_url supplied
    custom = "https://ilias.unibe.ch/ilias.php?baseClass=ilexercisehandlergui&cmdNode=custom:node&cmdClass=ilResourceCollectionGUI"
    url3 = client._get_feedback_files_url("3803739", "3216297", "53188", custom_url=custom)
    assert url3 == custom
