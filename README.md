# ILIAS Alternative - Backend (Uni Bern)

A modern, fast REST API bridge and scraper for the University of Bern's ILIAS learning management system.

## 🚀 Key Features

* **Phase 1: SWITCH edu-ID Authentication Workaround:**
  * Interactive browser login via Playwright Chromium (handles 2FA/MFA smoothly).
  * Captures and stores session cookies (`PHPSESSID`, `ilClientId`).
  * Seamless reuse of cookies in high-speed async HTTP requests (`httpx`).
* **Phase 2: Read-Only Scrapers (Fast DOM extraction via BeautifulSoup):**
  * **Dashboard / Courses (`GET /api/dashboard/courses`):** Extracts enrolled courses, groups, and links.
  * **Course Materials (`GET /api/courses/{course_id}/materials`):** Parses folders, slides, PDFs, tests, exercises, accordions, rich text (MathML/TeX), and course activity logs ("News").
  * **Course Sessions / Drawers:** Parses session schedules, dates, topics, and nested files (`SessionDrawer.tsx`).
  * **Opencast Podcasts (`GET /api/podcasts/{ref_id}`):** Parses Uni Bern Opencast lecture recordings, traverses multi-page pagination, and automatically prioritizes streamable recorded episodes before scheduled dates. Cached locally for 0ms loading.
  * **Exercise Submissions (`GET /api/exercises/{exercise_id}/submissions`):** Extracts student participant lists, submitted files, grades, and statuses.
  * **File Streaming Proxy (`GET /api/materials/{ref_id}/download`):** Authenticated streaming download for course materials and PDFs.
* **Phase 3: The Write-Path (TA Grading Automation):**
  * **Grade Submission (`POST /api/exercises/{exercise_id}/submissions/{member_id}/grade`):** Scrapes hidden form fields and CSRF tokens (`rtoken`, `cmdNode`), constructs the POST request, submits grades/feedback, and verifies ILIAS response.
* **Phase 4: Modern React 19 + TypeScript Frontend:**
  * **Zero-Latency Serving (SWR):** Instantly renders courses, podcasts, and logs from `localStorage` in 0ms while silently revalidating in the background.
  * **VS Code-Style Bottom-Right Notification Toast:** Floating toast alerts user to new files, sessions, or podcasts detected during background revalidation (10s auto-dismiss, progress bar, fold-out list).
  * **Compact Navigation:** Custom course nicknames, 20 selectable academic icons, clean filtered breadcrumbs, and full semester archives back to 2021.
* **The AI Maintenance Protocol:**
  * Automatic error-catching decorator (`@safe_parser`): Any DOM parsing failure automatically dumps raw HTML to `logs/failed_html_dump_[context]_[timestamp].html`.
  * Logs API (`GET /api/system/logs`) for easy inspection and copying into AI prompts when Uni Bern updates ILIAS markup.

---

## 🛠️ Tech Stack

* **Language:** Python 3.13+
* **Web Framework:** FastAPI + Uvicorn
* **HTTP Client:** `httpx` (async)
* **Browser Automation:** Playwright (Chromium)
* **HTML Parsing:** BeautifulSoup 4 + `lxml`
* **Data Validation:** Pydantic v2 + Pydantic-Settings
* **Testing:** Pytest + Pytest-Asyncio

---

## 📦 Getting Started

### ⚡ Quick Start (Recommended)

Run both backend and frontend together with a single command:
```bash
python start.py
```
*(Or simply double-click `start.bat` on Windows)*

---

### Manual Step-by-Step Setup

#### 1. Setup Virtual Environment

```bash
# Activate existing virtual environment (created during setup)
.\venv\Scripts\Activate.ps1
```

Or recreate manually:
```bash
python -m venv venv
.\venv\Scripts\pip.exe install -r requirements.txt
.\venv\Scripts\playwright.exe install chromium
```

### 2. Authenticate (Phase 1)

Launch the interactive login assistant:
```bash
python login.py
```
* A browser window will open displaying the Uni Bern ILIAS portal.
* Select **"Universität Bern"** and complete your SWITCH edu-ID login (including 2FA if prompted).
* Once you land on the dashboard, cookies are automatically extracted, saved to `session_cookies.json`, and the browser closes.

*(Alternatively, you can manually inject cookies via `POST /api/auth/cookies` or trigger browser login via `POST /api/auth/login-browser`)*

### 3. Run the Backend API

```bash
python run.py
```
The API server will start on:
* **Base URL:** `http://127.0.0.1:8000`
* **Interactive Swagger UI:** `http://127.0.0.1:8000/docs`

### 4. Run the React Frontend

In a second terminal:
```bash
cd frontend
npm run dev
```
Open **`http://localhost:5173`** in your browser. All API requests are automatically proxied to the backend.
* **ReDoc:** `http://127.0.0.1:8000/redoc`

---

## 📡 API Reference Overview

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/health` | Service health status |
| `GET` | `/api/auth/status` | Check if ILIAS session is valid |
| `POST` | `/api/auth/login-browser` | Launch Playwright login window |
| `POST` | `/api/auth/cookies` | Set session cookies manually |
| `POST` | `/api/auth/logout` | Clear stored session cookies |
| `GET` | `/api/dashboard/courses` | List enrolled courses & groups |
| `GET` | `/api/dashboard/semesters` | Uni Bern: list courses grouped by semester & department |
| `GET` | `/api/courses/{course_id}/materials` | Get folder & material contents (includes sections, sessions, rich text, and activity logs) |
| `GET` | `/api/courses/{course_id}/logs` | Paginated activity history (`showNews`) with total page counts |
| `GET` | `/api/podcasts/{ref_id}` | Opencast / Mediacast episodes (auto-pagination, recorded episodes first, cached) |
| `GET` | `/api/materials/{ref_id}/download` | Stream and download file |
| `GET` | `/api/exercises/{exercise_id}/overview` | Get exercise sub-assignments, deadlines & TA link |
| `GET` | `/api/exercises/{exercise_id}/submissions` | List student submissions (TA view) |
| `POST` | `/api/exercises/{exercise_id}/submissions/{member_id}/grade` | Submit grade & feedback (TA write-path) |
| `GET` | `/api/system/logs` | List failed HTML dumps for AI updates |
| `GET` | `/api/system/logs/{filename}` | Retrieve raw dump details |

---

## 🧪 Running Tests

Run the full automated test suite:
```bash
.\venv\Scripts\pytest.exe -v
```

---

## 🤖 AI Maintenance Protocol

When Uni Bern updates the ILIAS version and an HTML parser breaks:

1. Check `GET /api/system/logs` or inspect the `logs/` directory for `failed_html_dump_[context]_[timestamp].html`.
2. Follow **Section 3** of [`plan.md`](file:///c:/Users/manue/OneDrive/Dokumente/_Uni/IliasAlternative/plan.md) and copy the prompt template.
3. Paste the target HTML snippet and the current parser function into Gemini to get the updated selector logic.
4. Replace the function in `backend/scrapers/` and verify with `pytest`.

