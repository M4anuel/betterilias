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
    assert safari_manifest['background'] == {'service_worker': 'background.js'}
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


def test_caddyfile_and_deploy_env_configure_betterilias_ch_and_www_redirect():
    root = Path(__file__).resolve().parents[1]
    caddyfile = (root / 'deploy' / 'Caddyfile').read_text(encoding='utf-8')
    assert 'www.{$APP_DOMAIN}' in caddyfile
    assert 'redir https://{$APP_DOMAIN}{uri} permanent' in caddyfile

    deploy_env = (root / 'deploy' / 'deploy.env.example').read_text(encoding='utf-8')
    assert 'APP_DOMAIN=betterilias.ch' in deploy_env
    assert 'ACME_EMAIL=manuel@betterilias.ch' in deploy_env

