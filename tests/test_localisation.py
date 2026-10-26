import asyncio

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.i18n import CATALOGUES, LanguageMiddleware, current_language, negotiate_language, t, translate
from backend.main import app
from backend.scrapers.materials import parse_course_materials


@pytest.mark.parametrize(('header', 'expected'), [
    ('de-CH,de;q=0.9,en;q=0.8', 'de'), ('en-US', 'en'),
    ('fr;q=1,de;q=0.7,en;q=0.8', 'en'), ('de;q=0,en;q=0.5', 'en'),
    ('de;q=invalid,en;q=0.5', 'en'), ('unsupported', 'en'), ('', 'en'),
])
def test_language_negotiation(header, expected):
    assert negotiate_language(header) == expected


def test_partial_catalogue_falls_back_without_replacing_content(monkeypatch):
    monkeypatch.setitem(CATALOGUES, 'fr', {'Language': 'Langue', 'Abbrechen': '   '})
    assert translate('Language', 'fr') == 'Langue'
    assert translate('Abbrechen', 'fr') == 'Cancel'
    assert translate('Team #{p0}', 'fr', p0='A {other}') == 'Team #A {other}'
    assert translate('Content supplied by ILIAS', 'de') == 'Content supplied by ILIAS'


def test_error_responses_and_validation_use_requested_language():
    client = TestClient(app)
    for language, expected in [('de-CH', 'Dieses Feld ist erforderlich.'), ('en', 'This field is required.')]:
        response = client.post('/api/auth/cookies', json={}, headers={'Accept-Language': language})
        assert response.status_code == 422
        assert response.json()['detail'][0]['msg'] == expected
        assert response.headers['content-language'] == language.split('-')[0]
        assert 'Accept-Language' in response.headers['vary']
    response = client.get('/does-not-exist', headers={'Accept-Language': 'de'})
    assert response.json()['detail'] == 'Nicht gefunden.'
    assert client.get('/does-not-exist?lang=en', headers={'Accept-Language': 'de'}).json()['detail'] == 'Not found.'


@pytest.mark.asyncio
async def test_concurrent_requests_cannot_leak_their_language():
    service = FastAPI()
    service.add_middleware(LanguageMiddleware)

    @service.get('/')
    async def message():
        await asyncio.sleep(0)
        return {'message': t('Abbrechen')}

    before = current_language.get()
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=service), base_url='http://test') as client:
        responses = await asyncio.gather(*[
            client.get('/', headers={'Accept-Language': language}) for language in ['de', 'en'] * 10
        ])
    assert [response.json()['message'] for response in responses] == ['Abbrechen', 'Cancel'] * 10
    assert current_language.get() == before


def test_generated_headings_translate_without_changing_ilias_content_or_layout():
    html = '''<html><h1 id="il_mhead_ttext">Meine Vorlesung</h1>
    <div id="il_center_col"><div><div class="ilContainerListItem">
    <img class="il-item-icon" src="icon_file.svg" />
    <a class="il_ContainerItemTitle" href="ilias.php?ref_id=123&amp;cmd=sendfile">Meine Datei</a>
    </div></div></div></html>'''
    results = []
    for language in ('de', 'en'):
        token = current_language.set(language)
        try:
            results.append(parse_course_materials(html, '42'))
        finally:
            current_language.reset(token)
    german, english = results
    assert german.title == english.title == 'Meine Vorlesung'
    assert german.items[0].title == english.items[0].title == 'Meine Datei'
    assert german.layout_hash == english.layout_hash
    assert [block.id for block in german.blocks] == [block.id for block in english.blocks]
    assert any(block.title_key for block in english.blocks)
    assert [block.title for block in german.blocks] != [block.title for block in english.blocks]
