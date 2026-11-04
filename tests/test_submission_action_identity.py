"""Submission actions must stay attached to their native participant row."""
from urllib.parse import parse_qs, urlsplit

import pytest

from backend.i18n import current_language
from backend.scrapers.submissions import parse_exercise_submissions


@pytest.mark.parametrize('app_language', ['de', 'en'])
@pytest.mark.parametrize('native_language', ['de', 'en'])
@pytest.mark.parametrize('script_boundary', ['', '</script><script>'])
def test_non_navigation_handler_cannot_borrow_next_students_download(
    app_language, native_language, script_boundary,
):
    name, submitted, actions, no, yes, feedback, download = (
        ('Name', 'Abgegeben am', 'Aktionen', 'Nein', 'Ja', 'Feedback', 'Abgaben herunterladen')
        if native_language == 'de' else
        ('Name', 'Submitted on', 'Actions', 'No', 'Yes', 'Feedback', 'Download submissions')
    )
    native_url = (
        'ilias.php?baseClass=ilexercisehandlergui&cmdNode=dc:o5:dd:d1'
        '&cmdClass=ilexsubmissionfilegui&cmd=downloadReturned'
        '&ref_id=100&ass_id=20&member_id=102&part_id=0'
    )
    page = f"""
    <form id="form_exc_mem">
      <select name="ass_id"><option value="20" selected>Assignment</option></select>
      <table id="exc_mem">
        <thead><tr><th>Selection</th><th>{name}</th><th>{submitted}</th><th>{actions}</th></tr></thead>
        <tbody>
          <tr><td><input type="checkbox" name="sel_part_ids[]" value="101"></td>
            <td>Missing, Student (missing)</td><td>{no}</td>
            <td><button id="feedback101">{feedback}</button></td></tr>
          <tr><td><input type="checkbox" name="sel_part_ids[]" value="102"></td>
            <td>Submitted, Student (submitted)</td><td>{yes}</td>
            <td><button id="download102">{download} (1)</button>
                <button id="feedback102">{feedback}</button></td></tr>
        </tbody>
      </table>
    </form>
    <script>
      $('#feedback101').on('click', function(event) {{
        $(this).trigger('open-feedback', {{'options': JSON.parse('[]')}});
        return false;
      }});
      {script_boundary}
      $('#download102').on('click', function(event) {{
        window.location = '{native_url}';
        return false;
      }});
      $('#feedback102').on('click', function(event) {{
        $(this).trigger('open-feedback');
        return false;
      }});
    </script>
    <script>
      $('#unrelated').on('click', function(event) {{
        window.location = 'ilias.php?cmd=downloadReturned&member_id=999';
      }});
    </script>
    """
    token = current_language.set(app_language)
    try:
        result = parse_exercise_submissions(page, '100')
    finally:
        current_language.reset(token)

    missing, actual = result.submissions
    assert missing.member_id == '101'
    assert missing.submission_status == 'not_submitted'
    assert missing.submission_time is None
    assert missing.download_url is None
    assert missing.files == []
    assert actual.member_id == '102'
    assert actual.submission_status == 'submitted'
    assert parse_qs(urlsplit(actual.download_url).query)['member_id'] == ['102']
    assert [file.download_url for file in actual.files] == [actual.download_url]
    assert result.exercise.submitted_count == 1
