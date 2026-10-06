# Project Plan & Architecture: Local ILIAS Alternative (Uni Bern)

## 1. Architecture & Tech Stack

* **Backend (The Scraper & API):** Python 3.13+ with FastAPI and Uvicorn.
* **HTTP Client:** `httpx` (async) with session cookie injection and streaming file proxies.
* **Browser Automation:** Playwright Chromium (Python). Used *only* for the initial SWITCH edu-ID login.
* **Parsing:** BeautifulSoup 4 + `lxml`. Fast, deterministic DOM parsing.
* **Frontend:** React + Vite + TypeScript + Tailwind CSS (v4) + Lucide Icons.
* **Performance & Caching:** Stale-While-Revalidate (SWR) with `localStorage` persistence for instant (0ms) course access.
* **Communication:** REST API bridging the Python backend and React frontend (proxied via Vite).

---

## 2. Implementation Status & Development Phases

### Phase 1: The Auth Workaround (SWITCH edu-ID) — [COMPLETED]

* [x] **Interactive Login Script (`login.py` & `backend/auth/playwright_login.py`):** Launches a headed Chromium browser navigating to Uni Bern ILIAS, pauses for manual 2FA/MFA login.
* [x] **Session Extraction:** Detects when URL reaches the ILIAS dashboard, extracts `PHPSESSID`, `ilClientId`, and domain cookies.
* [x] **Cookie Persistence (`backend/auth/session.py`):** Saves session to `session_cookies.json` and creates authenticated `httpx.AsyncClient` instances.
* [x] **Session Validation:** Endpoint `GET /api/auth/status` verifies active sessions against ILIAS.

### Phase 2: Read-Only Scraper (GET Requests) — [COMPLETED]

* [x] **Uni Bern Semester View (`GET /api/dashboard/semesters`):**
  * Parses Uni Bern's custom `iliLubModsSemesterGUI` plugin.
  * Extracts active semester (`HS2026`), available semesters (`FS2027`, `HS2026`, `FS2026`, etc.), departments (*Informatik*, *Betriebswirtschaftslehre*), and course button actions (`<button data-action="...">`).
* [x] **Personal Desktop Courses (`GET /api/dashboard/courses`):** Parses legacy and modern ILIAS personal desktops.
* [x] **Course Materials & Repository (`GET /api/courses/{course_id}/materials`):**
  * Extracts folder trees, files, PDFs, exercises, podcasts, and web links.
  * Supports Uni Bern `/go/{type}/{ref_id}` short links.
  * Smart breadcrumb parsing with `dir="rtl"` reversal for natural top-down hierarchy.
* [x] **File Streaming Proxy (`GET /api/materials/{ref_id}/download`):** Streams file downloads directly through the authenticated session.
* [x] **Exercise Overview & Sub-Assignments (`GET /api/exercises/{exercise_id}/overview`):** Scrapes student assignments, remaining time, and edit deadlines.
* [x] **Error Handling & AI Protocol (`backend/scrapers/dumper.py`):**
  * Every parser wrapped in `@safe_parser`.
  * If parsing crashes or structure breaks, automatically dumps raw HTML to `logs/failed_html_dump_[context]_[timestamp].html`.
  * System endpoints `GET /api/system/logs` to inspect dumps.

### Phase 3: The Write-Path (POST Requests for TAs) — [COMPLETED]

* [x] **Form Scraping (`backend/scrapers/forms.py`):** Scrapes grading forms, hidden fields, and CSRF tokens (`rtoken`, `cmdNode`, `cmd[saveStatus]`).
* [x] **TA Submissions Table (`GET /api/exercises/{exercise_id}/submissions`):** Scrapes participant tables, submitted files, upload times, marks, and feedback. Supports modern `cmdClass=ilexercisemanagementgui&cmd=members`.
* [x] **Grading Endpoint (`POST /api/exercises/{exercise_id}/submissions/{member_id}/grade`):** Submits grading payload and verifies response success message.

### Phase 4: Modern Frontend UI — [COMPLETED]

* [x] **Zero-Latency Serving (SWR):** Instantly renders cached course materials from `localStorage` in 0ms while revalidating silently in the background.
* [x] **Branding & Top Bar (`Header.tsx`):** Uni Bern crest (`uᵇ`) routing home, live session badge, and 1-click SWITCH login button.
* [x] **Collapsible Sidebar (`Sidebar.tsx`):** Left navigation for enrolled courses with collapse/expand toggle, custom course icons, and bottom-only edit flow.
* [x] **Custom Course Nicknames & 20 Icons (`NicknameModal.tsx` & `CourseIcon.tsx`):** Allows users to customize course names and select from 20 academic icons (Code, Brain, Database, Palette, Calculator, etc.), persisted in `localStorage`.
* [x] **Compact Smart Breadcrumbs (`CompactBreadcrumbs.tsx`):**
  * Filters out redundant ILIAS levels (`Repository`, `Fakultät`, `Vorlesung`).
  * Displays: `Start › [Subject: Informatik] › [Semester: HS2026] › [Nickname] › [Folder Path]`.
