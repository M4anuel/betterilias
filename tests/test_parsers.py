import pytest
from backend.scrapers.dashboard import parse_dashboard
from backend.scrapers.materials import parse_course_materials
from backend.scrapers.submissions import parse_exercise_submissions
from backend.scrapers.forms import extract_grading_form, verify_grading_success


def test_parse_dashboard(dashboard_html):
    courses = parse_dashboard(dashboard_html)
    assert len(courses) == 3

    c1 = courses[0]
    assert c1.ref_id == "123456"
    assert "Einführung in die Programmierung" in c1.title
    assert c1.item_type == "crs"
    assert "Vorlesung und Übungen" in c1.description

    c2 = courses[1]
    assert c2.ref_id == "234567"
    assert "Datenbanksysteme II" in c2.title

    c3 = courses[2]
    assert c3.ref_id == "345678"
    assert "Tutorium Gruppe 3" in c3.title
    assert c3.item_type == "grp"


def test_parse_course_materials(course_materials_html):
    res = parse_course_materials(course_materials_html, container_ref_id="123456")
    assert "Einführung in die Programmierung" in res.title
    assert len(res.breadcrumbs) == 3
    assert res.breadcrumbs[0].title == "Magazin"

    assert len(res.items) == 3

    # Folder
    f = res.items[0]
    assert f.ref_id == "99001"
    assert f.item_type == "fold"
    assert f.title == "Vorlesungsunterlagen"

    # File
    file_item = res.items[1]
    assert file_item.ref_id == "99002"
    assert file_item.item_type == "file"
    assert file_item.title == "Syllabus_2026.pdf"
    assert file_item.file_size == "1.4 MB"

    # Exercise
    exc = res.items[2]
    assert exc.ref_id == "99003"
    assert exc.item_type == "exc"
    assert "Übungsblatt 01" in exc.title


def test_parse_exercise_submissions(exercise_submissions_html):
    res = parse_exercise_submissions(exercise_submissions_html, exercise_ref_id="99003")
    assert res.exercise.ref_id == "99003"
    assert "Übungsblatt 01" in res.exercise.title
    assert res.exercise.total_participants == 3
    assert res.exercise.submitted_count == 2
    assert res.exercise.graded_count == 1

    # Student 1 (Muster, Anna)
    s1 = res.submissions[0]
    assert "Muster, Anna" in s1.student_name
    assert s1.login == "amuster"
    assert s1.submission_status == "submitted"
    assert len(s1.files) == 1
    assert s1.files[0].filename == "solution_anna.py"
    assert s1.passed_status == "passed"
    assert s1.mark == "6.0"
    assert "Hervorragende Implementierung" in s1.feedback

    # Student 2 (Meier, Beat)
    s2 = res.submissions[1]
    assert "Meier, Beat" in s2.student_name
    assert s2.submission_status == "submitted"
    assert s2.passed_status == "not_graded"

    # Student 3 (Schmidt, Claudia)
    s3 = res.submissions[2]
    assert "Schmidt, Claudia" in s3.student_name
    assert s3.submission_status == "not_submitted"
    assert len(s3.files) == 0


def test_extract_grading_form(grading_form_html):
    form_data = extract_grading_form(grading_form_html, member_id="102")
    assert "saveStatusParticipant" in form_data.action_url
    assert form_data.hidden_fields.get("rtoken") == "secret_csrf_token_999"
    assert form_data.hidden_fields.get("cmdNode") == "w4:vk"
    assert form_data.hidden_fields.get("part_id") == "102"
    assert form_data.mark_field_name == "mark"
    assert form_data.status_field_name == "status"
    assert form_data.feedback_field_name == "feedback"


def test_verify_grading_success():
    success_html = """
    <div class="ilSystemMessage alert alert-success">
        Änderungen erfolgreich gespeichert.
    </div>
    """
    ok, msg = verify_grading_success(success_html)
    assert ok is True
    assert "erfolgreich" in msg

    fail_html = """
    <div class="ilSystemMessage alert alert-danger">
        Fehler beim Speichern: Ungültige Eingabe.
    </div>
    """
    ok2, msg2 = verify_grading_success(fail_html)
    assert ok2 is False
    assert "Fehler" in msg2

    redirect_html = "<script>window.location.href = 'ilias.php?cmd=members';</script>"
    ok3, msg3 = verify_grading_success(redirect_html)
    assert ok3 is True


