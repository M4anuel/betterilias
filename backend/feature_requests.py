"""Public community board, independent of ILIAS accounts.

SQLite and the media lock share the local VPS volume across all workers. Files
are published under the same lock as quota accounting; crash leftovers are
reconciled before admitting another upload, never ignored by the quota.
"""
from contextlib import contextmanager
from hashlib import sha256
from io import BytesIO
import json
import secrets
import sqlite3
import time
import warnings

from fastapi import HTTPException
from PIL import Image, ImageOps, UnidentifiedImageError

from backend.config import BASE_DIR, settings
from backend.coordination import SharedLock
from backend.i18n import t

STATUSES = ('open', 'planned', 'in_progress', 'completed', 'declined')
CATEGORIES = ('feature', 'qol', 'ilias')
MAX_FILE = 8_000_000
MAX_PIXELS = 25_000_000
COOKIE = 'betterilias_community'


def root():
    path = BASE_DIR / settings.feature_requests_dir
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    return path


@contextmanager
def database():
    db = sqlite3.connect(root() / 'board.sqlite3', timeout=30)
    db.row_factory = sqlite3.Row
    try:
        db.execute('PRAGMA foreign_keys=ON')
        db.execute('PRAGMA journal_mode=WAL')
        db.executescript('''
            CREATE TABLE IF NOT EXISTS requests (
                id TEXT PRIMARY KEY, owner TEXT NOT NULL, nickname TEXT NOT NULL,
                title TEXT NOT NULL, description TEXT NOT NULL, category TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'open', created REAL NOT NULL,
                updated REAL NOT NULL, completed REAL, archived INTEGER NOT NULL DEFAULT 0);
            CREATE TABLE IF NOT EXISTS votes (
                request_id TEXT REFERENCES requests(id) ON DELETE CASCADE,
                owner TEXT NOT NULL, value INTEGER NOT NULL CHECK(value IN (-1,1)),
                PRIMARY KEY(request_id,owner));
            CREATE TABLE IF NOT EXISTS comments (
                id TEXT PRIMARY KEY, request_id TEXT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
                owner TEXT NOT NULL, nickname TEXT NOT NULL, message TEXT NOT NULL,
                created REAL NOT NULL, updated REAL NOT NULL);
            CREATE INDEX IF NOT EXISTS comments_request ON comments(request_id,created);
            CREATE TABLE IF NOT EXISTS images (
                id TEXT PRIMARY KEY, owner TEXT NOT NULL, request_id TEXT REFERENCES requests(id) ON DELETE CASCADE,
                variants TEXT NOT NULL, bytes INTEGER NOT NULL, created REAL NOT NULL);
        ''')
        db.execute('BEGIN IMMEDIATE')
        yield db
        db.commit()
    except BaseException:
        db.rollback()
        raise
    finally:
        db.close()


def fail(code, status=400):
    raise HTTPException(status, detail=t(f'requests.{code}'))


def identifier():
    return secrets.token_hex(16)


def identity(token):
    if not token or len(token) != 64 or any(c not in '0123456789abcdef' for c in token):
        return ''
    return sha256(token.encode()).hexdigest()


def request_row(db, ref):
    row = db.execute('SELECT * FROM requests WHERE id=?', (ref,)).fetchone()
    if row is None:
        fail('not_found', 404)
    return row


def author(row, owner, admin=False):
    if not admin and (not owner or row['owner'] != owner):
        fail('not_owner', 403)


def image_info(row):
    variants = json.loads(row['variants'])
    return {'id': row['id'], 'variants': [dict(v, url=f"/api/feature-requests/media/{row['id']}/{v['width']}") for v in variants]}


def serialize(db, row, owner, detail=False, admin=False):
    result = {k: row[k] for k in ('id', 'nickname', 'title', 'description', 'category', 'status', 'created', 'updated')}
    result.update(owned=bool(owner and row['owner'] == owner), images_archived=bool(row['archived']),
        score=db.execute('SELECT COALESCE(SUM(value),0) FROM votes WHERE request_id=?', (row['id'],)).fetchone()[0],
        my_vote=db.execute('SELECT value FROM votes WHERE request_id=? AND owner=?', (row['id'], owner)).fetchone(),
        comment_count=db.execute('SELECT COUNT(*) FROM comments WHERE request_id=?', (row['id'],)).fetchone()[0])
    result['my_vote'] = result['my_vote'][0] if result['my_vote'] else 0
    result['images'] = [image_info(img) for img in db.execute('SELECT * FROM images WHERE request_id=? ORDER BY created,id', (row['id'],))]
    if detail:
        result['comments'] = [{**{k: c[k] for k in ('id', 'nickname', 'message', 'created', 'updated')},
                               'owned': bool(owner and c['owner'] == owner)}
                              for c in db.execute('SELECT * FROM comments WHERE request_id=? ORDER BY created,id', (row['id'],))]
    return result


