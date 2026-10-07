from pathlib import Path
import pytest

from backend.scrapers.materials import parse_course_materials
from backend.scrapers.semester import parse_semester_courses
from backend.scrapers.submissions import parse_exercise_overview

FIXTURES_UNIBE = Path(__file__).parent / "fixtures" / "unibe"


def test_real_unibe_semester_screen():
    html = (FIXTURES_UNIBE / "unibe_semester_hs2026.html").read_text(encoding="utf-8", errors="replace")
    res = parse_semester_courses(html)

    # Verify active semester detection
    assert res.active_semester == "HS2026"
    assert len(res.available_semesters) >= 5
    assert any(s.id == "HS2026" and s.is_active for s in res.available_semesters)
    assert any(s.id == "FS2026" for s in res.available_semesters)

    # Verify courses extracted
    assert len(res.courses) == 6
    ref_ids = [c.ref_id for c in res.courses]
    assert "3695522" in ref_ids  # Mensch-Maschine-Schnittstelle
    assert "3715339" in ref_ids  # Personal und Organisation
    assert "3744868" in ref_ids  # Finanzielles Rechnungswesen
    assert "3695525" in ref_ids  # Programmieren für Naturwissenschaften
    assert "3695538" in ref_ids  # Software Product Lines
    assert "3684711" in ref_ids  # Graph Theory

    # Verify categories
    assert "Informatik" in res.grouped_by_category
    assert "Betriebwirtschaftslehre" in res.grouped_by_category


def test_real_unibe_mms_course_content():
    html = (FIXTURES_UNIBE / "unibe_mms_course_content.html").read_text(encoding="utf-8", errors="replace")
    res = parse_course_materials(html, container_ref_id="3695522")

    # Verify title & breadcrumbs
    assert "Mensch-Maschine-Schnittstelle" in res.title
    assert len(res.breadcrumbs) >= 4
    # Root repository should be first
    assert res.breadcrumbs[0].title == "Repository"
    assert res.breadcrumbs[-1].ref_id == "3695522"

    # Verify folder contents
    assert len(res.items) >= 7
    item_titles = [it.title for it in res.items]
    assert any("Wichtige Informationen" in t for t in item_titles)
    assert any("Skript zur Vorlesung" in t for t in item_titles)
    assert any("Folien aus dem Unterricht" in t for t in item_titles)
    assert any("Auftr" in t for t in item_titles)  # Aufträge und Abgaben
    assert any("Forum MMS" in t for t in item_titles)

    # Types
    types = {it.title: it.item_type for it in res.items}
    assert any(t == "fold" for t in types.values())
    assert any(t == "file" for t in types.values())


def test_real_unibe_mms_exercise_overview():
    html = (FIXTURES_UNIBE / "unibe_mms_exercise_overview.html").read_text(encoding="utf-8", errors="replace")
    res = parse_exercise_overview(html, exercise_ref_id="3803739")

    # Verify title and TA link
    assert "Übungen" in res.title or "bungen" in res.title
    assert res.submissions_and_grades_url is not None
    assert "ilexercisemanagementgui" in res.submissions_and_grades_url
    assert "cmd=members" in res.submissions_and_grades_url

    # Verify Breadcrumbs
    assert len(res.breadcrumbs) >= 5
    assert res.breadcrumbs[0].title == "Repository"

    # Verify Assignments
    assert len(res.assignments) == 1
    ass = res.assignments[0]
    assert ass.ass_id == "53188"
    assert "Übung 3" in ass.title or "bung 3" in ass.title
    assert "13. Oct 2026" in (ass.edit_until or "")
    assert ass.status == "Not Graded"
    assert ass.time_remaining is not None


