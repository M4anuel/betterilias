"""Exercise production images with synthetic data and local HTTPS only.

Builds nothing unless --build is supplied. Creates a unique temporary Compose
project, then removes only that project's containers/networks/volumes.
"""
import argparse
import http.client
import json
import os
from pathlib import Path
import secrets
import socket
import ssl
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]


def command(args, *, env=None, input=None, check=True):
    result = subprocess.run(args, cwd=ROOT, env=env, input=input, text=True,
                            encoding='utf-8', errors='replace',
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if check and result.returncode:
        raise RuntimeError('Container command failed: ' + result.stderr[-6000:])
    return result


def free_port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--build', action='store_true')
    parser.add_argument('--image-prefix', default='betterilias-local')
    parser.add_argument('--tag', default='smoke')
    args = parser.parse_args()
    if args.build:
        for component in ('backend', 'frontend'):
            print('Building ' + component, flush=True)
            command(['docker', 'build', '-f', f'deploy/{component}.Dockerfile',
                     '-t', f'{args.image_prefix}-{component}:{args.tag}', '.'])
    for component in ('backend', 'frontend'):
        details = json.loads(command(['docker', 'image', 'inspect',
            f'{args.image_prefix}-{component}:{args.tag}']).stdout)[0]
        assert details['Config']['User'] == '10001:10001'
        assert not any(value.startswith('ADMIN_API_KEY=') for value in details['Config']['Env'])
    print('Images run without root; no administrator key baked in.', flush=True)
    project = 'betterilias-smoke-' + secrets.token_hex(6)
    for listing in (['ps', '-aq'], ['volume', 'ls', '-q'], ['network', 'ls', '-q']):
        existing = command(['docker', *listing, '--filter', f'label=com.docker.compose.project={project}']).stdout.strip()
        assert not existing
    with tempfile.TemporaryDirectory(prefix=project) as directory:
        temporary = Path(directory)
        admin_key = secrets.token_urlsafe(32)
        private = temporary / 'backend.env'
        private.write_text('ADMIN_API_KEY=' + admin_key + '\n', encoding='utf-8')
        private.chmod(0o600)
        https_port = free_port()
        values = dict(IMAGE_PREFIX=args.image_prefix, IMAGE_TAG=args.tag,
                      APP_DOMAIN='localhost', ACME_EMAIL='smoke@example.invalid',
                      BIND_ADDRESS='127.0.0.1', HTTP_PORT=str(free_port()),
                      HTTPS_PORT=str(https_port), BACKEND_ENV_FILE=str(private))
        env = {**os.environ, **values}
        env_file = temporary / 'compose.env'
        env_file.write_text('\n'.join(f'{key}={value}' for key, value in values.items()) + '\n', encoding='utf-8')
        compose = ['docker', 'compose', '--project-name', project, '--env-file', str(env_file),
                   '--file', str(ROOT / 'deploy/compose.yaml')]

        def run(*arguments, **kwargs):
            return command([*compose, *arguments], env=env, **kwargs)

        # Only this script's localhost address uses an untrusted, temporary CA.
        context = ssl._create_unverified_context()
        base = f'https://localhost:{https_port}'

        def request(path, method='GET', body=None, headers=None):
            connection = http.client.HTTPSConnection('localhost', https_port, context=context, timeout=15)
            try:
                connection.request(method, path, body=body, headers=headers or {})
                response = connection.getresponse()
                return response.status, dict((key.lower(), value) for key, value in response.getheaders()), response.read()
            finally:
                connection.close()

        def ready():
            for _ in range(180):
                try:
                    if request('/health')[0] == 200:
                        return
                except (OSError, http.client.HTTPException):
                    pass
                time.sleep(1)
            raise RuntimeError('Local HTTPS did not become ready')

        try:
            run('config', '--quiet')
            print('Starting isolated production stack with local HTTPS.', flush=True)
            run('up', '-d', '--wait', '--wait-timeout', '180', '--pull', 'missing')
            ready()
            assert request('/')[0] == 200
            status, headers, _ = request('/admin')
            assert status == 308 and headers['location'] == '/admin/'
            assert request('/admin/')[0] == 200
            assert request('/admin/not-a-file')[0] == 404
            assert request('/api/calendar')[0] == 401
            assert request('/api/system/logs')[0] == 404
            assert json.loads(request('/api/auth/status')[2])['authenticated'] is False
            assert 'no-store' in request('/api/auth/status')[1]['cache-control']
            print('Frontend/admin routing, production guards and anonymous isolation passed.', flush=True)
            status, headers, _ = request('/api/feature-requests/identity', 'POST', headers={'X-Community-Request': '1'})
            assert status == 200
            community_cookie = headers['set-cookie']
            assert all(flag in community_cookie for flag in ('Secure', 'HttpOnly', 'SameSite=strict', 'Path=/api/feature-requests'))
            community = {'Cookie': community_cookie.split(';', 1)[0], 'X-Community-Request': '1', 'Content-Type': 'application/json'}
            png = bytes.fromhex('89504e470d0a1a0a0000000d4948445200000002000000020802000000fdd49a730000001249444154789c6364686860606060620003000baa0104e42a59070000000049454e44ae426082')
            status, _, body = request('/api/feature-requests/images', 'POST', png, community)
            assert status == 200
            image = json.loads(body)['id']
            status, _, body = request('/api/feature-requests', 'POST', json.dumps({
                'title': 'Container smoke request', 'description': 'Synthetic public board content.', 'images': [image]}), community)
            assert status == 200
            community_ref = json.loads(body)['id']
            media_url = json.loads(body)['images'][0]['variants'][0]['url']
            status, headers, image_body = request(media_url)
            assert status == 200 and headers['content-type'] == 'image/webp' and image_body
            assert 'max-age=3600' in headers['cache-control'] and 'no-store' not in headers['cache-control']
            assert request(media_url, headers={'If-None-Match': headers['etag']})[0] == 304
            status, _, body = request('/api/feature-requests/' + community_ref + '/vote', 'PUT', '{"value":1}', community)
            assert status == 200 and json.loads(body)['score'] == 1
            assert request('/api/feature-requests/' + community_ref, 'DELETE', headers={'X-Community-Request': '1'})[0] == 403
            print('Public community ownership, image optimisation/cache and voting passed.', flush=True)
            status, headers, body = request('/api/admin/session', 'POST', json.dumps({'key': admin_key}),
                {'Content-Type': 'application/json', 'X-Admin-Request': '1'})
            assert status == 200 and json.loads(body)['authenticated']
            cookie = headers['set-cookie']
            assert all(value in cookie for value in ('Secure', 'HttpOnly', 'SameSite=strict', 'Path=/api/admin'))
            admin = {'Cookie': cookie.split(';', 1)[0]}
            assert request('/api/admin/summary', headers=admin)[0] == 200
            seed = """from pathlib import Path
from backend.auth.session import SessionManager
SessionManager('smoke-tenant').save_cookies({'PHPSESSID': 'synthetic-not-a-live-ilias-cookie'})
assert not Path('/app/.env').exists()
assert not Path('/app/.git').exists()
assert not Path('/app/tests').exists()
import importlib.util
assert importlib.util.find_spec('pytest') is None
assert importlib.util.find_spec('playwright') is None
"""
            run('exec', '-T', 'backend', 'python', '-', input=seed)
            status, _, body = request('/api/calendar/subscription/rotate', 'POST',
                headers={'X-Session-Id': 'smoke-tenant'})
            assert status == 200
            calendar = json.loads(body)
            assert calendar['download_url'].startswith(base + '/')
            token = calendar['token']
            assert request('/api/calendar', headers={'X-Session-Id': 'unknown-tenant'})[0] == 401
            run('exec', '-T', 'backend', 'python', '-c',
                "from pathlib import Path; assert Path('/data/.calendar/tokens.json').exists(); assert Path('/data/.sessions').is_dir()")
            print('Secure admin cookie, forwarded HTTPS and private persistent paths passed.', flush=True)
            run('restart', 'backend')
            ready()
            assert json.loads(request('/api/admin/session', headers=admin)[2])['authenticated']
            assert request('/api/calendar/feed/' + token + '.ics')[0] == 200
            assert request('/api/calendar')[0] == 401
            assert json.loads(request('/api/feature-requests/' + community_ref)[2])['score'] == 1
            assert request(media_url)[0] == 200
            run('run', '--rm', '--no-deps', 'maintenance', 'once')
            events = run('exec', '-T', 'backend', 'python', '-m', 'backend.diagnostics', 'events', '--limit', '200').stdout
            assert token not in events and admin_key not in events
            print('Restart persistence, tenant isolation and maintenance passed.', flush=True)
            sentinel = 'PRIVATE_REQUEST_SENTINEL_' + secrets.token_hex(8)
            run('stop', 'backend')
            status, _, _ = request('/api/unavailable?private=' + sentinel,
                headers={'X-Session-Id': sentinel, 'Cookie': 'secret=' + sentinel})
            assert status == 502
            logs = run('logs', '--no-color', 'caddy').stdout
            assert sentinel not in logs and token not in logs
            print('Proxy failure does not persist private request details.', flush=True)
        finally:
            # This project name was generated and checked empty above. Never
            # run this command against the operator's production project.
            run('down', '--volumes', '--remove-orphans', check=False)
    print('Container smoke checks passed; temporary stack and data removed.', flush=True)


if __name__ == '__main__':
    main()
