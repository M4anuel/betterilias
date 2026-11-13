"""Validate Safari resources/ZIP structure without pretending to run Apple's build."""
import argparse
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path, PurePosixPath
import struct
import zipfile


class References(HTMLParser):
    def __init__(self):
        super().__init__()
        self.files = []

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        if tag in ('script', 'img', 'link'):
            value = values.get('href' if tag == 'link' else 'src')
            if value:
                self.files.append(value)


def validate(source):
    source = Path(source)
    if source.is_dir():
        files = {p.relative_to(source).as_posix(): p.read_bytes() for p in source.rglob('*') if p.is_file()}
    else:
        with zipfile.ZipFile(source) as archive:
            names = [item.filename for item in archive.infolist()]
            if len(names) != len(set(name.casefold() for name in names)):
                raise ValueError('Duplicate or case-colliding archive paths.')
            for item in archive.infolist():
                path = PurePosixPath(item.filename)
                if path.is_absolute() or '..' in path.parts or '\\' in item.filename or ':' in item.filename:
                    raise ValueError('Unsafe archive path.')
                if item.create_system != 3 or (item.external_attr >> 16) & 0o777 != (0o755 if item.is_dir() else 0o644):
                    raise ValueError('Expected portable Unix directory/file modes.')
            if archive.testzip() is not None:
                raise ValueError('Archive CRC failure.')
            files = {name: archive.read(name) for name in names if not name.endswith('/')}
    if 'manifest.json' not in files:
        raise ValueError('manifest.json must be at the archive root.')
    manifest = json.loads(files['manifest.json'])
    if manifest.get('manifest_version') != 3:
        raise ValueError('Expected the Safari Manifest V3 client.')
    background = manifest.get('background', {})
    if 'persistent' in background:
        raise ValueError('Apple packager rejects the persistent key; Manifest V3 is nonpersistent by default.')
    if 'service_worker' in background or not background.get('scripts'):
        raise ValueError('Expected the Safari Manifest V3 background scripts.')
    resources = list(background['scripts']) + [manifest['action']['default_popup']]
    resources.extend(manifest['icons'].values())
    resources.extend(manifest['action']['default_icon'].values())
    for script in manifest['content_scripts']:
        resources.extend(script['js'])
    parser = References()
    parser.feed(files['popup.html'].decode('utf-8'))
    resources.extend(parser.files)
    for name in resources:
        if name not in files or name.startswith(('/', 'http:', 'https:')):
            raise ValueError('Missing or remote resource: ' + name)
    for size, name in manifest['icons'].items():
        data = files[name]
        if data[:8] != b'\x89PNG\r\n\x1a\n' or struct.unpack('>II', data[16:24]) != (int(size), int(size)):
            raise ValueError('Incorrect icon dimensions: ' + name)
    if '1024' not in manifest['icons'] or files[manifest['icons']['1024']][25] != 2:
        raise ValueError('The 1024px master icon must be opaque RGB PNG.')
    for language in ('en', 'de'):
        messages = json.loads(files[f'_locales/{language}/messages.json'])
        if any(not messages.get(key, {}).get('message') for key in ('title', 'description')):
            raise ValueError('Missing manifest localisation.')
    for name in files:
        if name.endswith(('.js', '.html', '.css', '.json')):
            text = files[name].decode('utf-8')
            if text.startswith('\ufeff'):
                raise ValueError('UTF-8 BOM is not permitted: ' + name)
    if any(name in files for name in ('request.js', 'toolbar.js')):
        raise ValueError('Retired cross-browser runtime leaked into Safari package.')
    return {'name': manifest['name'], 'version': manifest['version'], 'files': len(files), 'bytes': sum(map(len, files.values())),
            'background': 'nonpersistent Safari page', 'native_apple_validation': 'not run',
            **({'sha256': hashlib.sha256(source.read_bytes()).hexdigest()} if source.is_file() else {})}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source')
    args = parser.parse_args()
    try:
        print(json.dumps(validate(args.source), indent=2))
    except (ValueError, KeyError, OSError, zipfile.BadZipFile) as exc:
        parser.error(str(exc))


if __name__ == '__main__':
    main()
