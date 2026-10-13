# BetterILIAS - Backend & Frontend (Uni Bern)

A modern, high-performance REST API bridge, scraper engine, and React 19 web application for the University of Bern's ILIAS learning management system.

---

## 🚀 Key Features

* **Authentication & Multi-Tenant Session Sync:**
  * **BetterIlias Companion Extension (Manifest V3):** 1-click session cookie synchronization (`PHPSESSID`, `ilClientId`) directly from the Uni Bern ILIAS portal (`ilias.unibe.ch`) to the backend via `POST /api/auth/sync`. Supports light and dark mode out-of-the-box.
  * **Multi-Tenant Architecture:** Isolated session storage keyed by `session_id`, forwarded seamlessly via `X-Session-ID` request headers, cookies, or query parameters. Allows multiple users/students to access a shared host independently.
  * **Interactive Browser Fallback:** Headed Playwright Chromium login assistant (`python login.py` or `POST /api/auth/login-browser`) handling SWITCH edu-ID 2FA/MFA.
  * **High-Speed Async Requests:** Non-blocking HTTP client via `httpx` with automatic session validation and retry logic.

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
  * **Personalization:** Custom course nicknames, 20 selectable academic icons, clean filtered breadcrumbs, and full semester archives back to 2021.

* **Adaptive Course Layouts & Modular Blocks:**
  * **Structure-Preserving Block Engine:** Preserves the lecturer's intended course layout (headings, drawers/accordions, podcasts, sessions, and materials).
  * **Flat, Clean Block Architecture:** Section headings render as clean visual dividers; drawers/modules remain clean top-level blocks without confusing nested accordion-in-accordion recursion.
  * **HTML Sanitization:** Strips raw ILIAS container markup, table wrappers, and legacy action menus.
  * **Custom Block Ordering & Visibility:** Reorder blocks up and down, hide/show blocks, toggle a virtual "Alle Dateien" collector block, and automatically reset when ILIAS structure changes (layout hash detection).
  * **Dynamic Session Materials:** On-demand slide and attachment loading for closed session drawers via `expand_id` (`GET /api/courses/{course_id}/sessions/{session_id}/materials`).
  * **Native Live Voting (`xlvo`):** Automatically identifies live voting items and provides direct action links.

* **Student Exercise Submissions (Hand-In Workflow):**
  * **Assignment Overview & Details:** Deadlines, work instructions, mandatory assignment rules, and tutor feedback.
  * **File Upload & Hand-In:** Upload solution files directly from BetterILIAS (`POST /api/exercises/{exercise_id}/assignment/{ass_id}/upload`).
  * **Manage & Delete Submissions:** View submitted files, direct downloads, and delete submissions (`DELETE /api/exercises/{exercise_id}/assignment/{ass_id}/submission/{delivered_id}`).

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

* **Modern React 19 Frontend:**
  * **Zero-Latency Serving (SWR):** Instantly renders courses, podcasts, and logs from `localStorage` in 0ms while silently revalidating in the background.
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
* **Chrome Extension (`extension/`):**
  * **Manifest Version:** Manifest V3
  * **Features:** 1-Click cookie synchronization, multi-tenant session support, light & dark theme

---

## 📦 Getting Started

### ⚡ Quick Start (Recommended)

Run both backend and frontend together with a single command:
```bash
python start.py
```
*(Or simply double-click `start.bat` on Windows)*

---

### Manual Setup

#### 1. Setup Virtual Environment

```bash
# Windows PowerShell
.\venv\Scripts\Activate.ps1
```

Or recreate manually:
```bash
python -m venv venv
.\venv\Scripts\pip.exe install -r requirements.txt
.\venv\Scripts\playwright.exe install chromium
```

#### 2. Authenticate

There are two ways to authenticate your session:

##### Option A: BetterIlias Companion Extension (Recommended)
1. Open Chrome and go to `chrome://extensions/`.
2. Enable **"Developer mode"** in the top right corner.
3. Click **"Load unpacked"** and select the [`extension/`](file:///c:/Users/manue/OneDrive/Dokumente/_Uni/IliasAlternative/extension) directory (or download it from GitHub).
4. Log into [ILIAS Uni Bern](https://ilias.unibe.ch) as usual.
5. Click the **BetterIlias Companion** extension icon and click **"Sitzung jetzt synchronisieren"**.

##### Option B: Interactive Browser Login Assistant
```bash
python login.py
```
* A browser window will open displaying the Uni Bern ILIAS portal.
* Select **"Universität Bern"** and complete your SWITCH edu-ID login (including 2FA if prompted).
* Cookies are automatically saved, and the browser closes.

*(Alternatively, inject cookies via `POST /api/auth/cookies` or `POST /api/auth/sync`)*

#### 3. Run the Backend API

```bash
python run.py
```
* **Base URL:** `http://127.0.0.1:8000`
* **Interactive Swagger UI:** `http://127.0.0.1:8000/docs`
* **ReDoc:** `http://127.0.0.1:8000/redoc`

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
| `POST` | `/api/auth/sync` | Synchronize session cookies from the Chrome Extension to an isolated session |
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
| `GET` | `/api/exercises/{exercise_id}/submissions` | List student submissions (TA grading view, filter by `ass_id`) |
| `POST` | `/api/exercises/{exercise_id}/submissions/{member_id}/grade` | Submit grade, points/mark, passed status & feedback (TA write-path) |
| `GET` | `/api/exercises/{exercise_id}/submissions/{member_id}/feedback-files` | List existing TA feedback files for a submission |
| `POST` | `/api/exercises/{exercise_id}/submissions/{member_id}/feedback-files` | Upload TA feedback file for a submission |

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
pytest -v
```

Run real UNIBE HTML dump parsing tests:
```bash
pytest tests/test_unibe_real_dumps.py -v
```

---

## 🤖 AI Maintenance Protocol

When Uni Bern updates the ILIAS version and an HTML parser breaks:

1. Check `GET /api/system/logs` or inspect the `logs/` directory for `failed_html_dump_[context]_[timestamp].html`.
2. Follow **Section 3** of [`plan.md`](file:///c:/Users/manue/OneDrive/Dokumente/_Uni/IliasAlternative/plan.md) and copy the prompt template.
3. Paste the target HTML snippet and the current parser function into Gemini to get the updated selector logic.
4. Replace the function in `backend/scrapers/` and verify with `pytest`.
