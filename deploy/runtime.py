"""Production-only container startup and private retention maintenance."""
import os
from pathlib import Path
import sys
import time


def main():
    os.umask(0o077)
    os.environ['APP_ENV'] = 'production'
    os.environ['CAPTURE_FAILED_HTML'] = 'false'
    os.chdir('/data')
    Path('/data/.tmp').mkdir(mode=0o700, exist_ok=True)
    mode = sys.argv[1] if len(sys.argv) > 1 else 'api'
    if mode == 'api':
        try:
            workers = int(os.environ.get('WEB_CONCURRENCY', '1'))
            if not 1 <= workers <= 8:
                raise ValueError
        except ValueError:
            print('WEB_CONCURRENCY must be an integer between 1 and 8.', file=sys.stderr)
            return 2
        # Only Caddy can reach this unpublished port. It overwrites forwarded
        # headers; trusting them preserves HTTPS calendar/feed URLs.
        os.execv(sys.executable, [sys.executable, '-m', 'uvicorn', 'backend.main:app',
            '--host', '0.0.0.0', '--port', '8000', '--workers', str(workers),
            '--no-access-log', '--proxy-headers', '--forwarded-allow-ips', '*'])
    if mode not in ('maintain', 'once'):
        print('Expected api, maintain or once.', file=sys.stderr)
        return 2
    from backend.diagnostics import main as prune
    while True:
        result = prune(['prune'])
        if mode == 'once':
            return result
        if result:
            return result  # let the restart policy expose/retry maintenance failure
        time.sleep(3600)


if __name__ == '__main__':
    raise SystemExit(main())
