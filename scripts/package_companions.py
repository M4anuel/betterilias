"""Create Chrome/Firefox packages for one exact production HTTPS origin.

Does not modify the development extensions or publish to either browser store.
"""
import argparse
import json
from pathlib import Path
import shutil
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]


def production_origin(value):
    try:
        if not isinstance(value, str) or any(ord(char) <= 32 or ord(char) == 127 for char in value):
            raise ValueError
        parsed = urlsplit(value)
        if (parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password
                or parsed.port not in (None, 443) or parsed.path not in ('', '/') or parsed.query or parsed.fragment):
            raise ValueError
        host = parsed.hostname.encode('idna').decode('ascii')
        import ipaddress
        try:
            ipaddress.ip_address(host)
        except ValueError:
            pass
        else:
            raise ValueError
        if '.' not in host or any(not label or not all(c.isalnum() or c == '-' for c in label)
                                  or label.startswith('-') or label.endswith('-') for label in host.split('.')):
            raise ValueError
        return 'https://' + host
    except (ValueError, UnicodeError):
        raise ValueError('Use one HTTPS domain origin, without a path, credentials or nonstandard port.') from None


def package(origin, output):
    origin = production_origin(origin)
    output = Path(output).resolve()
    if output.exists() and any(output.iterdir()):
        raise ValueError('Output directory must be empty; existing packages are never overwritten.')
    if any(output == path or output.is_relative_to(path) for path in (ROOT / 'extensions', ROOT / 'frontend', ROOT / 'backend')):
        raise ValueError('Choose an output directory outside the source trees.')
    output.mkdir(parents=True, exist_ok=True)
    for browser in ('chrome', 'firefox'):
        target = output / browser
        shutil.copytree(ROOT / 'extensions' / browser, target,
                        ignore=shutil.ignore_patterns('.env*', '*.env', '__pycache__', '*.zip'))
        for path in target.rglob('*'):
            if path.suffix not in ('.js', '.html'):
                continue
            content = path.read_text(encoding='utf-8')
            content = content.replace('http://localhost:8000', origin).replace('http://localhost:5173', origin)
            path.write_text(content, encoding='utf-8')
        path = target / 'manifest.json'
        manifest = json.loads(path.read_text(encoding='utf-8'))
        pattern = origin + '/*'
        manifest['host_permissions'] = [item for item in manifest['host_permissions']
                                        if item not in ('http://localhost/*', 'http://127.0.0.1/*')]
        manifest['host_permissions'].append(pattern)
        for script in manifest['content_scripts']:
            script['matches'] = [pattern]
        path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        shutil.make_archive(str(output / ('betterilias-' + browser)), 'zip', target)
    return output


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--app-origin', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    try:
        package(args.app_origin, args.output)
    except ValueError as exc:
        parser.error(str(exc))
    print('Created matching Chrome/Firefox packages; store signing/publication is separate.')


if __name__ == '__main__':
    main()