def test_real_unibe_po_course_sections_and_accordion():
    html = (FIXTURES_UNIBE / "unibe_po_course_content.html").read_text(encoding="utf-8", errors="replace")
    res = parse_course_materials(html, container_ref_id="3715339")

    # Title
    assert "Personal und Organisation" in res.title

    # Sections (Teil Organisation, Teil Personal, Organisation + Personal)
    assert len(res.sections) == 3
    sec_titles = [s.title for s in res.sections]
    assert any("Organisation" in t for t in sec_titles)
    assert any("Personal" in t for t in sec_titles)

    # Groups & Items
    org_sec = next(s for s in res.sections if "Teil ORganisation" in s.title)
    group_titles = [g.title for g in org_sec.groups]
    assert any("Folien" in g for g in group_titles)
    assert any("Reflexionstexte" in g for g in group_titles)
    assert any("Exercises" in g for g in group_titles)

    # Flat items preserved (sessions are extracted into res.sessions)
    assert len(res.items) >= 14
    assert len(res.sessions) == 7
    assert any("1_PO-Organisation" in it.title for it in res.items)


def test_real_unibe_graph_theory_rich_text_and_math():
    html = (FIXTURES_UNIBE / "unibe_graph_theory_course_content.html").read_text(encoding="utf-8", errors="replace")
    res = parse_course_materials(html, container_ref_id="3684711")

    # Title
    assert "Graph Theory" in res.title

    # Rich Text Blocks
    assert len(res.rich_text_blocks) >= 3
    block_titles = [b.title for b in res.rich_text_blocks if b.title]
    assert any("Suggested" in t for t in block_titles)
    assert any("Grading Policy" in t for t in block_titles)

    # Mathematical MathML Notation in grading policy
    grading_block = next(b for b in res.rich_text_blocks if b.title and "Grading Policy" in b.title)
    assert "<math" in grading_block.html_content
    assert "</math>" in grading_block.html_content

    # Material items
    assert len(res.items) >= 1
    assert any("Lectures slides" in it.title for it in res.items)


def test_real_unibe_course_logs_extraction():
    mms_html = (FIXTURES_UNIBE / "unibe_mms_course_content.html").read_text(encoding="utf-8", errors="replace")
    mms_res = parse_course_materials(mms_html, container_ref_id="3695522")
    assert len(mms_res.logs) == 5
    file_log = next(l for l in mms_res.logs if l.log_type == "file")
    assert "Termin_4.pdf" in (file_log.target or "")
    assert "Yesterday" in (file_log.date or "")
    assert file_log.url is not None

    po_html = (FIXTURES_UNIBE / "unibe_po_course_content.html").read_text(encoding="utf-8", errors="replace")
    po_res = parse_course_materials(po_html, container_ref_id="3715339")
    assert len(po_res.logs) == 5
    po_file_log = next(l for l in po_res.logs if l.log_type == "file")
    assert "2_PO-Organisation" in (po_file_log.target or "")
    assert "Today" in (po_file_log.date or "")


def test_real_unibe_podcasts_parsing():
    from backend.scrapers.podcasts import parse_podcast_series

    # Test PO podcasts (has 7 recorded available episodes)
    po_html = (FIXTURES_UNIBE / "unibe_po_podcasts.html").read_text(encoding="utf-8", errors="replace")
    po_series = parse_podcast_series(po_html, ref_id="3715392")
    assert "Personal und Organisation" in po_series.title
    assert po_series.recorded_count == 7
    assert po_series.total_episodes == 7
    assert all(ep.status == "available" for ep in po_series.episodes)
    assert all(ep.stream_url is not None for ep in po_series.episodes)

    # Test MMS podcasts (multi-page with scheduled episodes and pagination buttons)
    mms_html = (FIXTURES_UNIBE / "unibe_mms_podcasts.html").read_text(encoding="utf-8", errors="replace")
    mms_series = parse_podcast_series(mms_html, ref_id="3762352")
    assert "Mensch-Maschine-Schnittstelle" in mms_series.title
    assert len(mms_series.pages_available) >= 2
    assert any("page=0" in p for p in mms_series.pages_available)
    assert any("page=1" in p for p in mms_series.pages_available)
    assert mms_series.scheduled_count == 10