def test_extract_feedback_modal_form():
    from backend.scrapers.forms import extract_feedback_modal_form

    modal_html = """
    <div class="modal-dialog">
        <form action="ilias.php?baseClass=ilexercisehandlergui&cmdNode=dc:o5:dd:de&cmdClass=ilExerciseSubmissionFeedbackGUI&cmd=validateAndSubmitFeedbackForm&ref_id=3803739&ass_id=53198&member_id=3205653" method="post">
            <input type="hidden" name="rtoken" value="csrf_test_token_123" />
            <input type="hidden" name="cmdNode" value="dc:o5:dd:de" />
            <div class="form-group">
                <textarea name="comment" rows="6">Bestehender Kommentar</textarea>
            </div>
            <button type="submit" name="cmd[validateAndSubmitFeedbackForm]" value="Speichern">Speichern</button>
        </form>
    </div>
    """
    info = extract_feedback_modal_form(modal_html)
    assert info.action_url is not None
    assert "validateAndSubmitFeedbackForm" in info.action_url
    assert info.hidden_fields.get("rtoken") == "csrf_test_token_123"
    assert info.hidden_fields.get("cmdNode") == "dc:o5:dd:de"
    assert info.comment_field_name == "comment"
    assert info.submit_button_name == "cmd[validateAndSubmitFeedbackForm]"
    assert info.submit_button_value == "Speichern"


def test_extract_grading_form_real_dump():
    import glob
    from pathlib import Path

    dumps = glob.glob("htmlfromilias/**/Effectivly_saved*.html", recursive=True)
    if not dumps:
        pytest.skip("Effectivly_saved dump not found")

    html = Path(dumps[0]).read_text(encoding="utf-8", errors="replace")
    form_data = extract_grading_form(html, member_id="3205653")

    assert "fallbackCmd=saveStatusAll" in form_data.action_url
    assert form_data.status_field_name == "status[3205653]"
    assert form_data.mark_field_name == "mark[3205653]"
    assert form_data.notice_field_name == "notice[3205653]"
    assert form_data.submit_button_name == "cmd[saveStatusAll]"
    assert len(form_data.hidden_fields) >= 5

def test_clean_rich_html_pdf_embeds():
    from backend.scrapers.materials import _clean_rich_html

    raw = '<div class="ilc_section"><iframe src="/data/course_1/schedule.pdf"></iframe></div>'
    res = _clean_rich_html(raw)
    assert 'class="pdf-embed"' in res
    assert 'https://ilias.unibe.ch/data/course_1/schedule.pdf#toolbar=0&amp;navpanes=0&amp;scrollbar=0&amp;pagemode=none&amp;view=FitH' in res or 'https://ilias.unibe.ch/data/course_1/schedule.pdf#toolbar=0&navpanes=0&scrollbar=0&pagemode=none&view=FitH' in res

    raw2 = '<embed src="https://ilias.unibe.ch/slides.pdf" type="application/pdf">'
    res2 = _clean_rich_html(raw2)
    assert 'pdf-embed' in res2
    assert 'toolbar=0' in res2
    assert 'view=FitH' in res2


