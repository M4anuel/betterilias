# Sidebar Navigation, Resizing and Course Pins

BetterIlias provides an interactive, resizable sidebar on desktop viewports and a touch-optimized full-screen navigation drawer on mobile displays. It supports direct pinning of frequently used course folders, exercises, and content sections as nested quicklinks.

---

## 1. Capabilities & Feature Matrix

| Capability | What BetterIlias Does | User Experience Guarantee |
| :--- | :--- | :--- |
| **Edge-Drag Resizing** | Drag the sidebar's right border to customize width smoothly. | Width is constrained between 160 CSS px minimum and 50% of viewport width. Dragging below 140 px snaps to a compact 64 px icon rail. |
| **Keyboard Resizing** | Focus the divider handle and resize using standard keys. | `Left` / `Right` steps by 16 px; `Home` collapses to rail; `End` expands to 50% max; double-clicking resets to standard 256 px. |
| **Mobile Drawer Mode** | Below 1024 px viewports, switches from a static sidebar to an overlay navigation drawer. | Closes on background tap or `Escape`; fits safe areas and preserves scroll position. |
| **Course Quicklinks (Pins)** | Pin specific folders, exercises, external links, or section headings directly beneath their parent course. | Nested pins are visible beneath their course in the expanded sidebar; pin actions have 44 px touch targets with visual state hints. |
| **Draft-Preserving Resizing** | Adapts main content width without unmounting React components. | Resizing uses `ResizeObserver` and CSS container queries; active editor drafts, form inputs, and video players stay mounted without state loss. |
| **Tenant-Scoped Persistence** | Persists custom width and pinned items per session in browser storage. | Switching accounts clears the previous user's pins; multi-tab updates sync via storage events. |

---

## 2. Interaction & Keyboard Guide (How-To)

### 2.1 Dragging and Resizing
- **Pointer Drag**: Grab the right vertical divider of the sidebar. The cursor changes to `col-resize`. Drag right to expand up to half the window width; drag left to shrink.
- **Snapping & Reset**:
  - Dragging below 140 px snaps the sidebar into the collapsed 64 px icon rail.
  - Double-clicking the divider handle instantly resets width to the default 256 px.
- **Keyboard Shortcuts (When Divider is Focused)**:
  - `Left Arrow`: Decrease width by 16 px.
  - `Right Arrow`: Increase width by 16 px.
  - `Home`: Collapse sidebar to 64 px icon rail.
  - `End`: Expand sidebar to maximum width (50% viewport).

### 2.2 Pinning Course Content (Quicklinks)
- **Pinning Items**: Click the pin icon next to any folder row, exercise header, or content section. Unpinned items show a subtle gray pin on hover/focus; pinned items stay highlighted.
- **Accessing Pins**: Pinned items appear nested directly below their parent course in the sidebar, allowing one-click direct navigation.
- **Removing Pins**: Clicking an active pin in the sidebar prompts a confirmation dialog. Confirming removes the pin and smoothly returns focus to the course item.

---

## 3. Architecture & Technical Constraints (Explanation)

### 3.1 CSS Container Queries & Layout Adaptation
In `frontend/src/components/Sidebar.tsx` and main layout components:
- The main workspace observes container width using `ResizeObserver`.
- Named CSS container queries (`@container`) drive multi-column grid layouts for courses, folders, and exercise cards based on the *actual remaining workspace width* rather than the outer window width.
- Layout adaptation updates CSS variables and style dimensions without modifying React component keys, preventing form inputs or rich text editors from re-mounting.

### 3.2 Tenant Isolation for Pins & Width
- Pinned items and preferred sidebar widths are stored in `localStorage` under `betterilias_pins_<session_id>`.
- Insecure schemes (e.g. `javascript:`) and malformed URLs are rejected upon reading storage.
- Preferences do not sync across different user accounts on shared computers.

---

## 4. Source Code & References

- **Sidebar Component**: [`frontend/src/components/Sidebar.tsx`](../frontend/src/components/Sidebar.tsx)
- **Layout & Container Queries**: `frontend/src/index.css` and main workspace containers
- **Automated Tests**:
  - `tests/test_sidebar_collapse_browser.py` — Verifies edge dragging, collapse thresholds, double-click reset, and responsive drawer behavior.
  - `tests/test_sidebar_resize_pins_browser.py` — Tests keyboard resizing (`Left`/`Right`/`Home`/`End`), pin creation/deletion, and persistence isolation.

---

## Appendix: Retained Historical Notes

*(Preserves initial implementation brief and review criteria from development.)*
- Original goal: Provide a desktop sidebar that can be resized between 160 px and half the viewport, collapse to a 64 px rail, and store nested course quicklinks per account without causing main content drafts to unmount.
