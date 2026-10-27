# Development and scraper maintenance

Start with [README](../README.md) for installation and authentication. Follow
[AGENTS.md](../AGENTS.md) for binding branch, merge, verification, branding,
localisation and extension-parity rules. This guide explains the development
workflow without replacing those rules.

## Documentation ownership

| Question | Update/read |
| --- | --- |
| How do I install and use the app? | [README](../README.md) |
| What still needs implementation or verification? | [TODO](../TODO.md) — unfinished actions only |
| What does a specific ILIAS object/element actually do here? | [Support inventory](ILIAS_SUPPORT_MATRIX.md) |
| How does the existing implementation fit together? | [Architecture](ARCHITECTURE.md) |
| Why/how should a planned feature be built? | Its scoped plan, linked from TODO |
| What are the exact current REST routes and schemas? | The running backend's `/docs`, `/redoc` and `/openapi.json` |
| What changed previously? | Git history; the support inventory describes the current result |

When completing a task, update its current behavior in the inventory/README as
appropriate, then remove the finished backlog entry. Keep acceptance criteria and
protocol findings in feature plans rather than repeating them in TODO. Do not
present speculative routes, sample measurements or historical milestones as
implemented behavior.

Fixture READMEs stay beside their HTML evidence. Extension READMEs retain their
browser-specific installation instructions. Avoid copying those details into
additional status/plan files.

## Verification

From the repository root, run the required checks before committing/publishing:

```powershell
python -m pytest tests/
npm.cmd --prefix frontend run build
python -c "import ast; from pathlib import Path; ast.parse(Path('start.py').read_text(encoding='utf8')); print('Launcher syntax OK')"
```

The syntax check avoids starting the long-running launcher; `start.py` currently
does not implement a `--help` command. On Linux/macOS, use `npm` in place of
`npm.cmd`. Do not hard-code a passing-test count into the architecture/README;
the suite changes as features evolve.

Focused checks when relevant:

```powershell
python -m pytest tests/test_unibe_real_dumps.py -v
npm.cmd --prefix frontend run check:locales
npm.cmd --prefix frontend run test:i18n
node --test tests/ilias_saver.test.mjs
```

Browser regressions use the built frontend and mocked API/native workflows.
Install Playwright Chromium during setup, build first, then enable them:

```powershell
$env:BETTERILIAS_BROWSER_TESTS = '1'
python -m pytest tests/ -v
```

Set `$env:BETTERILIAS_BROWSER_CHANNEL = 'chrome'` to use installed Chrome instead
of bundled Chromium. On Linux/macOS:

```bash
BETTERILIAS_BROWSER_TESTS=1 python -m pytest tests/ -v
```

Some tests require optional local/private HTML dumps and skip when absent.
Committed fixtures and mock-native/browser tests do not establish live support
for every ILIAS installation. If the default temporary directory is unavailable,
pytest accepts a fresh writable `--basetemp` directory.

## Repairing a changed ILIAS page

1. Inspect `logs/failed_html_dump_*.html`, or use `/api/system/logs` and its
   dump-detail/raw endpoints. Treat dumps as session/user data when reviewing or
   sharing them; keep cookies and tokens out of committed fixtures.
2. Identify the affected parser, response model and native action. Compare the
   failing page with the corresponding fixture README and existing regressions.
3. Prefer stable native IDs, field names, classes and action URLs. Preserve
   unrelated layout, lecturer content and permission boundaries. Apply the
   authenticated-indicators-first rule from AGENTS.md.
4. For writes, inspect fresh forms and handlers rather than guessing a cmdNode,
   CSRF token, file field or confirmation URL. Preserve repeated fields and
   optional native defaults. Check for ILIAS validation errors and verify the
   resulting state. Avoid replaying a possibly successful destructive request.
5. Add a sanitized regression fixture and a test for the observed failure. Run
   the relevant focused checks and the full required verification, update the
   support inventory if behavior changed, then follow the Git workflow.

Assignment forms deserve particular care: empty file controls require explicit
empty filenames in multipart encoding, and attachments may use temporary upload
handlers before a final metadata save. See the committed
[TA creation](../tests/fixtures/ta_create_README.md),
[student upload](../tests/fixtures/student_upload_README.md),
[course authoring](../tests/fixtures/authoring/README.md) and
[management](../tests/fixtures/management/README.md) evidence notes.

A useful model-neutral repair brief is:

> Diagnose the supplied failing ILIAS HTML and the existing parser/workflow.
> Preserve session isolation, permission checks, lecturer content and unaffected
> behavior. Use the actual native controls, identify the smallest justified
> change, add a sanitized regression, verify the result, and document any
> unsupported cases. Include the current parser, failing HTML excerpt, expected
> schema/result and relevant test output. Do not invent a native write protocol.

## Localisation

The app and both extensions save language choices locally, initially follow the
browser, and fall back to English. Lecturer titles, instructions, dates and names
remain content; known ILIAS status/deadline labels use shared translations.

- Messages live in `locales/en.json` and `locales/de.json`. Add each new key to
  English and every fully supported language, retaining matching placeholders.
- `locales/languages.json` declares language names/locales and `full`/`partial`
  support. Partial catalogues fall back to English for missing/empty messages.
- The frontend build validates used keys/completeness/placeholders and generates
  both extensions' `i18n.js` and `_locales/` packages. Reload installed extensions
  after their generated packages change.
- App/extension API calls send `Accept-Language`; the backend negotiates it per
  request and returns `Content-Language`. Direct download links can pass `lang`.
  Requests without a supported preference use English; standalone parser/CLI
  calls retain the German default.
- Generated cached headings carry translation keys rather than translated layout
  IDs, so a language switch does not reorder or invalidate personal layouts.

Use `check:locales`, `test:i18n`, backend localisation tests and the opt-in
localisation browser regressions when changing language behavior.

## Local configuration and API inspection

Settings are loaded by [backend/config.py](../backend/config.py) from `.env` at
the repository root. Start with [.env.example](../.env.example). The settings
also include session/profile directories, HTTP timeout and user-agent defaults;
consult the settings class for the complete current list.

`run.py` uses the configured API host/port with reload enabled. The Vite dev
proxy currently targets `http://127.0.0.1:8000` in
[vite.config.ts](../frontend/vite.config.ts). Changing backend host/port also
requires updating that proxy. The launcher prints the standard development
URLs; it is not a production deployment configuration.

Use the running backend's Swagger `/docs`, ReDoc `/redoc` or `/openapi.json`
for exact route methods, request fields and response schemas. Route groups
cover authentication, dashboard/semesters, repository/materials, authoring and
management, podcasts, exercises/TA workflows, and failed-dump inspection. Keeping
a second hand-maintained endpoint table in README caused it to miss the newer
management endpoints, so the generated API schema is the reference.
