# BetterIlias

BetterIlias is a React application and FastAPI bridge for Uni Bern's ILIAS.
It uses your existing ILIAS session to read course content and perform supported
student and teaching-assistant workflows.

## Documentation

| Looking for | Read |
| --- | --- |
| Installation, authentication and everyday usage | This README |
| Current support for each object, page element and management operation | [ILIAS support inventory](docs/ILIAS_SUPPORT_MATRIX.md) |
| Unfinished implementation and verification tasks | [TODO](TODO.md) |
| Current architecture, sessions, cache and source map | [Architecture](docs/ARCHITECTURE.md) |
| Tests, localisation, configuration and scraper repair | [Development guide](docs/DEVELOPMENT.md) |
| Unified management design and future authoring adapters | [Management plan](docs/UNIFIED_MANAGEMENT_PLAN.md) |
| Planned synchronized camera/slides playback | [Podcast player plan](docs/PODCAST_PLAYER_PLAN.md) |
| Contribution, branching and publishing rules | [AGENTS.md](AGENTS.md) |

The support inventory describes implemented behavior. TODO contains open work;
feature plans explain the intended design. Exact REST routes and schemas come
from the running backend's [Swagger UI](http://127.0.0.1:8000/docs),
[ReDoc](http://127.0.0.1:8000/redoc) or
[OpenAPI schema](http://127.0.0.1:8000/openapi.json).

## Current features

- Browse semesters, courses, repository containers, folders and supported course
  sessions. Search materials across discovered subfolders, download files, and
  view supported rich text, mathematics, tables, columns and embedded PDFs.
- Upload/delete student assignment submissions and use supported assignment-team
  controls. TAs can grade submissions, manage feedback/instruction attachments,
  and create/edit/reorder/delete assignments inside an existing exercise.
- Enter **Manage this page** to create folders, upload course files, review and
  delete files/folders, and save native shared ordering. Creation controls stay
  out of normal browsing; management follows folder navigation within a course.
- Course uploads use a queue with up to three concurrent workers, license
  explanations, circular activity indicators and independent outcomes. Folder
  deletion requires a contents review and cascade acknowledgement.
- Discover and filter podcast episodes, open native episode streams, and play
  supported embedded Opencast recordings. Dual-stream synchronization is not
  implemented.
- Use German or English, light/dark mode, accent colors, course nicknames/icons,
  card/list semester views, and personal block-order/visibility preferences.
- Navigate with bookmarks, browser history and mouse back/forward buttons.
  Unsaved edits/order drafts and pending writes use navigation guards.
- Render cached content while refreshing it, receive course-update notifications,
  and review persistent TA grading feedback. Optional **ILIAS Saver** in settings
  skips background refresh while cached data is within your chosen TTL; manual
  refresh still fetches fresh content.

Support is scoped, not complete ILIAS parity. Only file/folder repository creation
is enabled. Exercise-container creation, rename/move/copy, and native page-element
editing remain open work. **Text and layout** in Add content explicitly opens the
native ILIAS editor when available. See the inventory for per-type limitations.

## Install and run locally

Prerequisites: Python 3.13+, npm, and Node.js supported by the installed Vite
release (currently `^20.19.0 || >=22.12.0`). Run commands from the repository root.

Windows PowerShell:

```powershell
python -m venv venv
.\venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python -m playwright install chromium
npm.cmd --prefix frontend ci
python start.py
```

Linux/macOS:

```bash
python -m venv venv
source venv/bin/activate
python -m pip install -r requirements.txt
python -m playwright install chromium
npm --prefix frontend ci
python start.py
```

You can also double-click `start.bat` on Windows after installing dependencies.
The launcher selects a working `venv` or `.venv`, checks imports, starts both
servers and opens the browser. It installs frontend packages if absent, but does
not create the Python environment or install backend dependencies.

Default URLs:

- App: `http://localhost:5173`
- API: `http://127.0.0.1:8000`; health check: `/health`

To run the servers separately, activate the environment and use `python run.py`
in one terminal and `npm --prefix frontend run dev` in another. Playwright Chromium
is used by the login helper and browser tests; ordinary extension session sync
does not launch it.

Optional backend settings are in [.env.example](.env.example). Copy it to a
local `.env` to override defaults. If you change the API host/port, also update
the development proxy in [frontend/vite.config.ts](frontend/vite.config.ts).
See the [development guide](docs/DEVELOPMENT.md#local-configuration-and-api-inspection)
for configuration and verification details.

## Authenticate

### Browser extension

1. Install the companion extension using the instructions for
   [Chrome/Edge/Brave](extension/README.md) or
   [Firefox](extension-firefox/README.md).
2. Log into [Uni Bern ILIAS](https://ilias.unibe.ch) normally, including SWITCH
   edu-ID/2FA when required.
3. With BetterIlias running, open the extension and choose **Sync session with
   BetterIlias** / **Sitzung mit BetterIlias synchronisieren**.
4. Open the app. When the session expires, repeat the sync.

The app sends the resulting session ID with API requests. Both browser extensions
support German/English and light/dark appearance. Firefox temporary installations
must be loaded again after restarting Firefox.

### Local interactive login helper

`python login.py` opens a browser **on the backend machine**, waits for your
manual SWITCH login and saves the legacy default `session_cookies.json`.
It does not refresh a tenant session already selected by the app. Use extension
sync for a session ID obtained from an extension or shared with a phone.

The API browser-login route can target the request's resolved tenant; manual
cookie routes also exist. Their contracts are documented by the generated API
schema. Session resolution/storage is explained in
[Architecture](docs/ARCHITECTURE.md#sessions-and-login).

## Connect a phone

On the desktop, open settings and choose **Handy verbinden → QR-Code anzeigen**.
Scan the code with the phone's camera. Both devices use the same ILIAS session;
sync again on the desktop after expiry. Logging out ends that shared session.

For local development, run `python run.py` and
`npm --prefix frontend run dev -- --host 0.0.0.0`. Enter a reachable desktop LAN
address such as `http://192.168.1.20:5173` in the QR panel. The phone cannot use
the desktop's `localhost`. The desktop must stay running and reachable; Vite
proxies API requests, so the backend can remain bound to localhost.

The QR code is generated locally. Its link carries the session key in the URL
fragment; the app stores the key and clears the fragment before loading content.
Share it only with devices you intend to give access to that session.

## Development and troubleshooting

Follow [AGENTS.md](AGENTS.md) for contribution rules and
[DEVELOPMENT.md](docs/DEVELOPMENT.md) for required checks, optional browser tests,
translation changes and scraper-repair procedures.

When native ILIAS markup changes, inspect `logs/failed_html_dump_*.html` or the
`/api/system/logs` endpoints. Capture sanitized evidence and add a regression
instead of guessing a native form or treating an unverified write as successful.
