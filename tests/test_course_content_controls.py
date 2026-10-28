"""Native repository controls must never become lecturer content."""
from pathlib import Path

from bs4 import BeautifulSoup
import pytest

from backend.scrapers.materials import _clean_rich_html, parse_course_blocks, parse_course_materials


FIXTURE = Path(__file__).parent / 'fixtures' / 'management' / 'manage.html'


def test_saved_management_page_excludes_bulk_actions_but_keeps_materials():
    result = parse_course_materials(FIXTURE.read_text(encoding='utf8'), '42')
    assert {item.ref_id for item in result.items} == {'3856626', '3856627'}
    assert all(block.block_type == 'items' for block in result.blocks)
    assert not result.rich_text_blocks


@pytest.mark.parametrize('label', ['Availability Period', 'Verfügbarkeit'])
def test_nested_controls_removed_without_filtering_lecturer_action_words(label):
    html = f'''<main id="il_center_col"><div>
      <p>Delete, Move and Copy are file operations.</p>
      <ul><li>Download the worksheet.</li></ul>
      <div class="ilAdminRow"><div class="c-toolbar l-bar__container">
        <button>{label}</button></div></div>
      <h3 class="hidden">Functions</h3>
      <div class="c-toolbar l-bar__container"><img alt="Actions" src="missing.svg">
        <input name="cmd[delete]" value="Delete"></div>
    </div></main>'''
    clean = _clean_rich_html(html, '42')
    soup = BeautifulSoup(clean, 'html.parser')
    assert not soup.select('.ilAdminRow, .c-toolbar, input, img, h3.hidden')
    assert 'Delete, Move and Copy are file operations.' in soup.get_text()
    assert soup.select_one('li').get_text() == 'Download the worksheet.'
    for blocks in [parse_course_blocks(BeautifulSoup(html, 'lxml'), '42'),
                   parse_course_materials(html, '42').blocks]:
        content = ' '.join(block.html_content or '' for block in blocks)
        assert 'Delete, Move and Copy' in content
        assert 'cmd[delete]' not in content
        assert label not in content
