"""Production companion packaging preserves isolation and both browser bridges."""
import json
from pathlib import Path
import runpy
import zipfile

import pytest

HELPERS = runpy.run_path(str(Path(__file__).resolve().parents[1] / 'scripts/package_companions.py'))


@pytest.mark.parametrize('origin', ['http://app.example.com', 'https://name:password@app.example.com',
    'https://app.example.com/path', 'https://app.example.com?token=private', 'https://app.example.com:8443',
    'https://*.example.com', 'https://127.0.0.1', 'https://localhost', 'https://app.example.com\nother'])
def test_production_companions_reject_ambiguous_or_overbroad_origins(origin):
    with pytest.raises(ValueError):
        HELPERS['production_origin'](origin)


def test_companion_packages_use_exact_origin_and_preserve_firefox_bridge(tmp_path):
    output = HELPERS['package']('https://App.Example.com/', tmp_path / 'output')
    for browser in ('chrome', 'firefox', 'safari'):
        root = output / browser
        manifest = json.loads((root / 'manifest.json').read_text())
        assert 'https://app.example.com/*' in manifest['host_permissions']
        assert 'https://app.example.com/*' in manifest['content_scripts'][0]['matches']
        assert 'https://*/*' not in manifest['host_permissions']
        assert 'http://localhost/*' not in manifest['host_permissions']
        assert manifest['content_scripts'][0]['matches'] == ['https://app.example.com/*']
        if browser == 'safari':
            assert 'https://app.example.com' in (root / 'config.js').read_text()
            assert manifest['content_scripts'][1]['matches'] == ['https://ilias.unibe.ch/*']
            assert manifest['version'] == '1.1.1'
        else:
            assert 'https://app.example.com' in (root / 'popup.html').read_text()
            assert 'https://app.example.com' in (root / 'content.js').read_text()
            assert manifest['version'] == '1.0.1'
        with zipfile.ZipFile(output / f'betterilias-{browser}.zip') as archive:
            assert 'manifest.json' in archive.namelist()
            assert 'icon32.png' in archive.namelist()
            assert 'icon1024.png' in archive.namelist()
            for info in archive.infolist():
                assert info.create_system == 3
                if info.is_dir():
                    assert (info.external_attr >> 16) & 0o777 == 0o755
                else:
                    assert (info.external_attr >> 16) & 0o777 == 0o644
    safari_manifest = json.loads((output / 'safari/manifest.json').read_text())
    assert safari_manifest['background'] == {'scripts': ['config.js', 'core.js', 'background.js']}
    firefox_manifest = json.loads((output / 'firefox/manifest.json').read_text())
    assert firefox_manifest['browser_specific_settings']['gecko']['id'] == 'betterilias-companion@betterilias.ch'
    assert firefox_manifest['browser_specific_settings']['gecko']['data_collection_permissions'] == {
        'required': ['authenticationInfo']
    }
    assert firefox_manifest['browser_specific_settings']['gecko_android']['strict_min_version'] == '142.0'
    firefox = (output / 'firefox/content.js').read_text()
    assert 'wrappedJSObject' in firefox and 'cloneInto' in firefox
    assert 'BETTERILIAS_SESSION_SYNCED' in firefox
    with pytest.raises(ValueError):
        HELPERS['package']('https://other.example.com', output)


def test_independent_safari_artifact_and_validation(tmp_path):
    root = Path(__file__).resolve().parents[1]
    validate = runpy.run_path(str(root / 'scripts/validate_safari_package.py'))['validate']
    output = HELPERS['package']('https://selfhost.example.com', tmp_path / 'safari', 'safari')
    assert not (output / 'chrome').exists() and not (output / 'firefox').exists()
    report = validate(output / 'betterilias-safari.zip')
    assert report['version'] == '1.1.1' and report['native_apple_validation'] == 'not run'
    assert report['name'] == 'Better Ilias Companion'
    assert len(report['sha256']) == 64
    assert report == json.loads((output / 'betterilias-safari.validation.json').read_text())
    manifest = json.loads((output / 'safari/manifest.json').read_text())
    assert manifest['host_permissions'] == ['https://ilias.unibe.ch/*', 'https://selfhost.example.com/*']
    assert manifest['content_scripts'][1]['matches'] == ['https://ilias.unibe.ch/*']
    manifest_path = output / 'safari/manifest.json'
    original = manifest_path.read_text()
    manifest['background']['persistent'] = False
    manifest_path.write_text(json.dumps(manifest))
    with pytest.raises(ValueError, match='persistent key'):
        validate(output / 'safari')
    manifest_path.write_text(original)
    (output / 'safari/core.js').unlink()
    with pytest.raises(ValueError, match='Missing or remote resource'):
        validate(output / 'safari')


def test_safari_validator_rejects_invalid_archive_roots_and_paths(tmp_path):
    root = Path(__file__).resolve().parents[1]
    validate = runpy.run_path(str(root / 'scripts/validate_safari_package.py'))['validate']
    for name in ('nested/manifest.json', '../manifest.json', 'Manifest.json'):
        archive = tmp_path / 'bad.zip'
        with zipfile.ZipFile(archive, 'w') as zf:
            info = zipfile.ZipInfo(name)
            info.create_system = 3; info.external_attr = 0o100644 << 16
            zf.writestr(info, '{}')
        with pytest.raises(ValueError):
            validate(archive)


def test_caddyfile_and_deploy_env_configure_betterilias_ch_and_www_redirect():
    root = Path(__file__).resolve().parents[1]
    caddyfile = (root / 'deploy' / 'Caddyfile').read_text(encoding='utf-8')
    assert 'www.{$APP_DOMAIN}' in caddyfile
    assert 'redir https://{$APP_DOMAIN}{uri} permanent' in caddyfile

    deploy_env = (root / 'deploy' / 'deploy.env.example').read_text(encoding='utf-8')
    assert 'APP_DOMAIN=betterilias.ch' in deploy_env
    assert 'ACME_EMAIL=manuel@betterilias.ch' in deploy_env