def test_real_unibe_course_sessions_drawers():
    html = (FIXTURES_UNIBE / "unibe_lernen_gedaechtnis_sessions.html").read_text(encoding="utf-8", errors="replace")
    res = parse_course_materials(html, container_ref_id="3135648")

    # Verify sessions
    assert len(res.sessions) == 13
    s1 = res.sessions[0]
    assert s1.ref_id == "3135670"
    assert s1.date_str == "18. Feb 2025"
    assert s1.time_str == "14:15 - 16:00"
    assert len(s1.materials) == 3
    s1_titles = [m.title for m in s1.materials]
    assert any("Bjork" in t for t in s1_titles)
    assert any("LG1_Intro" in t for t in s1_titles)
    assert any("Meier-2017" in t for t in s1_titles)

    # Session 2
    s2 = res.sessions[1]
    assert s2.ref_id == "3135671"
    assert len(s2.materials) == 1
    assert "LG2_ModalModel" in s2.materials[0].title

    # Empty session
    s3 = res.sessions[2]
    assert len(s3.materials) == 0


def test_real_unibe_show_news_full_logs():
    from backend.scrapers.logs import parse_course_logs

    html = (FIXTURES_UNIBE / "unibe_po_all_logs.html").read_text(encoding="utf-8", errors="replace")
    res = parse_course_logs(html, course_id="3715339")

    assert len(res.logs) == 5
    assert res.total_pages >= 4
    targets = [l.target for l in res.logs if l.target]
    assert any("2_PO-Organisation_2026.pdf" in t for t in targets)
    assert any("Reflexionstext_1_2026.pdf" in t for t in targets)
    assert any("1_PO-Organisation_2026.pdf" in t for t in targets)


def test_real_unibe_ta_exercise_submissions():
    from backend.scrapers.submissions import parse_exercise_submissions

    html_path = Path("htmlfromilias/MMS Way To Exercise Teaching Assistang Grading/4Assignment View_ Submissions and Grades_ Übungen_ ILIAS Universität Bern.html")
    if not html_path.exists():
        pytest.skip("TA exercise dump not found")

    html = html_path.read_text(encoding="utf-8", errors="replace")
    res = parse_exercise_submissions(html, exercise_ref_id="3803739")

    assert len(res.submissions) == 34
    assert res.exercise.submitted_count >= 20
    assert res.exercise.graded_count >= 20
    assert len(res.available_assignments) == 11
    assert res.active_assignment_id == "53187"
    assert res.rtoken is not None

    s0 = res.submissions[0]
    assert "Hediger" in s0.student_name
    assert s0.team_id == "39146"
    assert s0.passed_status == "passed"
    assert s0.download_url is not None
    assert s0.feedback is not None
    assert "Schnittstelle" in s0.feedback


def test_real_unibe_student_feedback():
    from backend.scrapers.submissions import parse_student_assignment_detail

    html_path = Path("htmlfromilias/MMS Exercises as Student/received_feedback_Current Semester_ 5. Auftrag_ Prototyping_ ILIAS Universität Bern.html")
    if not html_path.exists():
        pytest.skip("Student feedback dump not found")

    html = html_path.read_text(encoding="utf-8", errors="replace")
    res = parse_student_assignment_detail(html, exercise_ref_id="3113748", ass_id="40983")

    assert "5. Auftrag" in res.title
    assert res.start_time is not None
    assert res.ended_on is not None
    assert res.is_ended is True
    assert len(res.exercise_files) == 1
    assert "5_Prototyp.pdf" in res.exercise_files[0].download_url
    assert len(res.team_members) == 3
    assert "r.wolf11" in res.team_members
    assert res.passed_status == "passed"
    assert res.evaluation_statement is not None
    assert "Figma" in res.evaluation_statement


