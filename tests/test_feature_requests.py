"""Community data belongs to browser identities, never ILIAS sessions."""
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
import time

from fastapi.testclient import TestClient
from PIL import Image
import pytest

from backend.config import settings
from backend.main import app
from backend import feature_requests as board


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, 'feature_requests_dir', str(tmp_path / 'board'))
    monkeypatch.setattr(settings, 'coordination_dir', str(tmp_path / 'locks'))
    monkeypatch.setattr(settings, 'app_env', 'test')
    monkeypatch.setattr(settings, 'admin_api_key', 'a' * 48)
    monkeypatch.setattr(settings, 'feature_images_max_bytes', 10_000_000_000)
    with TestClient(app) as client:
        yield client


H = {'X-Community-Request': '1', 'Accept-Language': 'en'}
A = {'X-Admin-Key': 'a' * 48, 'X-Admin-Request': '1'}
BODY = {'title': 'A helpful improvement', 'description': 'Make the workflow easier.', 'category': 'qol', 'nickname': 'Student'}


def identify(client):
    assert client.post('/api/feature-requests/identity', headers=H).status_code == 200
    return client.cookies.get(board.COOKIE)


def create(client, **values):
    response = client.post('/api/feature-requests', headers=H, json={**BODY, **values})
    assert response.status_code == 200, response.text
    return response.json()


def png(width=200, height=120):
    output = BytesIO()
    Image.new('RGB', (width, height), '#0aaca5').save(output, 'PNG')
    return output.getvalue()


def test_public_access_cookie_scope_ownership_and_votes(client):
    assert client.get('/api/feature-requests').json()['items'] == []
    assert client.post('/api/feature-requests', json=BODY).status_code == 403
    token = identify(client)
    request = create(client)
    assert request['owned'] and request['my_vote'] == 0
    ref = '/api/feature-requests/' + request['id']
    for value in (1, 1, -1, -1, 0):
        result = client.put(ref + '/vote', json={'value': value}, headers=H).json()
        assert result['score'] == value and result['my_vote'] == value
    client.cookies.clear()
    assert not client.get(ref).json()['owned']
    identify(client)
    assert client.patch(ref, json=BODY, headers=H).status_code == 403
    assert client.delete(ref, headers=H).status_code == 403
    assert client.put(ref + '/vote', json={'value': 1}, headers=H).json()['score'] == 1
    client.cookies.set(board.COOKIE, token)
    assert client.put(ref + '/vote', json={'value': 1}, headers=H).json()['score'] == 2
    assert client.get(ref).json()['owned']


def test_comments_edit_delete_admin_and_plain_text(client):
    identify(client)
    request = create(client, title='<script>literal title</script>')
    ref = '/api/feature-requests/' + request['id']
    posted = client.post(ref + '/comments', headers=H, json={'message': '<img src=x onerror=alert(1)>', 'nickname': 'Friend'}).json()
    comment = posted['comments'][0]
    assert comment['owned'] and comment['message'].startswith('<img')
    path = ref + '/comments/' + comment['id']
    client.cookies.clear(); identify(client)
    assert client.patch(path, headers=H, json={'message': 'Edit'}).status_code == 403
    assert client.delete(path, headers=H).status_code == 403
    admin_path = path.replace('/api/', '/api/admin/')
    assert client.patch(admin_path, headers=A, json={'message': 'Moderated'}).json()['comments'][0]['message'] == 'Moderated'
    assert client.delete(admin_path, headers=A).json()['comments'] == []
    assert client.get('/api/admin/feature-requests').status_code == 404
    assert client.put(ref.replace('/api/', '/api/admin/') + '/status', headers=A, json={'status': 'planned'}).json()['status'] == 'planned'
    assert client.delete(ref.replace('/api/', '/api/admin/'), headers=A).json()['deleted']
    assert client.get(ref).status_code == 404


def test_image_optimization_private_staging_and_cache(client):
    identify(client)
    image = client.post('/api/feature-requests/images', headers=H, content=png(1500, 1000)).json()['id']
    assert client.get(f'/api/feature-requests/media/{image}/640').status_code == 404
    request = create(client, images=[image])
    variants = request['images'][0]['variants']
    assert [v['width'] for v in variants] == [640, 1280, 1500]
    media = client.get(variants[0]['url'])
    assert media.status_code == 200 and media.headers['content-type'] == 'image/webp'
    picture = Image.open(BytesIO(media.content))
    assert picture.size == (640, 427) and not picture.getexif()
    assert client.head(variants[0]['url']).headers['content-length'] == str(len(media.content))
    assert client.get(variants[0]['url'], headers={'If-None-Match': media.headers['etag']}).status_code == 304
    assert client.delete('/api/feature-requests/' + request['id'], headers=H).status_code == 200
    assert client.get(variants[0]['url']).status_code == 404
    assert not list((board.root() / 'media').iterdir())


