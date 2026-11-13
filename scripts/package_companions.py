"""Create Chrome/Firefox/Safari packages for one exact production HTTPS origin.

Does not modify the development extensions or publish to either browser store.
"""
import argparse
import json
from pathlib import Path
import shutil
from urllib.parse import urlsplit
import zipfile
import runpy

ROOT = Path(__file__).resolve().parents[1]
SAFARI_FILES = ('manifest.json', 'config.js', 'core.js', 'background.js', 'content.js', 'ilias.js',
                'popup.html', 'popup.css', 'popup.js', 'i18n.js', '_locales',
                'icon16.png', 'icon32.png', 'icon48.png', 'icon64.png', 'icon120.png', 'icon128.png',
                'icon152.png', 'icon167.png', 'icon180.png', 'icon256.png', 'icon512.png', 'icon1024.png')


def _write_unix_zip(source_dir, zip_path):
    source_dir = Path(source_dir)
    with zipfile.ZipFile(zip_path, 'w', compression=zipfile.ZIP_DEFLATED) as zf:
        for file_path in sorted(source_dir.rglob('*')):
            rel = file_path.relative_to(source_dir).as_posix()
            if file_path.is_dir():
                rel += '/'
                zinfo = zipfile.ZipInfo.from_file(file_path, arcname=rel)
                zinfo.create_system = 3
                zinfo.external_attr = 0o040755 << 16
                zf.writestr(zinfo, b'')
            else:
                zinfo = zipfile.ZipInfo.from_file(file_path, arcname=rel)
                zinfo.create_system = 3
                zinfo.external_attr = 0o100644 << 16
                zinfo.compress_type = zipfile.ZIP_DEFLATED
                zf.writestr(zinfo, file_path.read_bytes())



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


def package(origin, output, browser='all'):
    origin = production_origin(origin)
    output = Path(output).resolve()
    if output.exists() and any(output.iterdir()):
        raise ValueError('Output directory must be empty; existing packages are never overwritten.')
    if any(output == path or output.is_relative_to(path) for path in (ROOT / 'extensions', ROOT / 'frontend', ROOT / 'backend')):
        raise ValueError('Choose an output directory outside the source trees.')
    output.mkdir(parents=True, exist_ok=True)
    if browser not in ('all', 'chrome', 'firefox', 'safari'):
        raise ValueError('Choose all, chrome, firefox or safari.')
    for browser in (('chrome', 'firefox', 'safari') if browser == 'all' else (browser,)):
        target = output / browser
        if browser == 'safari':
            if origin == 'https://ilias.unibe.ch':
                raise ValueError('The BetterIlias server must differ from the ILIAS host.')
            target.mkdir()
            for name in SAFARI_FILES:
                source = ROOT / 'extensions/safari' / name
                if source.is_dir():
                    shutil.copytree(source, target / name)
                else:
                    shutil.copyfile(source, target / name)
            (target / 'config.js').write_text('globalThis.SafariCompanionConfig = Object.freeze(' +
                json.dumps({'serverUrl': origin, 'frontendUrl': origin}) + ');\n', encoding='utf-8')
            path = target / 'manifest.json'
            manifest = json.loads(path.read_text(encoding='utf-8'))
            manifest['host_permissions'] = ['https://ilias.unibe.ch/*', origin + '/*']
            manifest['content_scripts'][0]['matches'] = [origin + '/*']
            path.write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
            validate = runpy.run_path(str(ROOT / 'scripts/validate_safari_package.py'))['validate']
            validate(target)
            archive = output / 'betterilias-safari.zip'
            _write_unix_zip(target, archive)
            report = validate(archive)
            (output / 'betterilias-safari.validation.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
            continue
        shutil.copytree(ROOT / 'extensions' / browser, target,
                        ignore=shutil.ignore_patterns('.env*', '*.env', '__pycache__', '*.zip', '*.md', 'icon.svg'))
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
        _write_unix_zip(target, output / f'betterilias-{browser}.zip')
    return output


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--app-origin', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--browser', choices=('all', 'chrome', 'firefox', 'safari'), default='all')
    args = parser.parse_args()
    try:
        package(args.app_origin, args.output, args.browser)
    except ValueError as exc:
        parser.error(str(exc))
    print(f'Created {args.browser} companion package(s); store signing/publication is separate.')


if __name__ == '__main__':
    main()
