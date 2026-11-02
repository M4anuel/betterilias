"""German native labels on existing layouts; these are not live German captures."""
from datetime import date
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest
from bs4 import BeautifulSoup

from backend.auth.session import SessionManager
from backend.scrapers.authoring import parse_file_names
from backend.scrapers.calendar import parse_course_calendar_discovery
from backend.scrapers.exercise_editor import parse_ta_assignments_list
from backend.scrapers.feedback_files import parse_feedback_files
from backend.scrapers.forms import verify_grading_success
from backend.scrapers.logs import parse_course_logs
from backend.scrapers.materials import parse_course_materials
from backend.scrapers.native_text import parse_native_date
from backend.scrapers.podcasts import parse_podcast_series
from backend.scrapers.repository import parse_repository
from backend.scrapers.semester import parse_semester_courses
from backend.scrapers.submission_listing import parse_submission_listing
from backend.scrapers.submissions import parse_exercise_overview, parse_exercise_submissions, parse_student_assignment_detail
from backend.services.ilias_client import IliasClient, SessionExpiredError
from backend.schemas import GradeSubmissionRequest

FIXTURES = Path(__file__).parent / 'fixtures'


@pytest.mark.parametrize('value,label,expected', [
    ('failed','Nicht bestanden','failed'), ('passed','Bestanden','passed'),
    ('notgraded','Nicht bewertet','not_graded'), ('unknown','Nicht bestanden','failed'),
    (None,'Nicht bestanden','failed'),
])
def test_german_ta_status_and_metadata(value,label,expected):
    status=f'<select name="status[42]"><option value="{value}" selected>{label}</option></select>' if value is not None else label
    html=f'''<h1>Übung</h1><table id="exc_mem"><thead><tr><th>Name</th><th>Status</th>
      <th>Interne Anmerkung</th><th>Text-Feedback</th><th>Individueller Abgabetermin</th></tr></thead>
      <tbody><tr><td><input name="listed_part_ids[]" type="hidden" value="42">Muster, Alex</td>
      <td>{status}</td><td>Korrektur bei Ada</td><td>Ein gutes Ergebnis.</td><td>12. März 2026, 18:00</td></tr></tbody></table>'''
    item=parse_exercise_submissions(html,'100').submissions[0]
    assert item.passed_status==expected
    assert item.notice=='Korrektur bei Ada' and item.feedback=='Ein gutes Ergebnis.'
    assert item.individual_deadline=='12. März 2026, 18:00'


@pytest.mark.parametrize('status,expected',[('Nicht bestanden','failed'),('Bestanden','passed'),('Nicht bewertet','not_graded')])
def test_german_student_feedback_panel(status,expected):
    html=f'''<h1>Aufgabe</h1><div class="panel panel-sub"><h3>Rückmeldung</h3><div class="panel-body">
      <p>Status: {status}</p><p>Text-Feedback</p><p>Der Abschnitt über bestandenes Wissen bleibt unverändert.</p>
      </div></div><div class="panel panel-sub"><h3>Terminplan</h3><div class="panel-body">
      <div class="caption">Beendet am: 12. März 2026, 18:00</div></div></div>'''
    detail=parse_student_assignment_detail(html,'100','1')
    assert detail.passed_status==expected
    assert detail.evaluation_statement=='Der Abschnitt über bestandenes Wissen bleibt unverändert.'
    assert detail.ended_on=='12. März 2026, 18:00'


def test_german_overview_properties():
    html='''<h1>Übungen</h1><div class="il-item il-std-item"><h4 class="il-item-title">
      <a href="ilias.php?ass_id=1">Nicht übersetzen: Topic One</a></h4>
      <div class="il-multi-line-cap-3"><span class="il-item-property-name">Abgabetermin:</span><span class="il-item-property-value">12. März 2026</span></div>
      <div class="il-multi-line-cap-3"><span class="il-item-property-name">Anforderung</span><span class="il-item-property-value">Verpflichtend</span></div>
      <div class="il-multi-line-cap-3"><span class="il-item-property-name">Type</span><span class="il-item-property-value">Team Upload</span></div></div>'''
    item=parse_exercise_overview(html,'100').assignments[0]
    assert item.title=='Nicht übersetzen: Topic One'
    assert item.edit_until=='12. März 2026' and item.requirement=='Verpflichtend'
    assert item.is_ongoing and item.ass_type=='Team Upload'
    future=html.replace('Abgabetermin:', 'Startet am:')
    assert not parse_exercise_overview(future,'100').assignments[0].is_ongoing


