import pytest
from bs4 import BeautifulSoup
from backend.scrapers.submissions import parse_student_assignment_detail


@pytest.mark.parametrize('team', [False, True])
def test_student_instructions_preserve_html_and_native_team_capability(team):
    html = '''<div class="panel"><h2>Work Instructions</h2><div class="panel-body">
        <div class="ilAssignmentInstructions"><p><strong>Bold</strong> <em>Emphasis</em><br/>Next line</p>
        <p>Paragraph two</p><ul><li>Item</li></ul><a href="https://example.org" target="_blank">Link</a>
        <script>alert(1)</script><a href="javascript:alert(1)" onclick="alert(1)">Unsafe</a></div></div></div>'''
    if team: html += '<div class="panel"><h2>Team</h2><div class="panel-body">No team yet</div></div>'
    detail = parse_student_assignment_detail(html, '200', '20')
    assert detail.is_team_upload is team
    markup = BeautifulSoup(detail.instructions, 'html.parser')
    assert markup.strong.text == 'Bold' and markup.em.text == 'Emphasis'
    assert len(markup.find_all('p')) == 2 and markup.br and markup.ul.li.text == 'Item'
    assert markup.find('a')['target'] == '_blank'
    assert not markup.find('script')
    assert not markup.find('a', string='Unsafe').has_attr('href')
    assert not markup.find('a', string='Unsafe').has_attr('onclick')