def test_real_unibe_exercise_overview_all_assignments():
    from backend.scrapers.submissions import parse_exercise_overview

    html_path = Path("htmlfromilias/MMS Way To Exercise Teaching Assistang Grading/3View_ Assignments_ Übungen_ ILIAS Universität Bern.html")
    if not html_path.exists():
        pytest.skip("Exercise overview dump not found")

    html = html_path.read_text(encoding="utf-8", errors="replace")
    res = parse_exercise_overview(html, exercise_ref_id="3803739")

    assert res.has_ta_access is True
    assert res.active_mode == "all"
    assert len(res.assignments) == 11
    # Check that Übung 3 is detected as ongoing with Create Team button
    u3 = next(a for a in res.assignments if "3" in a.title)
    assert u3.is_ongoing is True
    assert u3.create_team_url is not None
    assert "createTeam" in u3.create_team_url
    assert u3.time_remaining is not None

    # Check that Übung 1 is detected as ended
    u1 = next(a for a in res.assignments if "Übung 1:" in a.title or "1: Einführung" in a.title)
    assert u1.is_ended is True


def test_real_unibe_exercise_info_parsing():
    from backend.scrapers.submissions import parse_exercise_info

    html_path = Path("htmlfromilias/KW Way To Exercise Student/Info_ 1. Übung_ Einführung und Mensch_ ILIAS Universität Bern.html")
    if not html_path.exists():
        pytest.skip("Exercise info dump not found")

    html = html_path.read_text(encoding="utf-8", errors="replace")
    res = parse_exercise_info(html, ref_id="3479509")

    assert len(res.sections) >= 3
    sec_titles = [s.title for s in res.sections]
    assert any("Overview" in t for t in sec_titles)
    overview_sec = next(s for s in res.sections if "Overview" in s.title)
    assert "Assignments" in overview_sec.properties
    assert "Pass Mode" in overview_sec.properties
    assert "mandatory" in overview_sec.properties["Pass Mode"].lower()


def test_real_unibe_uebung_2_and_11_submissions():
    from backend.scrapers.submissions import parse_exercise_submissions

    html_path = Path("htmlfromilias/KW Way To Exercise Student/Assignment View_ Submissions and Grades_ Übungen_ ILIAS Universität Bern.html")
    if not html_path.exists():
        pytest.skip("Übung 2 & 11 dump not found")

    html = html_path.read_text(encoding="utf-8", errors="replace")
    res = parse_exercise_submissions(html, exercise_ref_id="3803739")

    assert res.active_assignment_id == "53198"
    assert len(res.submissions) == 8
    assert len(res.available_assignments) == 11

    # Verify student entries
    s0 = res.submissions[0]
    assert "Bragalini" in s0.student_name
    assert " • " in s0.student_name
    assert len(s0.team_members) == 3
    assert s0.team_members == ["Bragalini, Alan", "Jordi, Tim Frederik", "Nawrozi, Mobina"]
    assert s0.team_id == "39372"
    assert s0.download_url is not None
    assert "downloadReturned" in s0.download_url
    assert "ass_id=53198" in s0.download_url
    assert "Team" in s0.additional_columns


def test_real_unibe_ta_grading_timestamps_and_eval():
    from backend.scrapers.submissions import parse_exercise_submissions

    html_path = Path("htmlfromilias/MMS Way To Exercise Teaching Assistang Grading/4Assignment View_ Submissions and Grades_ Übungen_ ILIAS Universität Bern.html")
    if not html_path.exists():
        pytest.skip("TA grading dump not found")

    html = html_path.read_text(encoding="utf-8", errors="replace")
    res = parse_exercise_submissions(html, exercise_ref_id="3803739")

    assert len(res.submissions) >= 1
    s0 = res.submissions[0]
    assert s0.student_name == "Hediger, Marlon Gabriel"
    assert s0.team_id == "39146"
    assert s0.submission_time == "29. Sep 2026, 08:56:56"
    assert s0.feedback is not None
    assert "A1: ich rate dir" in s0.feedback
    assert s0.download_url is not None


