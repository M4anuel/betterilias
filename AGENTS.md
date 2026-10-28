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

### 3.5 Localisation
* Localise every user-facing label, hint, tooltip, accessibility label and application-generated error using the existing `t(...)` helpers and shared `locales/en.json` / `locales/de.json` catalogues. Translate known ILIAS interface messages (including deadline/status text); preserve lecturer content, titles, names and dates. Verify both languages and run `npm.cmd --prefix frontend run check:locales` when adding or changing strings.

### 3.6 Mobile Usability (Required for Every Feature)
**Every new feature and changed workflow must account for phones and tablets from the first implementation. User-facing functionality is complete only when its primary actions, forms and feedback are usable on phones, tablets and desktop.** This includes student, TA and course-management workflows, with loading, empty, error and confirmation states.

* **Design each breakpoint deliberately.** Check 320, 390 and 430 CSS px phone widths, tablet widths (including 768 px), desktop widths (including 1280 px) and short landscape viewports. Preserve compact desktop/tablet layouts when stacking controls on phones. Prevent page-wide horizontal overflow; contain wide tables, code and media in labelled, keyboard-accessible scrolling regions.
* **Use space and typography purposefully.** Keep titles readable relative to input text. Prioritise course names over identifiers and repeated metadata, using existing display-name helpers for course-code prefixes. Stack individual names vertically when needed; align related metadata and actions to use available card space. Keep ordering/reset controls in consistent positions when optional actions appear. Give feedback/comment fields sufficient space beside compact status controls. Preserve lecturer content, names and dates.
* **Keep navigation compact and selection comfortable.** Retain back navigation and current context; place secondary actions in accessible menus. A dropdown must be easy to open and select from. Give cramped phone selectors their own full-width row and aim for a height of at least 48 px. Keep the title readable instead of squeezing it beside a long selection label.
* **Make every action usable by touch and keyboard.** Aim for at least 44 x 44 CSS px touch targets, visible focus states and localised accessible names. Provide tap controls alongside drag-and-drop and tap access to explanations/actions exposed through hover. Match keyboard focus order to visual order at each breakpoint.
* **Separate hit areas from visual shapes.** A larger touch target must preserve a switch's pill-shaped track. Center icons against the actual control height, including inputs that grow on phones. Avoid blanket sizing or wrapping rules that distort controls or push modal close buttons onto another row. Respect reduced-motion preferences for animations.
* **Fit overlays to the visible viewport.** Reuse shared viewport/overlay styles for safe areas, browser chrome and the on-screen keyboard. Keep focused inputs, primary actions and a visible close control reachable; restore focus after closing. Support keyboard dismissal while providing touch dismissal and showing keyboard-only hints on appropriate layouts. Avoid Safari input zoom without disabling user zoom.
* **Preserve drafts and workflow state.** Keep form inputs mounted across resizing and rotation. Initialise editor drafts when opening, and reconcile new data without overwriting unsaved changes during parent rerenders or background refreshes. Scope edits, selections and caches to the relevant course, exercise or assignment IDs.
* **Support phone file and media workflows.** Use native file pickers, visible upload status/retry and usable PDF/video fallback links. Keep destructive confirmations and submission management usable within the phone viewport.
* **Verify behavior and appearance before completion.** Check German/English and light/dark mode, including longer translated labels. Inspect screenshots for density, alignment, readable text, unused space and clipping; overflow assertions alone are insufficient. Add focused browser regressions for changed mobile workflows and retain tablet/desktop coverage when responsive structures change. Exercise real interactions such as selecting options, reordering items and saving drafts/grades. Record which checks use emulation and which use real iOS Safari/Android Chrome; do not claim physical-device or live ILIAS validation from mocked tests.

Consult [`docs/MOBILE_UI_REFINEMENT.md`](docs/MOBILE_UI_REFINEMENT.md) for existing design decisions and failure causes. Reuse shared components/styles and the mobile browser regression fixtures when implementing related features.

### 3.7 Browser Extension Parity
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

### 4.3 Complete the Commit, Merge & Push Workflow
* Put completed changes into sensible, focused commits, each covering one coherent change. Separate unrelated work and use the Conventional Commit messages above; do not accumulate an entire session into one large commit.
* Once the task is ready and the required checks pass, finish the workflow in Sections 1 and 2: fetch upstream, merge `origin/main` into your designated branch, resolve conflicts while preserving others' work, and verify the combined result. Push your branch, then merge and push the tested changes to `main` using the repository's permitted workflow.
* Treat committing and publishing completed work as part of finishing the task, unless the user explicitly requests local-only work or a repository restriction prevents publication. Do not leave finished changes uncommitted or unpushed without explaining the concrete blocker.
* Never bypass failing checks, branch protections, or the prohibition on force-pushing. Report the resulting branch and commit IDs, verification results, and any remaining blockers.
