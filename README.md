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
| Synchronized playback, controls, preferences and limitations | [Podcast player](docs/PODCAST_PLAYER_PLAN.md), [controls and verification](docs/PLAYER_CONTROLS_REFINEMENT.md) |
| TA allocations, submission bundles and reviewed feedback return | [TA workflow and original design](docs/TA_WORK_DISTRIBUTION_PLAN.md) |
| Production mode, session isolation and shared-worker constraints | [Deployment security](docs/DEPLOYMENT_SECURITY.md) |
| Responsive navigation, sidebar layouts and loading conventions | [UI refinement](docs/MOBILE_UI_REFINEMENT.md) |
| Contribution, branching and publishing rules | [AGENTS.md](AGENTS.md) |

The support inventory describes implemented behavior. TODO contains open work;
feature plans distinguish current implementation from retained design/research.
In **development mode**, exact REST routes and schemas come
from the running backend's [Swagger UI](http://127.0.0.1:8000/docs),
[ReDoc](http://127.0.0.1:8000/redoc) or
[OpenAPI schema](http://127.0.0.1:8000/openapi.json). These are disabled in production.

## Current features

- Browse semesters, courses, repository containers, folders and supported course
  sessions. Search materials across discovered subfolders, download files, and
  view supported rich text, mathematics, tables, columns and embedded PDFs.
- Upload/delete student assignment submissions and use supported assignment-team
  controls. TAs can grade submissions, manage feedback/instruction attachments,
  and create/edit/reorder/delete assignments inside an existing exercise.
- Divide correction work between named TAs, save per-submission allocation markers
  through native batch tutor notes, and download assignment, unassigned or per-TA
  ZIP bundles with live download progress and feedback templates. Preview
  folder/ZIP feedback, resolve unmatched recipients
  and file conflicts, then publish through native feedback handlers.
- Combine semester courses in a calendar and weekly timetable, with course colours,
  custom recurring rules, and .ics export/private subscription feeds.
- Enter **Manage this page** to create folders, upload course files, review and
  delete files/folders, and save native shared ordering. Creation controls stay
  out of normal browsing; management follows folder navigation within a course.
- Course uploads use a queue with up to three concurrent workers, license
  explanations, circular activity indicators and independent outcomes. Folder
  deletion requires a contents review and cascade acknowledgement.
- Discover and sort podcast episodes and play supported native Paella MP4
  recordings with synchronized camera/slides, three layouts, screen swapping,
  independent quality controls, chapter previews, supplied subtitles and
  canvas-only fullscreen. Player preferences and resume positions persist locally
  per session. Unsupported configurations retain the exact native ILIAS link.
- Search and filter all course/group memberships, reverse their sort order, and
  pin favourites locally. Semester-filter options come from the actual memberships.
- Use German or English, light/dark mode, accent colors, course nicknames/icons,
  card/list semester views, and personal block-order/visibility preferences.
- Navigate with bookmarks, browser history and mouse back/forward buttons.
  Escape goes back within BetterIlias; consecutive presses within 700 ms return
  to the semester overview. Dialogs, menus, editing and fullscreen take priority.
  Unsaved edits/order drafts and pending writes use navigation guards.
- Keep custom sidebar dividers and course positions per semester. The compact
  rail preserves row/icon positions; primary labels/icons share one foreground
  colour, with the selected item in the accent colour and secondary text muted.
- Render cached content while refreshing it, receive course-update notifications,
  and review persistent TA grading feedback. Optional **ILIAS Saver** in settings
  skips background refresh while cached data is within your chosen TTL; manual
  refresh still fetches fresh content.
- Page fetches use one visible sync animation, including cached revalidation and
  nested session/feedback loads. Loading placeholders and refresh buttons stay static.

Support is scoped, not complete ILIAS parity. Only file/folder repository creation
is enabled. Exercise-container creation, rename/move/copy, and native page-element
editing remain open work. **Text and layout** in Add content explicitly opens the
native ILIAS editor when available. See the inventory for per-type limitations.

In the open video player, **Space** toggles playback, **F** toggles canvas
fullscreen, **M** toggles mute and **C** toggles supplied captions. The overlay
settings hold stream quality; the layout/swap controls choose which stream is
shown. Timeline chapter markers provide slide previews and seeking.

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

To run the servers separately, activate the environment, set `APP_ENV=development`
and use `python run.py` in one terminal and `npm --prefix frontend run dev` in
another. Playwright Chromium is used for browser regression tests; extension
session sync does not launch it.

Optional backend settings are in [.env.example](.env.example). Copy it to a
local `.env` to override defaults. If you change the API host/port, also update
the development proxy in [frontend/vite.config.ts](frontend/vite.config.ts).
See the [development guide](docs/DEVELOPMENT.md#local-configuration-and-api-inspection)
for configuration and verification details.

## Authenticate

### Browser extension

1. Install the companion extension using the instructions for
   [Chrome/Edge/Brave](extensions/chrome/README.md) or
   [Firefox](extensions/firefox/README.md).
2. Log into [Uni Bern ILIAS](https://ilias.unibe.ch) normally, including SWITCH
   edu-ID/2FA when required.
3. With BetterIlias running, open the extension and choose **Sync session with
   BetterIlias** / **Sitzung mit BetterIlias synchronisieren**.
4. Open the app. When the session expires, repeat the sync.

The app sends the resulting session ID with API requests. Both browser extensions
support German/English and light/dark appearance. Firefox temporary installations
must be loaded again after restarting Firefox.

### Extension-only login and deployment mode

The local browser-login helper and manual cookie input have been removed. Use
the companion to connect an authenticated ILIAS session. Anonymous requests never
inherit another user's session, including in development.

`APP_ENV` defaults to `production`; `python start.py` explicitly starts a
development backend. Set `APP_ENV=development` when running `python run.py`
manually for local work. Maintenance dump endpoints and API docs are available
only in development. Production needs same-origin HTTPS for frontend and `/api`.
See [deployment security](docs/DEPLOYMENT_SECURITY.md) for storage mounts,
shared-worker coordination, and the remaining multi-host limitations.

## Connect a phone

On the desktop, open settings and choose **Handy verbinden → QR-Code anzeigen**.
Scan the code within 60 seconds; each code connects once. Both devices use the same ILIAS session;
sync again on the desktop after expiry. Logging out ends that shared session.

For local development, set `APP_ENV=development`, then run `python run.py` and
`npm --prefix frontend run dev -- --host 0.0.0.0`. Enter a reachable desktop LAN
address such as `http://192.168.1.20:5173` in the QR panel. The phone cannot use
the desktop's `localhost`. The desktop must stay running and reachable; Vite
proxies API requests, so the backend can remain bound to localhost.

The QR code is generated locally. Its fragment carries a single-use connection
code, not the session ID. The app clears the fragment before claiming the code
through `/api/auth/claim`; codes expire after 60 seconds. Native downloads use an
HttpOnly cookie, while API requests normally send the session ID in a header.
Share it only with devices you intend to give access to that session.

## Development and troubleshooting

Follow [AGENTS.md](AGENTS.md) for contribution rules and
[DEVELOPMENT.md](docs/DEVELOPMENT.md) for required checks, optional browser tests,
translation changes and scraper-repair procedures.

When native ILIAS markup changes, consult the
[private diagnostics guide](docs/OBSERVABILITY_PRIVACY.md). Parser artifacts are
metadata-only by default; raw HTML needs explicit development opt-in and has
bounded retention. The `/api/system/logs` viewer is development-only. Capture
de-identified evidence and add a regression instead of guessing a native form or
treating an unverified write as successful.

Server operators can use the separate [administrator dashboard](docs/ADMIN_DASHBOARD.md)
at `/admin/` after configuring its independent administrator key. It shows
sanitized diagnostic events and operational metrics using short-lived admin
sessions, separate from student authentication.
