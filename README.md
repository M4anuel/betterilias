# BetterILIAS - Backend & Frontend (Uni Bern)

A modern, high-performance REST API bridge, scraper engine, and React 19 web application for the University of Bern's ILIAS learning management system.

---

## 🚀 Key Features

* **Authentication & Multi-Tenant Session Sync:**
  * **BetterIlias Companion Extension (Manifest V3):** 1-click session cookie synchronization (`PHPSESSID`, `ilClientId`) directly from the Uni Bern ILIAS portal (`ilias.unibe.ch`) to the backend via `POST /api/auth/sync`. Supports light and dark mode out-of-the-box. Available for both **Google Chrome / Chromium** (`extension/`) and **Mozilla Firefox** (`extension-firefox/`).
  * **Multi-Tenant Architecture:** Isolated session storage keyed by `session_id`, forwarded seamlessly via `X-Session-ID` request headers, cookies, or query parameters. Allows multiple users/students to access a shared host independently.
  * **Interactive Browser Fallback:** Headed Playwright Chromium login assistant (`python login.py` or `POST /api/auth/login-browser`) handling SWITCH edu-ID 2FA/MFA.
  * **Async Requests:** Non-blocking HTTP client via `httpx`, session validation, and explicit session-expiry handling.

* **Browser History, Deep-Linking & Hardware Navigation (Mouse 4 & 5):**
  * **HTML5 History API Integration:** Instant SPA navigation using `window.history.pushState` and `popstate` for Semesters (`/?semester=HS2026`), Courses (`/?course=123`), Subfolders (`/?course=123&folder=456`), and Exercises (`/?course=123&exercise=789`).
  * **Mouse 4 & 5 Hardware Buttons:** Native side-button navigation (Back / Forward) as well as browser arrows (`Alt + ←` / `Alt + →`) work seamlessly across all views.
  * **Direct Bookmarking & F5 Reload:** Reloading the page or sharing links preserves the exact subfolder or open exercise without resetting to the course root.
  * **Modal Dismissal on Back:** Pressing Mouse 4 (Back) cleanly dismisses open modals (settings, nicknames, extension info) before traversing page history.
  * **Dynamic Document Titles:** Tab title updates dynamically (e.g. `BetterIlias – Lineare Algebra – Übungsblätter`) for crystal-clear browser history stacks.

* **Branding, Dark Mode & Visual Customization:**
  * **Complete Dark Mode Support:** Deep dark mode theming across all screens (Semester overview, Course view, Exercise view, Submissions, Modals, Breadcrumbs, MathJax/MathML math expressions, and imported ILIAS rich HTML).
  * **Custom Accent Colors:** Choose from 6 curated accent colors (Teal, Blue, Purple, Pink, Amber, Emerald) via the top-right settings dropdown, persisted in local storage.
  * **Independent Visual Identity:** Free of Uni Bern branding and logos; uses the modern BetterIlias logo and cohesive palette.
  * **Personalization:** Custom course nicknames, academic icons, filtered breadcrumbs, and a configurable starting semester for the course overview.