def listing(owner='', search='', category='', status='', sort='top', page=0):
    with database() as db:
        # User text is data, including LIKE wildcards. Sort expressions are fixed.
        query = '''FROM requests r WHERE (?='' OR instr(lower(r.title || ' ' || r.description),lower(?))>0)
                   AND (?='' OR r.category=?) AND (?='' OR r.status=?)'''
        args = (search, search, category, category, status, status)
        count = db.execute('SELECT COUNT(*) ' + query, args).fetchone()[0]
        order = 'r.created DESC,r.id' if sort == 'newest' else '(SELECT COALESCE(SUM(value),0) FROM votes WHERE request_id=r.id) DESC,r.created DESC,r.id'
        rows = db.execute('SELECT r.* ' + query + ' ORDER BY ' + order + ' LIMIT 30 OFFSET ?', (*args, page * 30)).fetchall()
        return {'items': [serialize(db, r, owner) for r in rows], 'has_more': count > (page + 1) * 30}


def detail(ref, owner=''):
    with database() as db:
        return serialize(db, request_row(db, ref), owner, detail=True)


def image_lock():
    return SharedLock('community-media:' + str(root()), timeout=30)


def reconcile(db):
    """Called only under image_lock. Remove expired drafts and crash orphans."""
    folder = root() / 'media'
    folder.mkdir(exist_ok=True)
    expired = db.execute('SELECT id FROM images WHERE request_id IS NULL AND created<?', (time.time() - 86400,)).fetchall()
    for row in expired:
        remove_image(db, row['id'])
    known = {f"{row['id']}-{v['width']}.webp" for row in db.execute('SELECT * FROM images') for v in json.loads(row['variants'])}
    for file in folder.iterdir():
        if file.is_file() and file.name not in known:
            file.unlink(missing_ok=True)


def remove_image(db, ref):
    # Remove files first: failure must not free space in the accounting.
    for file in (root() / 'media').glob(ref + '-*.webp'):
        file.unlink(missing_ok=True)
    db.execute('DELETE FROM images WHERE id=?', (ref,))


def upload(raw, owner):
    # One decoder/encoder across the local volume bounds image memory and CPU.
    with image_lock().sync():
        if not raw or len(raw) > MAX_FILE:
            fail('image_limits', 413)
        try:
            with warnings.catch_warnings():
                warnings.simplefilter('error', Image.DecompressionBombWarning)
                with Image.open(BytesIO(raw)) as source:
                    if source.format not in ('JPEG', 'PNG', 'WEBP') or getattr(source, 'n_frames', 1) != 1:
                        fail('image_type')
                    if source.width * source.height > MAX_PIXELS:
                        fail('image_limits', 413)
                    source.load()
                    picture = ImageOps.exif_transpose(source).convert('RGBA' if 'A' in source.getbands() or 'transparency' in source.info else 'RGB')
        except (UnidentifiedImageError, OSError, ValueError, SyntaxError, Image.DecompressionBombError, Image.DecompressionBombWarning):
            fail('image_type')
        ref, encoded = identifier(), {}
        sizes = sorted({min(size, max(picture.size)) for size in (640, 1280, 2560)})
        for size in sizes:
            resized = picture.copy()
            resized.thumbnail((size, size), Image.Resampling.LANCZOS)
            output = BytesIO()
            resized.save(output, 'WEBP', quality=85, method=4, exif=b'', xmp=b'')
            encoded[resized.width] = ({'width': resized.width, 'height': resized.height}, output.getvalue())
        # Extremely narrow portraits can round to the same width. Retain the
        # largest corresponding variant once, for accurate URLs and byte counts.
        variants = [value[0] for value in encoded.values()]
        buffers = [value[1] for value in encoded.values()]
        required = sum(map(len, buffers))
        with database() as db:
            reconcile(db)
            used = db.execute('SELECT COALESCE(SUM(bytes),0) FROM images').fetchone()[0]
            eligible = db.execute("SELECT id FROM requests WHERE status='completed' AND completed<=? ORDER BY completed,id", (time.time() - 30 * 86400,)).fetchall()
            for row in eligible:
                if used + required <= settings.feature_images_max_bytes:
                    break
                for img in db.execute('SELECT id,bytes FROM images WHERE request_id=?', (row['id'],)).fetchall():
                    remove_image(db, img['id'])
                    used -= img['bytes']
                    db.execute('UPDATE requests SET archived=1 WHERE id=?', (row['id'],))
            # Commit cleanup even if the incoming image cannot fit.
            db.commit()
            db.execute('BEGIN IMMEDIATE')
            if used + required > settings.feature_images_max_bytes:
                fail('storage_full', 507)
            try:
                for variant, content in zip(variants, buffers):
                    (root() / 'media' / f"{ref}-{variant['width']}.webp").write_bytes(content)
                db.execute('INSERT INTO images VALUES (?,?,NULL,?,?,?)', (ref, owner, json.dumps(variants), required, time.time()))
            except BaseException:
                for file in (root() / 'media').glob(ref + '-*.webp'):
                    file.unlink(missing_ok=True)
                raise
        return {'id': ref}