* [x] **Semester Start Page & Historical Archive (`SemesterView.tsx`):**
  * Quick-access pills for recent semesters + comprehensive dropdown archive supporting semesters back to 2021 (supporting studies beginning in 2022).
  * Selection presaved in `localStorage` with intelligent default to current semester (`HS2026`) rather than future `FS2027`.
  * Race-condition protection preventing out-of-order state glitches during rapid switching.
  * "Zuletzt geöffnet" (Resume last lecture) hero card and category course grid with custom icons.
* [x] **Course Content Explorer & Formatting Engines (`CourseView.tsx`):**
  * In-place subfolder navigation & direct PDF/slides download buttons.
  * **Structured Sections & Accordions (P&O style):** Parses and displays multi-part courses with expandable/collapsible accordions and categorized item groups (Folien, Übungen, Reflexionstexte).
  * **Rich Text & MathML (Graph Theory style):** Renders syllabi, suggested literature, and mathematical formulas using MathJax 3 (`tex-mml-chtml.js`) with dynamic React typeset lifecycle hooks.
  * **Course Activity Feed ("Logs"):** Scrapes recent course updates from ILIAS news block (`aside.il_right_col`), displayed as a sleek scrollable activity log (`CourseLogsPanel.tsx`) on the right side with timestamps, action targets, and max-height for ~5 items.
  * **Opencast Lecture Podcasts (`backend/scrapers/podcasts.py` & `PodcastModal.tsx`):**
    * Multi-page pagination traversal: automatically combines recordings from pages 0, 1, etc.
    * Smart ordering: streamable/recorded episodes appear first, followed by future scheduled sessions.
    * Modal viewer with filters ("Aufnahmen", "Geplant", "Alle"), quick episode search, and 1-click video streaming.
  * Live Votings detection with external ILIAS redirect.
  * Interactive client-side search/filter bar across all sections and flat files.
  * **Autofill Heuristic Shield:** Neutralized Chrome's vehicle license plate ("Kfz-Kennzeichen") autofill bug in nickname modals.

### Phase 6: Course Sessions ("Sitzungen"), Log Accumulation & VS Code Notification System — [COMPLETED]

* [x] **Course Sessions / Drawers (`SessionDrawer.tsx` & `backend/scrapers/materials.py`):**
  * Parses ILIAS course sessions (`sess`) with dates, times, topics, and nested downloadable files (slides, literature, quizzes).
  * Ultra-compact horizontal/drawer cards consuming minimal vertical space.
  * Interactive filters: "Alle" vs. "Mit Dateien". Expandable drawers with 1-click material download.
* [x] **Log Cache Merging & Dedicated History Fetching (`backend/scrapers/logs.py`, `CourseLogsPanel.tsx`, `cache.ts`):**
  * Solved the 5-item limitation by scraping the dedicated `showNews` paginated endpoint (`backend/api/routes/materials.py` -> `GET /api/courses/{course_id}/logs?page={n}`).
  * Non-destructive cache accumulation: merges incoming logs with locally cached historical entries by message text/ID without re-fetching old items.
  * Added "Ältere Logs abrufen" button to load older pages on demand.
* [x] **Podcast Dialog Instant Caching (`cache.ts` & `PodcastModal.tsx`):**
  * Instant (0ms) load from `localStorage` on dialog open, with background SWR revalidation.
  * Dispatches notification if new podcast episodes are discovered.
* [x] **VS Code-Style Bottom-Right Toast Notifications (`NotificationToast.tsx` & `App.tsx`):**
  * Automatic diffing on background revalidation: detects newly uploaded materials, sessions, session attachments, podcasts, or activity logs.
  * Modern floating toast positioned at bottom right, disappearing automatically after 10 seconds with animated progress indicator.
  * Pause-on-hover timer and manual 'X' dismiss button.
  * Single change displays directly; multiple changes display a collapsible summary with a `ChevronUp` fold-out arrow.

---

## 3. Project Directory Structure