@pytest.mark.parametrize('text,expected',[('2. März 2026',date(2026,3,2)),('2. Mär. 2026',date(2026,3,2)),
    ('2. Maerz 2026',date(2026,3,2)),('02.03.2026',date(2026,3,2)),('2. March 2026',date(2026,3,2)),
    ('2026-03-02',date(2026,3,2)),('Heute',date(2026,3,2)),('Gestern',date(2026,3,1)),
    ('Morgen',date(2026,3,3)),('31. Februar 2026',None)])
def test_german_and_english_calendar_dates(text,expected):
    assert parse_native_date(text,date(2026,3,2))==expected


@pytest.mark.parametrize('session_date',['2. März 2026','02.03.2026','Heute'])
def test_german_session_dates_and_material_counts(session_date):
    html=f'''<h1>Ansicht: Inhalt: Mein Kurs</h1><ul class="ilContainerItemsContainer"><li id="sess-300" class="ilObjListRow">
      <h3><a href="/go/sess/300">{session_date}, 14:00 - 16:00: Human Topic</a></h3>
      <p>Materialien zur Sitzung: 3</p></li></ul>'''
    materials=parse_course_materials(html,'100')
    assert materials.title=='Mein Kurs'
    assert len(materials.sessions)==1 and materials.sessions[0].materials_count==3
    assert materials.sessions[0].date_str==session_date
    discovery=parse_course_calendar_discovery(html,'100','Mein Kurs')
    assert len(discovery.events)==1
    assert discovery.events[0].title=='Human Topic'
    previous=html.replace(f'{session_date}, 14:00 - 16:00: Human Topic','Alle vergangenen Sitzungen anzeigen')
    assert not parse_course_materials(previous,'100').sessions


@pytest.mark.parametrize('structured',[True,False])
def test_german_podcast_metadata(structured):
    details='<dl><dt>Datum:</dt><dd>02.03.2026, 18:00</dd><dt>Vortragender</dt><dd>Alex Muster</dd><dt>Ort</dt><dd>Raum 12</dd></dl>' if structured else 'Datum 02.03.2026, 18:00 Vortragender Alex Muster Ort Raum 12'
    html=f'''<h1>Inhalt: Podcast Meine Vorlesung</h1><section class="c-entity__container">
      <h3>Original lecture title</h3><div class="c-entity__main-details">{details}</div>
      <a href="ilias.php?cmd=streamVideo&amp;eid=abcdef">Streamen</a></section>'''
    series=parse_podcast_series(html,'100')
    item=series.episodes[0]
    assert series.title=='Meine Vorlesung' and item.title=='Original lecture title'
    assert item.recorded_at=='2026-03-02T18:00:00+01:00'
    assert item.presenter=='Alex Muster' and item.location=='Raum 12'


def test_german_news_inside_course_and_standalone():
    entry='''<div class="il-item"><h4 class="il-item-title">Die Unterlagen sind da</h4>
      <p>Datei: Meine Originaldatei.pdf Datum: 2. März 2026, 18:00</p><a href="/go/file/8">Öffnen</a></div>'''
    logs=parse_course_logs(entry,'100').logs
    assert len(logs)==1 and logs[0].date=='2. März 2026, 18:00'
    assert logs[0].target=='Datei: Meine Originaldatei.pdf' and logs[0].log_type=='file'
    course=parse_course_materials(f'<h1>Mein Kurs</h1><aside class="il_right_col">{entry}</aside>','100')
    assert course.logs==logs


def test_german_feedback_size_column_does_not_include_its_label():
    html=(FIXTURES/'evaluation_by_file/uploaded_now_remove.html').read_text(encoding='utf-8')
    soup=BeautifulSoup(html,'lxml')
    for label in soup.select('.c-table-data__cell__col-title'):
        if label.get_text(strip=True).rstrip(':')=='Size':
            label.string='Größe:'
    item=parse_feedback_files(str(soup)).files[0]
    assert item.size and '24.87' in item.size and 'Größe' not in item.size


def test_german_semester_contact():
    html='''<h1>HS2026</h1><h2>Informatik</h2><div class="il-item il-std-item">
      <h4 class="il-item-title"><a href="/go/crs/100">Originalkurs</a></h4><div class="il-multi-line-cap-3">
      <span class="il-item-property-name">Kontakt:</span><span class="il-item-property-value">Alex Muster</span></div></div>'''
    item=parse_semester_courses(html).courses[0]
    assert 'Alex Muster' in item.description and item.subject=='Informatik'


