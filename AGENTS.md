# AGENTS.md — Development Guidelines for AI Agents

This document defines the operating rules, git branching workflows, verification requirements, and architectural conventions for autonomous AI agents (Codex CLI, Google Antigravity, Claude Code, Cursor, etc.) contributing to the **BetterIlias** repository.

---

## 1. Multi-Agent Git Workflow & Branching Strategy

Multiple AI agents collaborate on this codebase asynchronously. Follow this branching protocol to avoid overwriting or clobbering each other's work:

### 1.1 Dedicated Agent Branches
* **Work on your designated branch/tree:**
  * Google Agent (Antigravity / Gemini): `agents/google`
  * OpenAI Codex CLI: `agents/codex`
  * Feature-specific tasks: `feat/<feature-name>` or `fix/<fix-name>`
* **Do not commit or push directly to `main` without testing and merging upstream first.**

### 1.2 Upstream Sync & Merge Before Push
Whenever you prepare to push your work or merge into `main`:
1. **Fetch the latest upstream commits:**
   ```bash
   git fetch origin
   ```
2. **Merge upstream `origin/main` into your working branch:**
   ```bash
   git merge origin/main
   ```
3. **Resolve any merge conflicts cleanly:**
   * Never blindly overwrite or discard work implemented by other agents or the human developer.
   * Preserve all existing features, tests, and comments.
4. **Never force-push (`git push --force`)** to `main` or any shared remote branches.

---

## 2. Mandatory Verification Protocol

Before committing and pushing any changes, you **must** run and pass all verification checks.

### 2.1 Backend Tests
Run the test suite to ensure no scrapers, endpoints, or session logic broke:
```bash
python -m pytest tests/
```
Or for real HTML dumps specifically:
```bash
python -m pytest tests/test_unibe_real_dumps.py -v
```
All tests must pass.

### 2.2 Frontend Build & TypeScript Check
Verify that the frontend compiles cleanly with 0 TypeScript or Vite bundling errors:
```bash
cd frontend
npm run build
cd ..
```
The build must succeed with zero errors.

### 2.3 Smoke Test Launcher
Ensure that the launcher script runs without syntax or import errors:
```bash
python start.py --help  # or verify python start.py syntax
```

---

## 3. Architecture & Core Implementation Rules

### 3.1 Tech Stack
* **Backend:** FastAPI + Uvicorn (Python 3.13+/3.14+), `httpx` (async HTTP client), BeautifulSoup 4 + `lxml`, Pydantic v2.
* **Frontend:** React 19, TypeScript, Vite, Tailwind CSS v4, Lucide React.
* **Browser Extensions:** Manifest V3 for Google Chrome (`extension/`) and Mozilla Firefox (`extension-firefox/`).

### 3.2 Multi-Tenant Session Architecture
* Sessions are isolated and keyed by `session_id`.
* The frontend stores `session_id` in `localStorage` under `betterilias_session_id` and forwards it to the backend via the `X-Session-Id` header (or cookie `betterilias_session`).
* The backend saves sessions to `.sessions/<session_id>.json`.
* Single-tenant local fallback: The backend also populates `session_cookies.json` / picks up the most recently synced session if no `X-Session-Id` is provided, preventing unauthenticated 401s during local development.

### 3.3 Safe Scraper Protocol & False-Positive Session Loss
* Wrap all DOM parsing functions with `@safe_parser` from `backend.scrapers.dumper` so unhandled HTML changes dump to `logs/failed_html_dump_*.html` rather than crashing silently.
* **Crucial Rule on Session Checks:** When checking if an ILIAS page response indicates a lost or expired session, **always check for positive authenticated indicators first** (e.g., user avatar, profile initials, main navigation bar).
  * *Reason:* Active student accounts may contain archived or closed courses that display badges or notices like `"Kein Zugriffsrecht"`. Do not perform global substring checks for `"kein zugriffsrecht"` across the entire HTML page before verifying whether the user is logged in.

### 3.4 Visual Identity & Dark Mode Constraints
* **No Uni Bern Proprietary Branding:** Do not use official Uni Bern logos, crests, or Uni Bern red branding.
* **Brand Identity:** Use BetterIlias branding:
  * Word "Better": `#033683`
  * Word "Ilias" / Primary Accent: `#0AACA5`
* **Full Dark Mode Support:** Every new component, modal, drawer, or badge must support both light mode and dark mode (`dark:...` classes in Tailwind CSS).

### 3.5 Browser Extension Parity
* If changes are made to the session sync endpoint (`POST /api/auth/sync`), cookie handling, or extension popup UX:
  * Update **both** the Chrome extension (`extension/`) and the Firefox extension (`extension-firefox/`).
  * In Firefox, remember that content scripts run in an Xray sandbox: write to `window.wrappedJSObject.localStorage` and dispatch custom DOM events (`BETTERILIAS_SESSION_SYNCED`) so the page React app detects the session.

---

## 4. Task Coordination & Commit Guidelines

### 4.1 Track Work in `TODO.md`
* Consult `TODO.md` before starting work to align on current priorities.
* Check off completed tasks (`[x]`) and keep unfinished items organized.

### 4.2 Conventional Commit Messages
Write clear, structured commit messages following Conventional Commits:
* `feat: ...` for new features or capabilities
* `fix: ...` for bug fixes and parser corrections
* `refactor: ...` for code reorganization without behavior change
* `docs: ...` for documentation updates
* `test: ...` for adding or improving automated tests