def save(payload, owner, ref=None, admin=False):
    with image_lock().sync(), database() as db:
        existing = request_row(db, ref) if ref else None
        if existing:
            author(existing, owner, admin)
        if len(set(payload.images)) != len(payload.images):
            fail('image_limits')
        old_images = {r['id'] for r in db.execute('SELECT id FROM images WHERE request_id=?', (ref,))} if ref else set()
        for image in payload.images:
            row = db.execute('SELECT * FROM images WHERE id=?', (image,)).fetchone()
            if row is None or (image not in old_images and (row['owner'] != owner or row['request_id'] is not None)):
                fail('image_type')
        if existing and existing['status'] == 'completed' and set(payload.images) - old_images:
            fail('completed_images')
        ref, now = ref or identifier(), time.time()
        if existing:
            db.execute('UPDATE requests SET title=?,description=?,category=?,updated=? WHERE id=?',
                       (payload.title.strip(), payload.description.strip(), payload.category, now, ref))
        else:
            db.execute('INSERT INTO requests (id,owner,nickname,title,description,category,created,updated) VALUES (?,?,?,?,?,?,?,?)',
                       (ref, owner, payload.nickname.strip(), payload.title.strip(), payload.description.strip(), payload.category, now, now))
        for image in payload.images:
            db.execute('UPDATE images SET request_id=? WHERE id=?', (ref, image))
        for image in old_images - set(payload.images):
            remove_image(db, image)
    return detail(ref, owner)


def delete(ref, owner='', admin=False):
    with image_lock().sync(), database() as db:
        author(request_row(db, ref), owner, admin)
        for row in db.execute('SELECT id FROM images WHERE request_id=?', (ref,)).fetchall():
            remove_image(db, row['id'])
        db.execute('DELETE FROM requests WHERE id=?', (ref,))
    return {'deleted': True}


def vote(ref, owner, value):
    with database() as db:
        request_row(db, ref)
        db.execute('DELETE FROM votes WHERE request_id=? AND owner=?', (ref, owner))
        if value:
            db.execute('INSERT INTO votes VALUES (?,?,?)', (ref, owner, value))
    return detail(ref, owner)


def comment(ref, owner, payload=None, comment_id=None, admin=False):
    with database() as db:
        request_row(db, ref)
        now = time.time()
        if comment_id:
            row = db.execute('SELECT * FROM comments WHERE id=? AND request_id=?', (comment_id, ref)).fetchone()
            if not row:
                fail('not_found', 404)
            author(row, owner, admin)
            if payload:
                db.execute('UPDATE comments SET message=?,updated=? WHERE id=?', (payload.message.strip(), now, comment_id))
            else:
                db.execute('DELETE FROM comments WHERE id=?', (comment_id,))
        else:
            db.execute('INSERT INTO comments VALUES (?,?,?,?,?,?,?)', (identifier(), ref, owner, payload.nickname.strip(), payload.message.strip(), now, now))
    return detail(ref, owner)


def set_status(ref, status):
    with database() as db:
        row = request_row(db, ref)
        completed = (row['completed'] or time.time()) if status == 'completed' else None
        db.execute('UPDATE requests SET status=?,completed=?,updated=? WHERE id=?', (status, completed, time.time(), ref))
    return detail(ref)


def storage():
    with database() as db:
        return {'used': db.execute('SELECT COALESCE(SUM(bytes),0) FROM images').fetchone()[0], 'limit': settings.feature_images_max_bytes}


def maintain():
    if not (BASE_DIR / settings.feature_requests_dir / 'board.sqlite3').exists():
        return
    with image_lock().sync(), database() as db:
        reconcile(db)