@pytest.mark.parametrize('label',['Actions for','Aktionen für'])
def test_native_action_label_retains_full_filename(label):
    html=f'''<div class="ilContainerListItemOuter"><h3><a href="/go/file/100">Bericht</a></h3>
      <button class="dropdown-toggle" aria-label="{label} Bericht.pdf"></button></div>'''
    assert parse_file_names(html)=={'100':'Bericht.pdf'}


@pytest.mark.parametrize('summary',["(1 - 20 von 1.234)","(1 – 20 von 1'234)","(1 - 20 of 1,234)","(1 - 20 von 1\u202f234)"])
def test_german_paging_total(summary):
    html=f'<form action="ilias.php?cmd=members"><table id="exc_mem"></table><span class="ilTableFootLight">{summary}</span></form>'
    assert parse_submission_listing(html,'https://ilias.unibe.ch/ilias.php').total==1234


def test_german_assignment_instruction_file_count():
    soup=BeautifulSoup((FIXTURES/'ta_assignments_list.html').read_text(encoding='utf-8'),'lxml')
    row=soup.find('input',attrs={'name':'id[]'}).find_parent('tr')
    row.find_all('td',recursive=False)[8].string='2 Dateien'
    result=parse_ta_assignments_list(str(soup),'3114495')
    assert result.assignments[0].instruction_files_count==2


@pytest.mark.parametrize('alt,kind',[('Kurs','crs'),('Kategorie','cat'),('Gruppe','grp')])
def test_locked_repository_type_from_german_icon(alt,kind):
    html=f'<main><div class="ilContainerListItemOuter" id="lg_div_42_pref_1"><h3 class="il_ContainerItemTitle">Originaltitel</h3><img alt="{alt}"></div></main>'
    item=parse_repository(html,'1').items[0]
    assert item.item_type==kind and not item.accessible


def test_authenticated_german_page_can_contain_login_link_and_denial_notice():
    html='<a class="il-user-avatar">AM</a><a href="shib_login.php">Anmelden</a><p>Archivkurs: Kein Zugriffsrecht</p>'
    response=httpx.Response(200,text=html,request=httpx.Request('GET','https://ilias.unibe.ch/ilias.php'))
    IliasClient()._check_response_for_session_loss(response,'https://ilias.unibe.ch/ilias.php')


@pytest.mark.asyncio
async def test_session_verification_prefers_german_authenticated_identity():
    manager=SessionManager()
    manager.has_cookies=MagicMock(return_value=True)
    response=httpx.Response(200,text='<a class="il-user-avatar">AM</a><a href="shib_login.php">Anmelden</a>',request=httpx.Request('GET','https://ilias.unibe.ch/ilias.php'))
    client=AsyncMock()
    client.get.return_value=response
    client.__aenter__.return_value=client
    manager.get_http_client=MagicMock(return_value=client)
    valid,_=await manager.verify_session()
    assert valid


def test_single_quoted_german_login_form_still_expires():
    response=httpx.Response(200,text="<h1>Anmelden</h1><input name='username'><input name='password'>",request=httpx.Request('GET','https://ilias.unibe.ch/ilias.php'))
    with pytest.raises(SessionExpiredError):
        IliasClient()._check_response_for_session_loss(response,'https://ilias.unibe.ch/ilias.php')


@pytest.mark.parametrize('message,success',[('Die Änderungen wurden gespeichert',True),('Gespeichert',True),('Die Änderungen konnten nicht gespeichert werden',False)])
def test_german_save_result(message,success):
    assert verify_grading_success(f'<p>{message}</p>')[0] is success
    assert verify_grading_success(f'<p>{message}</p>',allow_unconfirmed=True)[0] is success


@pytest.mark.asyncio
@pytest.mark.parametrize('error',['<p>Die Änderungen konnten nicht gespeichert werden</p>', '<div class="alert-danger">Der Wert ist ungültig.</div>'])
async def test_german_grading_error_is_not_overridden_by_http_success(error):
    client=IliasClient()
    client._ensure_authenticated=MagicMock()
    client.session_manager=MagicMock()
    native=AsyncMock()
    native.__aenter__.return_value=native
    native.get.return_value=httpx.Response(200,text=(FIXTURES/'grading_form.html').read_text(encoding='utf-8'),request=httpx.Request('GET','https://ilias.unibe.ch/ilias.php'))
    native.post.return_value=httpx.Response(200,text=error,request=httpx.Request('POST','https://ilias.unibe.ch/ilias.php'))
    client.session_manager.get_http_client.return_value=native
    result=await client.grade_student_submission('100',GradeSubmissionRequest(member_id='42'))
    assert not result.success