def test_images_validate_limits_and_attachment_ownership(client):
    identify(client)
    for content in (b'<svg/>', b'not an image'):
        assert client.post('/api/feature-requests/images', headers=H, content=content).status_code == 400
    assert client.post('/api/feature-requests/images', headers=H, content=b'x' * (board.MAX_FILE + 1)).status_code == 413
    image = client.post('/api/feature-requests/images', headers=H, content=png()).json()['id']
    assert client.post('/api/feature-requests', headers=H, json={**BODY, 'images': [image] * 6}).status_code == 422
    client.cookies.clear(); identify(client)
    assert client.post('/api/feature-requests', headers=H, json={**BODY, 'images': [image]}).status_code == 400
    assert client.post('/api/feature-requests', headers=H, json={**BODY, 'title': '  '}).status_code == 422


def test_cookie_flags_request_body_and_pixel_bounds(client, monkeypatch):
    with TestClient(app, base_url='https://testserver') as secure:
        monkeypatch.setattr(settings, 'app_env', 'production')
        result = secure.post('/api/feature-requests/identity', headers=H)
        cookie = result.headers['set-cookie']
        assert all(flag in cookie for flag in ('HttpOnly', 'Secure', 'SameSite=strict', 'Path=/api/feature-requests'))
        assert board.COOKIE in secure.cookies
        result = secure.post('/api/feature-requests', headers=H, content=b' ' * 70000)
        assert result.status_code == 413
        monkeypatch.setattr(board, 'MAX_PIXELS', 100)
        assert secure.post('/api/feature-requests/images', headers=H, content=png()).status_code == 413


def test_narrow_portrait_variants_have_unique_urls_and_accounting(client):
    identify(client)
    image = client.post('/api/feature-requests/images', headers=H, content=png(1, 3000)).json()['id']
    request = create(client, images=[image])
    variants = request['images'][0]['variants']
    assert len(variants) == len({v['url'] for v in variants})
    assert board.storage()['used'] == sum(len(client.get(v['url']).content) for v in variants)


def test_quota_completed_grace_period_and_orphans(client, monkeypatch):
    identify(client)
    image = client.post('/api/feature-requests/images', headers=H, content=png()).json()['id']
    request = create(client, images=[image]); ref = request['id']
    used = board.storage()['used']
    monkeypatch.setattr(settings, 'feature_images_max_bytes', used)
    assert client.post('/api/feature-requests/images', headers=H, content=png()).status_code == 507
    board.set_status(ref, 'completed')
    assert client.post('/api/feature-requests/images', headers=H, content=png()).status_code == 507
    with board.database() as db:
        db.execute('UPDATE requests SET completed=? WHERE id=?', (time.time() - 31 * 86400, ref))
    orphan = board.root() / 'media' / 'orphan.webp'; orphan.write_bytes(b'abandoned')
    uploaded = client.post('/api/feature-requests/images', headers=H, content=png())
    assert uploaded.status_code == 200 and not orphan.exists()
    archived = client.get('/api/feature-requests/' + ref).json()
    assert archived['images_archived'] and not archived['images'] and archived['description'] == BODY['description']
    assert client.patch('/api/feature-requests/' + ref, headers=H, json={**BODY, 'images': [uploaded.json()['id']]}).status_code == 400
    assert board.storage()['used'] <= used


def test_concurrent_votes_quota_and_restart_persistence(client, monkeypatch):
    identify(client); request = create(client); ref = request['id']
    owner = board.identity(client.cookies.get(board.COOKIE))
    with ThreadPoolExecutor(max_workers=6) as pool:
        list(pool.map(lambda _: board.vote(ref, owner, 1), range(12)))
    assert board.detail(ref, owner)['score'] == 1
    image = board.upload(png(), owner)
    one = board.storage()['used']
    monkeypatch.setattr(settings, 'feature_images_max_bytes', one * 2)
    def attempt(_):
        try:
            return board.upload(png(), owner)
        except Exception as exc:
            assert exc.status_code == 507
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(attempt, range(4)))
    assert sum(r is not None for r in results) == 1
    assert board.storage()['used'] <= one * 2
    with board.database() as db:
        db.execute('UPDATE images SET created=? WHERE id=?', (time.time() - 90000, image['id']))
    board.maintain()
    assert board.storage()['used'] == one
    assert board.detail(ref)['score'] == 1
