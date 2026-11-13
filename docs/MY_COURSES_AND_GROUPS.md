# My Courses and Groups Overview

BetterIlias provides a unified, searchable dashboard of all student and tutor course and group memberships, replacing ILIAS's fragmented membership views with instant filtering, semester categorization, and personal favorites.

---

## 1. Capabilities & Feature Matrix

| Capability | What BetterIlias Does | Technical Guarantee |
| :--- | :--- | :--- |
| **Comprehensive Membership List** | Fetches the full membership overview (`ilmembershipoverviewgui`) rather than just dashboard favorites. | Retrieves all enrolled courses and groups; closed or archived courses are marked without triggering false session-loss errors. |
| **Instant Search** | Fast, case-insensitive real-time filtering across course titles, codes, lecturer names, and descriptions. | Search runs instantly client-side without re-querying ILIAS on every keystroke. |
| **Semester Filtering** | Groups courses by extracted semester codes (e.g. `HS24`, `FS25`) with a "Without semester" fallback. | Semester options are populated dynamically from the user's active enrollments; undated items sort last in both directions. |
| **Favorites Pinning** | Dedicated "Favorites" section displayed at the top regardless of active sort order. | Users can pin/unpin items with an accessible star button; overrides persist locally per user session in browser storage. |
| **Multi-Directional Sorting** | Alphabetical (A–Z / Z–A) and Semester (Newest / Oldest) sorting. | Favorites section maintains its pinned position at the top; sorting applies within both sections. |
| **Offline Resilience** | Retains the last successfully loaded membership list if a background refresh encounters a network error. | Shows a non-intrusive retry prompt rather than wiping the view. |

---

## 2. Workflows & Display Organization (How-To)

### 2.1 Access and Navigation
- Accessible via the main sidebar under **My Courses & Groups** or via direct URL parameter `?view=my-courses`.
- Clicking any course or group navigates directly to its materials view, updating breadcrumbs and URL state.

### 2.2 Semester Categorization Logic
BetterIlias parses item titles using regex pattern matching for Swiss university semester codes:
- `HS\d{2}` / `FS\d{2}` (e.g. `HS24` = Autumn Semester 2024, `FS25` = Spring Semester 2025).
- Courses without explicit semester codes in their title are grouped under **"Without semester"**.
- Sorting by "Newest semester" places upcoming and current terms first.

### 2.3 Favorites & Persistence
- Initialized from ILIAS favorites on first load.
- Local toggles (star icon) take precedence and are persisted in `localStorage` under `betterilias_my_courses_<session_id>`.
- Star toggles preserve keyboard focus on the action button even when the card animates or moves into the pinned section.
- Preferences are strictly scoped by `session_id`; logging into a different account does not leak or reuse another student's favorites.

---

## 3. Architecture & Technical Constraints (Explanation)

### 3.1 Scraping & Safe Parsing
- In `backend/scrapers/membership.py`:
  - Parses the native ILIAS `ilmembershipoverviewgui` table using `@safe_parser`.
  - Normalizes course titles, clean display names (separating course codes from subject names), and direct reference links (`ref_id`).
  - Differentiates between regular courses and groups, applying distinct badge icons.
- Avoids global substring checks for `"Kein Zugriffsrecht"` across the entire HTML page, verifying positive login indicators first so closed/archived student courses do not trigger false session-expiry redirects.

### 3.2 Tenant Isolation
- User membership data is keyed strictly by the user's active session.
- Local preferences in `localStorage` use tenant-scoped keys to ensure that shared or multi-account browsers do not cross-contaminate favorites or filter states.

---

## 4. Source Code & References

- **Frontend View**: `frontend/src/components/MyCoursesView.tsx`
- **Backend Scraper**: [`backend/scrapers/membership.py`](../backend/scrapers/membership.py)
- **API Endpoint**: `GET /api/dashboard/memberships` in [`backend/api/routes/dashboard.py`](../backend/api/routes/dashboard.py)
- **Automated Tests**:
  - [`tests/test_my_courses.py`](../tests/test_my_courses.py) — Parser tests covering course/group types, semester extraction, native favorites, and closed-course badges.
  - [`tests/test_my_courses_browser.py`](../tests/test_my_courses_browser.py) — Headless Chromium browser tests covering search, semester filters, pin/unpin toggles, focus retention, and responsive viewports (320–1280 px).

---

## Appendix: Retained Historical Notes

*(Preserves initial prompt and review findings from early development.)*
- Original goal: Provide an instant, searchable membership overview matching the native ILIAS "My Courses and Groups" page with client-side search, semester tagging, and local favorites persistence.