```text
IliasAlternative/
├── start.py                      # Unified launcher: starts backend + frontend concurrently
├── start.bat                     # Windows double-click runner
├── run.py                        # Standalone backend runner
├── login.py                      # Standalone Playwright login helper
├── plan.md                       # Architecture & implementation status
├── README.md                     # Complete project documentation
├── requirements.txt              # Python dependencies
├── .env.example                  # Environment configuration template
│
├── backend/                      # Python FastAPI API & Scrapers
│   ├── config.py                 # Pydantic settings & paths
│   ├── schemas.py                # Pydantic data schemas
│   ├── main.py                   # FastAPI app, middleware & error handlers
│   ├── auth/
│   │   ├── session.py            # SessionManager (cookies & httpx client)
│   │   └── playwright_login.py   # Playwright SWITCH edu-ID login automation
│   ├── scrapers/
│   │   ├── dumper.py             # Error dumper (@safe_parser) & AI maintenance tools
│   │   ├── semester.py           # Uni Bern iliLubModsSemesterGUI parser
│   │   ├── dashboard.py          # Personal Desktop scraper
│   │   ├── materials.py          # Course materials, sessions, rich text & activity logs scraper
│   │   ├── logs.py               # Paginated activity logs / showNews scraper
│   │   ├── podcasts.py           # Opencast / Mediacast series & pagination scraper
│   │   ├── submissions.py        # Exercise assignments & TA submissions scraper
│   │   └── forms.py              # Grading form CSRF & POST parser
│   ├── services/
│   │   └── ilias_client.py       # High-level async client & streaming download proxy
│   └── api/
│       └── routes/               # Modular REST API endpoints
│           ├── auth.py
│           ├── dashboard.py
│           ├── materials.py
│           ├── exercises.py
│           └── system.py
│
├── frontend/                     # React + Vite + TypeScript + Tailwind CSS UI
│   ├── src/
│   │   ├── components/
│   │   │   ├── Header.tsx              # Top bar with Uni Bern branding & auth badge
│   │   │   ├── Sidebar.tsx             # Collapsible course nav with nicknames & custom icons
│   │   │   ├── SemesterView.tsx        # Start screen with semester tabs & course cards
│   │   │   ├── CourseView.tsx          # Material explorer with PDF downloads & search
│   │   │   ├── SessionDrawer.tsx       # Compact session cards with expandable material drawers
│   │   │   ├── CourseLogsPanel.tsx     # Activity logs / News panel with cache merge & pagination
│   │   │   ├── PodcastModal.tsx        # Opencast episodes modal (cached 0ms + live SWR)
│   │   │   ├── NotificationToast.tsx   # VS Code-style bottom-right toast with fold-out drawer
│   │   │   ├── CompactBreadcrumbs.tsx  # Filtered smart breadcrumbs
│   │   │   ├── CourseIcon.tsx          # 20 selectable academic icons
│   │   │   └── NicknameModal.tsx       # Dialog for editing course nicknames & icons
│   │   ├── lib/
│   │   │   ├── api.ts                  # Typed client for backend REST API
│   │   │   └── cache.ts                # SWR engine, podcast & accumulated logs cache
│   │   ├── types.ts                    # TypeScript interface definitions
│   │   ├── App.tsx                     # Main layout & state orchestration
│   │   ├── index.css                   # Tailwind CSS styling
│   │   └── main.tsx                    # React mount
│   ├── vite.config.ts                  # Vite config with API proxying
│   ├── tsconfig.json
│   └── package.json
│
├── tests/                        # Automated Pytest suite (28 passing tests)
│   ├── conftest.py
│   ├── test_api.py
│   ├── test_dumper.py
│   ├── test_parsers.py
│   ├── test_unibe_real_dumps.py
│   └── fixtures/
│       ├── unibe/                      # Real Uni Bern HTML test fixtures
│       └── *.html
```

---

## 4. The AI Maintenance Protocol

*When Uni Bern updates ILIAS and a scraper breaks, follow these exact steps:*

### Step 1: Capture the Evidence

Check your `logs/` folder for `failed_html_dump_[context]_[timestamp].html` (or view it via `GET /api/system/logs`).

### Step 2: The Universal AI Prompt

Copy and paste the following prompt into Gemini:

> **System Context:** You are an expert Python web scraping engineer. I am maintaining a backend API that scrapes my university's ILIAS system (Uni Bern). The DOM structure has changed, and my previous scraping function is broken.
>
> **Task:** Rewrite the BeautifulSoup parsing logic to extract the required data from the new HTML structure.
>
> **Rules:**
> 1. Use reliable selectors (IDs, `name` attributes, or data attributes if available). Avoid highly specific CSS class chains if possible.
> 2. Ensure all data is extracted into a clean list of dictionaries (JSON-ready).
> 3. Return ONLY the updated Python function.
>
> **Old (Broken) Python Function:**
> ```python
> [Paste your current, broken function here]
> ```
>
> **New Target HTML Structure (from failed dump):**
> ```html
> [Paste the raw HTML dump snippet here]
> ```
>
> **Desired JSON Output Structure:**
> ```json
> [Provide an example of what the frontend expects]
> ```

### Step 3: Implement and Test

Paste the AI-generated function back into the respective file in `backend/scrapers/`, run `pytest`, and restart the server.
