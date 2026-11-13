"""Safari API simulation; native macOS/iOS validation remains separate."""
from pathlib import Path
import shutil
import subprocess
import pytest


def test_safari_client_lifecycle_and_isolation():
    node = shutil.which('node')
    if not node:
        pytest.skip('Node is required for the Safari API harness')
    root = Path(__file__).resolve().parents[1]
    result = subprocess.run([node, '--test', str(root / 'tests/safari-extension.test.mjs')],
                            capture_output=True, text=True, encoding='utf-8', timeout=45)
    assert result.returncode == 0, result.stdout + result.stderr


def test_locale_generation_does_not_overwrite_safari_client():
    node = shutil.which('node')
    if not node:
        pytest.skip('Node is required for the locale generator')
    root = Path(__file__).resolve().parents[1]
    resources = [root / 'extensions/safari' / name for name in
                 ('manifest.json', 'config.js', 'core.js', 'background.js', 'content.js', 'ilias.js', 'popup.html', 'popup.css', 'popup.js')]
    before = [path.read_bytes() for path in resources]
    result = subprocess.run([node, 'scripts/sync-extension-locales.mjs'], cwd=root, capture_output=True, text=True, encoding='utf-8')
    assert result.returncode == 0, result.stdout + result.stderr
    assert before == [path.read_bytes() for path in resources]