def test_parse_exercise_submissions_german_actions_and_fallback_and_teams():
    german_html = """
    <html><body>
    <form id="form_exc_mem" action="ilias.php?baseClass=ilexercisehandlergui&cmdNode=dc:o5:dd&cmdClass=ilExerciseManagementGUI&cmd=post&ref_id=3803739&ass_id=53188&rtoken=abcdef1234567890abcdef1234567890">
    <select name="ass_id"><option value="53188" selected>1. Übung</option></select>
    <table id="exc_mem" class="table">
    <thead>
        <tr>
            <th>Auswahl</th><th>Name / Login</th><th>Abgabe gesendet am</th><th>Abgegeben am</th><th>Individuelle Abgabefrist</th>
            <th>Status</th><th>Note</th><th>Bewertet am</th><th>Bewertung am</th><th>Bewertung</th><th>Hinweis für Tutoren</th><th>Aktionen</th>
        </tr>
    </thead>
    <tbody>
        <!-- Student 1: German action button 'Abgaben herunterladen (1)' -->
        <tr>
            <td><input type="checkbox" name="id[]" value="1001" /></td>
            <td>Muster, Max (1001)</td>
            <td>01.10.2026</td>
            <td>24. Sep 2026, 10:29:56</td>
            <td>-</td>
            <td>Nicht bewertet</td>
            <td>-</td>
            <td>-</td>
            <td>-</td>
            <td>-</td>
            <td>-</td>
            <td>
                <div class="dropdown">
                    <button class="btn btn-default dropdown-toggle" type="button">Aktionen</button>
                    <ul class="dropdown-menu">
                        <li><button class="btn btn-link" data-action="ilias.php?baseClass=ilexercisehandlergui&cmdNode=dc:o5:dd:d1&cmdClass=ilexsubmissionfilegui&cmd=downloadReturned&ref_id=3803739&ass_id=53188&vw=1&member_id=1001&part_id=0">Abgaben herunterladen (1)</button></li>
                    </ul>
                </div>
            </td>
        </tr>
        <!-- Student 2: Action via dynamic script click handler -->
        <tr>
            <td><input type="checkbox" name="id[]" value="1002" /></td>
            <td>Meier, Eva (1002)</td>
            <td>01.10.2026</td>
            <td>25. Sep 2026, 14:15:00</td>
            <td>-</td>
            <td>Nicht bewertet</td>
            <td>-</td>
            <td>-</td>
            <td>-</td>
            <td>-</td>
            <td>-</td>
            <td>
                <div class="dropdown">
                    <button class="btn btn-link" id="btn_script_dl_1002">Download</button>
                </div>
            </td>
        </tr>
        <!-- Student 3: Team partner 1 with direct download button -->
        <tr>
            <td><input type="checkbox" name="id[]" value="1003" /></td>
            <td>Team Alpha (99)</td>
            <td>01.10.2026</td>
            <td>26. Sep 2026, 18:00:00</td>
            <td>-</td>
            <td>Bestanden</td>
            <td>-</td>
            <td>-</td>
            <td>-</td>
            <td>-</td>
            <td>-</td>
            <td>
                <button class="btn btn-link" data-action="ilias.php?baseClass=ilexercisehandlergui&cmdNode=dc:o5:dd:d1&cmdClass=ilexsubmissionfilegui&cmd=downloadReturned&ref_id=3803739&ass_id=53188&vw=1&member_id=1003&part_id=0">Herunterladen (2)</button>
            </td>
        </tr>
        <!-- Student 4: Team partner 2 without direct button, shares Team 99 -->
        <tr>
            <td><input type="checkbox" name="id[]" value="1004" /></td>
            <td>Team Alpha Partner (99)</td>
            <td>01.10.2026</td>
            <td>-</td>
            <td>-</td>
            <td>Bestanden</td>
            <td>-</td>
            <td>-</td>
            <td>-</td>
            <td>-</td>
            <td>-</td>
            <td>
                <span>Keine Aktionen</span>
            </td>
        </tr>
        <!-- Student 5: Submitted on timestamp present, but action button omitted (fallback synthesis) -->
        <tr>
            <td><input type="checkbox" name="id[]" value="1005" /></td>
            <td>Solo, Hans (1005)</td>
            <td>01.10.2026</td>
            <td>27. Sep 2026, 11:00:00</td>
            <td>-</td>
            <td>Nicht bewertet</td>
            <td>-</td>
            <td>-</td>
            <td>-</td>
            <td>-</td>
            <td>-</td>
            <td>
                <span>Keine Aktionen</span>
            </td>
        </tr>
    </tbody>
    </table>
    </form>
    <script>
    $('#btn_script_dl_1002').on('click', function(event) {
        window.location = 'ilias.php?baseClass=ilexercisehandlergui&cmdNode=dc:o5:dd:d1&cmdClass=ilexsubmissionfilegui&cmd=downloadReturned&ref_id=3803739&ass_id=53188&vw=1&member_id=1002&part_id=0';
        return false;
    });
    </script>
    </body></html>
    """

    res = parse_exercise_submissions(german_html, exercise_ref_id="3803739")
    assert len(res.submissions) == 5

    # 1. German button parsed
    s1 = res.submissions[0]
    assert "Muster, Max" in s1.student_name
    assert s1.submission_status == "submitted"
    assert s1.download_url is not None
    assert "downloadReturned" in s1.download_url
    assert "member_id=1001" in s1.download_url

    # 2. Script click handler parsed
    s2 = res.submissions[1]
    assert "Meier, Eva" in s2.student_name
    assert s2.submission_status == "submitted"
    assert s2.download_url is not None
    assert "downloadReturned" in s2.download_url
    assert "member_id=1002" in s2.download_url

    # 3. Team partner 1
    s3 = res.submissions[2]
    assert s3.team_id == "99"
    assert s3.download_url is not None
    assert "member_id=1003" in s3.download_url

    # 4. Team partner 2 inherits download URL and submission status from team
    s4 = res.submissions[3]
    assert s4.team_id == "99"
    assert s4.download_url is not None
    assert s4.download_url == s3.download_url
    assert s4.submission_status == "submitted"
    assert s4.submission_time == "26. Sep 2026, 18:00:00"

    # 5. Fallback synthesis for submitted student without explicit action button
    s5 = res.submissions[4]
    assert "Solo, Hans" in s5.student_name
    assert s5.submission_status == "submitted"
    assert s5.download_url is not None
    assert "downloadReturned" in s5.download_url
    assert "member_id=1005" in s5.download_url