def test_real_unibe_submitted_not_graded_example():
    from backend.scrapers.submissions import parse_exercise_submissions

    html_path = Path("htmlfromilias/KW Way To Exercise Student/Submitted_example_Assignment View_ Submissions and Grades_ Übungen_ ILIAS Universität Bern.html")
    if not html_path.exists():
        pytest.skip("Submitted example dump not found")

    html = html_path.read_text(encoding="utf-8", errors="replace")
    res = parse_exercise_submissions(html, exercise_ref_id="3803739")

    assert len(res.submissions) == 1
    s0 = res.submissions[0]
    assert s0.team_members == ["Bragalini, Alan", "Jordi, Tim Frederik", "Nawrozi, Mobina"]
    assert s0.submission_time == "5. Oct 2026, 16:57:37"
    assert s0.passed_status == "not_graded"
    assert s0.download_url is not None
    assert s0.evaluation_by_file_url is not None
    assert s0.feedback_mail_url is not None
    assert s0.submission_status == "submitted"


def test_real_unibe_feedback_file_upload_dump():
    from backend.scrapers.feedback_files import parse_feedback_files

    html_path = Path("htmlfromilias/File_Upload_Übungen_ ILIAS Universität Bern.html")
    if not html_path.exists():
        pytest.skip("File upload dump not found")

    html = html_path.read_text(encoding="utf-8", errors="replace")
    res = parse_feedback_files(html)

    assert res.student_name == "Bragalini, Alan"
    assert res.member_id == "3205653"
    assert res.upload_url is not None
    assert "postUpload" in res.upload_url or "upload" in res.upload_url
    assert "ilResourceCollectionGUI" in res.upload_url
    assert len(res.files) == 0  # Page has "No records"


def test_real_unibe_student_submitted_files_screen():
    from backend.scrapers.submissions import parse_student_submitted_files_screen

    # 1. Screen with submitted file
    html_path = Path("htmlfromilias/KW Way To Exercise Student/Submission_ Abgabe Übung 2_ ILIAS Universität Bern.html")
    if not html_path.exists():
        pytest.skip("Submission dump not found")

    html = html_path.read_text(encoding="utf-8", errors="replace")
    files, last_sub = parse_student_submitted_files_screen(html)

    assert len(files) == 1
    assert "Valuation" in files[0].filename
    assert "4. Nov 2025" in (files[0].upload_time or "")
    assert files[0].download_url is not None
    assert "cmd=download" in files[0].download_url
    assert "delivered=1004572" in files[0].download_url
    assert files[0].delivered_id == "1004572"
    assert last_sub is not None
    assert "4. Nov 2025" in last_sub

    # 2. Hand-in screen with no existing records
    handin_path = Path("htmlfromilias/KW Way To Exercise Student/Hand_In_Submission_ Übungen_ ILIAS Universität Bern.html")
    if handin_path.exists():
        handin_html = handin_path.read_text(encoding="utf-8", errors="replace")
        empty_files, empty_sub = parse_student_submitted_files_screen(handin_html)
        assert len(empty_files) == 0
        assert empty_sub is None


def test_real_unibe_student_upload_form_dump():
    from backend.scrapers.submissions import parse_student_upload_form

    html_path = Path("htmlfromilias/KW Way To Exercise Student/Hand_In_Upload_Submission_ Übungen_ ILIAS Universität Bern.html")
    if not html_path.exists():
        pytest.skip("Upload form dump not found")

    html = html_path.read_text(encoding="utf-8", errors="replace")
    info = parse_student_upload_form(html)

    assert info.upload_url is not None
    assert "ilRepoStandardUploadHandlerGUI" in info.upload_url
    assert "cmd=upload" in info.upload_url
    assert info.form_action is not None
    assert "cmd=addUpload" in info.form_action
    assert info.input_name == "form/input_0/input_1"
    assert info.file_identifier == "filename"


def test_real_unibe_student_delete_submission_screen():
    from backend.scrapers.submissions import parse_student_submitted_files_screen

    dump_folder = Path("htmlfromilias/KW Way To Exercise Student")
    delete_files = list(dump_folder.glob("*Delete_Submission*.html"))
    if not delete_files:
        pytest.skip("Delete submission dump not found")

    html = delete_files[0].read_text(encoding="utf-8", errors="replace")
    files, last_sub = parse_student_submitted_files_screen(html)

    assert len(files) == 1
    assert files[0].delivered_id == "1145504"
    assert "MMS" in files[0].filename
    assert "1145504" in files[0].download_url