* **German & English Localisation:** App settings, status messages, API errors, and both extension popups follow the selected language. Lecturer-written titles and instructions retain their original language. See [Localisation](#localisation).

* **Adaptive Course Layouts & Modular Blocks:**
  * **Structure-Preserving Block Engine:** Preserves the lecturer's intended course layout (headings, drawers/accordions, podcasts, sessions, and materials).
  * **Flat, Clean Block Architecture:** Section headings render as clean visual dividers; drawers/modules remain clean top-level blocks without confusing nested accordion-in-accordion recursion.
  * **Content Extraction:** Removes unrelated ILIAS controls while preserving rich text, multi-column layouts, media, and responsive tables.
  * **Custom Block Ordering & Visibility:** Reorder blocks up and down, hide/show blocks, toggle a virtual "Alle Dateien" collector block, and automatically reset when ILIAS structure changes (layout hash detection).
  * **Dynamic Session Materials:** On-demand slide and attachment loading for closed session drawers via `expand_id` (`GET /api/courses/{course_id}/sessions/{session_id}/materials`).
  * **Native Live Voting (`xlvo`):** Automatically identifies live voting items and provides direct action links.

* **Student Exercise Submissions (Hand-In Workflow):**
  * **Assignment Overview & Details:** Deadlines, work instructions, mandatory assignment rules, and tutor feedback.
  * **Formatted Instructions:** Paragraphs, emphasis, lists, and links render in assignment dialogs, including dark mode.
  * **File Upload & Hand-In:** Follow ILIAS's native upload flow and confirm the submitted file before reporting success (`POST /api/exercises/{exercise_id}/assignment/{ass_id}/upload`).
  * **Manage & Delete Submissions:** View submitted files, direct downloads, and delete submissions (`DELETE /api/exercises/{exercise_id}/assignment/{ass_id}/submission/{delivered_id}`).
  * **Team Uploads:** Create and manage teams and members when the assignment offers Team Upload; individual assignments omit the team panel.

* **TA Assignment Management:**
  * Create, edit, reorder, and delete assignments inside an existing ILIAS exercise, subject to your ILIAS permissions.
  * Edit title, instructions, deadlines, grace period, mandatory status, and file limits; choose the submission type during creation. ILIAS fixes the type after creation.
  * Format instructions with active toolbar indicators, edit HTML, and insert links with display text and window options.
  * Attach instruction files directly, verify uploads, and retain failed queued attachments for retry.
  * Creating new exercise containers and folders remains planned; see [TODO.md](TODO.md).

* **TA Grading Automation & Correction Mode:**
  * **Participant & Submission Overview:** View student submissions, grading status, and uploaded files filtered by assignment.
  * **Advanced Multi-Filter Modal:** Customizable colored quick-filters (e.g. "Zu bewerten"), multi-select grade status (not graded, graded, passed, failed), radio submission filter, and multi-field sorting (submission date, name, grade).
  * **Unsaved Work Safety:** Submissions with unsaved edits remain visible in current filter views until explicitly saved, preventing accidental list-shifting.
  * **Automated Grade Submission:** Scrapes hidden CSRF tokens and form fields (`rtoken`, `cmdNode`), submits grades/marks, pass status, and feedback text (`POST /api/exercises/{exercise_id}/submissions/{member_id}/grade`).
  * **Feedback File Attachments:** Upload corrected files and evaluations directly to the student submission (`POST /api/exercises/{exercise_id}/submissions/{member_id}/feedback-files`).
  * **Client-Side SWR Caching:** Instant cache retrieval prevents UI flickering and race conditions during rapid assignment switching.

* **Opencast Podcasts & Media:**
  * Traverses multi-page pagination for Uni Bern Opencast lecture recordings (`GET /api/podcasts/{ref_id}`).
  * Prioritizes streamable recorded episodes before scheduled future recordings.
  * Resolves supported embedded Opencast recordings into native video playback, with a link back to ILIAS when needed.
  * Synchronized presenter/slides playback, layout switching, and bandwidth-saving controls remain on the roadmap in [TODO.md](TODO.md).

* **Modern React 19 Frontend:**
  * **Cached Rendering (SWR):** Renders cached courses, podcasts, and logs from `localStorage` while revalidating in the background.
  * **Repository-Wide Subfolder Search:** Searches across current folders and deep subfolders in real time with location breadcrumbs and filter pills.
  * **Bottom-Right Notification Toast:** Floating toast alerts user to new files, sessions, or podcasts detected during background revalidation.

* **The AI Maintenance Protocol:**
  * Automatic error-catching decorator (`@safe_parser`): Any DOM parsing failure automatically dumps raw HTML to `logs/failed_html_dump_[context]_[timestamp].html`.
  * Logs API (`GET /api/system/logs`) and browser viewer (`/api/system/logs/{filename}/raw`) for inspection and AI-assisted selector updates.

---

## 🛠️ Tech Stack

* **Backend:**
  * **Language:** Python 3.13+
  * **Web Framework:** FastAPI + Uvicorn
  * **HTTP Client:** `httpx` (async)
  * **Browser Automation:** Playwright (Chromium)
  * **HTML Parsing:** BeautifulSoup 4 + `lxml`
  * **Data Validation:** Pydantic v2 + Pydantic-Settings
  * **Testing:** Pytest + Pytest-Asyncio
* **Frontend:**
  * **Framework:** React 19 + TypeScript
  * **Build Tool:** Vite
  * **Styling:** Tailwind CSS v4
  * **Icons:** Lucide React
* **Browser Extensions:**
  * **Chrome Extension (`extension/`):** Manifest V3, 1-Click cookie synchronization, multi-tenant session support, light & dark theme.
  * **Firefox Extension (`extension-firefox/`):** Manifest V3 Gecko WebExtension, 1-Click cookie synchronization, multi-tenant session support, light & dark theme.

---

## 📦 Getting Started

### ⚡ Quick Start (Recommended)

Prerequisites: Python 3.13+, Node.js compatible with the installed Vite version
(currently `^20.19.0` or `>=22.12.0`), and npm. Run commands from the repository root.
Complete the dependency setup below first, then run both backend and frontend:
```bash
python start.py
```
*(Or simply double-click `start.bat` on Windows)*

The launcher uses a working `venv` or `.venv` when available, checks backend
imports, and installs frontend packages if `node_modules` is missing. It does
not create the Python environment or install backend dependencies. Open
`http://localhost:5173`, then sync your ILIAS session using the extension.

---

### Connect a phone

On the desktop, open the top-right settings menu, choose **Handy verbinden → QR-Code anzeigen**, and scan the code with the phone's camera. The phone uses the same ILIAS session without needing a browser extension. After the session expires, synchronize it again on the desktop. Logging out ends the shared session on both devices.

Both devices must reach the same BetterIlias installation. For local development, run the backend with `python run.py` and start the frontend with `npm --prefix frontend run dev -- --host 0.0.0.0`. Enter the desktop's reachable LAN address, such as `http://192.168.1.20:5173`, in the QR panel. `localhost` points to the phone itself and cannot be used here. The desktop must remain running and reachable on the network; the backend can remain bound to localhost because Vite proxies `/api`.

The QR code is generated locally. Its link contains the session key in the URL fragment; the app saves the key and removes it from the address bar before loading authenticated content. Only share the code with your own devices.

### Manual Setup

#### 1. Install Dependencies

```bash
# Windows PowerShell
python -m venv venv
.\venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python -m playwright install chromium
npm --prefix frontend ci
```

On Linux/macOS:
```bash
python -m venv venv
source venv/bin/activate
python -m pip install -r requirements.txt
python -m playwright install chromium
npm --prefix frontend ci
```

Chromium is used by the interactive login assistant and browser tests. Extension
session sync does not require launching Playwright. Optional settings are listed
in [.env.example](.env.example); create a local `.env` to override defaults.

#### 2. Run the Backend API

Keep the API running in its own terminal:

```bash
python run.py
```
* **Base URL:** `http://127.0.0.1:8000`
* **Interactive Swagger UI:** `http://127.0.0.1:8000/docs`
* **ReDoc:** `http://127.0.0.1:8000/redoc`

#### 3. Authenticate

There are two ways to authenticate your session:

##### Option A: BetterIlias Companion Extension (Recommended)

**For Google Chrome, Microsoft Edge, Brave:**
1. Open Chrome and navigate to `chrome://extensions/`.
2. Enable **"Developer mode"** in the top right corner.
3. Click **"Load unpacked"** and select the [`extension/`](extension/) directory.
4. Log into [ILIAS Uni Bern](https://ilias.unibe.ch) as usual.
5. With BetterIlias running, click the **BetterIlias Companion** extension icon and choose **"Sync session with BetterIlias"** (German: **"Sitzung mit BetterIlias synchronisieren"**).

**For Mozilla Firefox:**
1. Open Firefox and navigate to `about:debugging#/runtime/this-firefox`.
2. Click **"Load Temporary Add-on..."** (oder *„Temporäres Add-on laden...“*).
3. Select the `manifest.json` file inside the [`extension-firefox/`](extension-firefox/) directory. Temporary add-ons must be loaded again after restarting Firefox.
4. Log into [ILIAS Uni Bern](https://ilias.unibe.ch) as usual.
5. With BetterIlias running, click the **BetterIlias Companion** extension icon and choose **"Sync session with BetterIlias"** (German: **"Sitzung mit BetterIlias synchronisieren"**).

##### Option B: Interactive Browser Login Assistant

In another terminal with the Python environment activated:

```bash
python login.py
```
* A browser window will open displaying the Uni Bern ILIAS portal.
* Select **"Universität Bern"** and complete your SWITCH edu-ID login (including 2FA if prompted).
* Cookies are automatically saved, and the browser closes.

*(Alternatively, inject cookies via `POST /api/auth/cookies` or `POST /api/auth/sync`)*

#### 4. Run the React Frontend

In a separate terminal:
```bash
cd frontend
npm install
npm run dev
```
Open **`http://localhost:5173`** in your browser. All API requests are proxied to the backend.

---

## 📡 API Reference Overview

### Health & Core
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/health` | Service health status and ILIAS base URL |
| `GET` | `/` | Root endpoint with documentation links |

### Authentication (`/api/auth`)
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/auth/status` | Check if ILIAS session cookies are valid (supports tenant isolation) |
| `POST` | `/api/auth/sync` | Synchronize session cookies from either extension to an isolated session |
| `POST` | `/api/auth/mobile-session` | Create a session-sharing link for the phone QR workflow |
| `POST` | `/api/auth/login-browser` | Launch headed Playwright login window |
| `POST` | `/api/auth/cookies` | Set session cookies manually (`PHPSESSID`, `ilClientId`) |
| `POST` | `/api/auth/logout` | Clear stored session cookies for the current tenant |

### Dashboard & Semesters (`/api/dashboard`)
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/dashboard/courses` | List enrolled courses & groups from Personal Desktop |
| `GET` | `/api/dashboard/semesters` | List courses grouped by semester (optional `?semester=HS2026`) |

### Courses, Materials & Sessions (`/api`)
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/courses/{course_id}/materials` | Get course contents, modular blocks, headings, drawers, sessions, and activity logs |
| `GET` | `/api/courses/{course_id}/sessions/{session_id}/materials` | Load materials for a specific session drawer dynamically (`expand_id`) |
| `GET` | `/api/courses/{course_id}/logs` | Paginated activity history (`showNews`) with page counts |
| `GET` | `/api/materials/{ref_id}/download` | Stream and download material file (PDF, slides, archive) |
| `GET` | `/api/repository/{ref_id}` | Browse a repository container |
| `GET`, `POST` | `/api/courses/{course_id}/membership` | Read and submit the native course join/leave workflow |
| `GET` | `/api/courses/video-stream-info` | Resolve native playback information for a supported ILIAS video URL |

### Podcasts (`/api/podcasts`)
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/podcasts/{ref_id}` | Opencast / Mediacast episodes (auto-pagination, recorded episodes first, cached) |

### Exercises, Student Hand-Ins & TA Grading (`/api/exercises`)
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/exercises/{exercise_id}/overview` | Exercise sub-assignments, deadlines, remaining time & TA link |
| `GET` | `/api/exercises/{exercise_id}/info` | Exercise info screen (summary, pass criteria, instructions) |
| `GET` | `/api/exercises/{exercise_id}/assignment/{ass_id}` | Student assignment detail (instructions, submitted files, feedback) |
| `POST` | `/api/exercises/{exercise_id}/assignment/{ass_id}/upload` | Student upload submission file to ILIAS |
| `DELETE` | `/api/exercises/{exercise_id}/assignment/{ass_id}/submission/{delivered_id}` | Student delete submitted file from ILIAS |
| `POST` | `/api/exercises/{exercise_id}/assignment/{ass_id}/team/create` | Create an assignment team |
| `GET` | `/api/exercises/{exercise_id}/assignment/{ass_id}/team/candidates` | Find eligible team members |
| `POST` | `/api/exercises/{exercise_id}/assignment/{ass_id}/team/add` | Add team members |
| `POST` | `/api/exercises/{exercise_id}/assignment/{ass_id}/team/remove` | Remove team members |
| `DELETE` | `/api/exercises/{exercise_id}/assignment/{ass_id}/team` | Dissolve the team |
| `GET` | `/api/exercises/{exercise_id}/submissions` | List student submissions (TA grading view, filter by `ass_id`) |
| `POST` | `/api/exercises/{exercise_id}/submissions/{member_id}/grade` | Submit grade, points/mark, passed status & feedback (TA write-path) |
| `GET` | `/api/exercises/{exercise_id}/submissions/{member_id}/feedback-files` | List existing TA feedback files for a submission |
| `POST` | `/api/exercises/{exercise_id}/submissions/{member_id}/feedback-files` | Upload TA feedback file for a submission |
| `GET` | `/api/exercises/{exercise_id}/ta/assignments` | List assignments available to teaching assistants |
| `POST` | `/api/exercises/{exercise_id}/ta/assignments/order` | Save assignment ordering |
| `GET` | `/api/exercises/{exercise_id}/ta/assignment-detail` | Read assignment settings (`ass_id` for an existing assignment) |
| `POST` | `/api/exercises/{exercise_id}/ta/assignment-detail` | Create or update an assignment |
| `DELETE` | `/api/exercises/{exercise_id}/ta/assignments/{ass_id}` | Delete an assignment |
| `GET`, `POST` | `/api/exercises/{exercise_id}/ta/assignments/{ass_id}/instruction-files` | List or upload assignment attachments |
| `DELETE` | `/api/exercises/{exercise_id}/ta/assignments/{ass_id}/instruction-files/{file_id}` | Delete an assignment attachment |

### System & AI Maintenance (`/api/system`)
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/system/logs` | List all failed HTML scraping dumps |
| `GET` | `/api/system/logs/{filename}` | Retrieve raw dump details for AI debugging prompts |
| `GET` | `/api/system/logs/{filename}/raw` | View raw HTML dump directly in browser |
| `DELETE` | `/api/system/logs/{filename}` | Delete resolved dump file |

---

## 🧪 Running Tests

Run the full automated test suite:
```bash
python -m pytest tests/ -v
```

Run real UNIBE HTML dump parsing tests:
```bash
python -m pytest tests/test_unibe_real_dumps.py -v
```

Validate the frontend and shared translations:

```bash
npm --prefix frontend run build
npm --prefix frontend run test:i18n
```

Browser checks require a frontend build and Chromium. To include them in the
suite on Windows PowerShell:

```powershell
$env:BETTERILIAS_BROWSER_TESTS = '1'
python -m pytest tests/ -v
```

Set `BETTERILIAS_BROWSER_CHANNEL=chrome` to use installed Chrome instead of
Playwright Chromium. On Linux/macOS, use
`BETTERILIAS_BROWSER_TESTS=1 python -m pytest tests/ -v`.
Some optional integration tests require local private HTML dumps and skip when
those are absent. Portable parser and mock upload tests use committed fixtures
and do not create or modify live ILIAS assignments.

---

## Localisation

The app and both extension popups support German and English. Select a language
in the app settings or the extension popup. Each saves its preference locally;
the initial language follows the browser, with English as the fallback.
ILIAS course titles, instructions, dates, and names keep their original language.
Known ILIAS interface labels, such as deadline and grading statuses, follow the
selected app language. Generated course headings carry translation keys so
cached headings can switch language without changing course layout identifiers.

Shared messages live in `locales/en.json` and `locales/de.json`. Keys identify
source messages; `{name}` placeholders interpolate values without translating
user content. Add new keys to English and all fully supported languages.
Register languages in `locales/languages.json` with `name`, `locale`, and
`support: "full"` or `"partial"`. Partial languages fall back to English for
missing or empty entries in the frontend, backend and extensions.

`npm run build` in `frontend/` validates catalogues and placeholder consistency,
then regenerates both extensions' `i18n.js` and `_locales/` packages. Missing
entries in fully supported languages fail the build; partial languages emit
warnings. Reload installed extensions after updating their packaged files.
Run `npm run check:locales` or `npm run test:i18n` in `frontend/` for focused checks.

The app and extensions send `Accept-Language` on API requests. The backend
negotiates regional tags and quality values, isolates the language per request,
and returns `Content-Language`. Direct downloads include `?lang=...`. HTTP
requests without a supported preference use English; standalone parser/CLI
calls retain their existing German default.

Backend localisation tests are in `tests/test_localisation.py`. To run browser
checks after building the frontend, set `BETTERILIAS_BROWSER_TESTS=1` and run
`python -m pytest tests/test_localisation_browser.py`. Set
`BETTERILIAS_BROWSER_CHANNEL=chrome` to use an installed Chrome instead of
Playwright's bundled Chromium.

## 🤖 AI Maintenance Protocol

When Uni Bern updates the ILIAS version and an HTML parser breaks:

1. Check `GET /api/system/logs` or inspect the `logs/` directory for `failed_html_dump_[context]_[timestamp].html`.
2. Read [AGENTS.md](AGENTS.md) for contribution and verification rules; [plan.md](plan.md) contains the original maintenance workflow.
3. Inspect the failing HTML alongside the parser in `backend/scrapers/`, preserving account/session boundaries and the native ILIAS workflow.
4. Add a sanitised regression fixture and run the backend tests, frontend build, and localisation checks before committing.
