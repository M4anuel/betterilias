# Sidebar resizing and course pins

## Refined implementation brief

Make the desktop sidebar resizable by dragging its right edge, with keyboard
equivalents and a saved preferred width. Cap it at half the current viewport,
collapse it when dragged below a practical minimum, and retain full-screen mobile
navigation. Adapt the main workspace to its actual remaining width without
remounting editors or losing drafts. Let users pin course folders, exercises,
ILIAS links and content sections from their parent listing and the open page or
section. Display these as nested hyperlinks below their course, with removal
controls, direct navigation and saved preferences isolated by account on this device.
Verify both languages/themes, navigation history, persistence, failure feedback,
mobile interactions and tablet/desktop layouts.

## Behavior

- Drag the sidebar's right edge. Its expanded minimum is 200 CSS px; dragging
  below 180 px collapses to the existing 64 px rail. Expand restores the preferred
  width. A narrower browser clamps the displayed width without discarding the
  saved preference.
- Focus the divider and use Left/Right to change width by 16 px, Home to collapse,
  or End to use half the viewport. Double-click resets to 256 px, subject to the cap.
- Below the existing 1024 px navigation breakpoint, the drawer covers the full
  viewport. Its close control, Escape dismissal and scrollable course list remain.
- Pin controls are separate from item navigation. Parent rows/cards, current
  folders, exercise headers/action menus and content sections expose pin/unpin.
  Pins sit under their original course even if it is absent from the selected
  semester. Collapsing hides the nested links until the sidebar is expanded.
- Folder/exercise anchors open BetterIlias routes. Content sections use stable
  hash anchors and scroll after their content loads. Forums and other items
  currently opened in ILIAS retain their ILIAS URLs; this does not add controls
  to the external ILIAS website. Native link behavior supports new tabs and copying.
- Pins are stored locally under the current BetterIlias session's scope; account
  changes clear the visible set and storage events refresh other tabs. Invalid
  saved entries and unsafe URL schemes are ignored. Failed writes display a
  translated error without pretending that the pin was saved. Preferences do not
  sync across devices.

## Remaining workspace

The application observes the main element with ResizeObserver. Course rendering
and compact controls use that width, while named CSS container queries choose
grid columns for courses, folders, exercises and memberships. Existing flex
layouts keep the main pane shrinkable. Resizing changes layout and context values,
not component keys, so open editors and drafts stay mounted. Navigation remains
guarded independently of resizing.

## Verification

`tests/test_sidebar_resize_pins_browser.py` exercises dragging/collapse/recovery,
the half-screen cap after viewport changes, keyboard resizing, parent/current-page
pinning, deep links/history, saved width/pins, draft preservation, write failures,
account changes and unsafe stored links. Screenshots cover the half-screen layout
and 320/390/430/768 px and short-landscape mobile drawers in both languages/themes.
These are Chromium emulation checks with mocked API data, not physical iOS Safari,
Android Chrome or live ILIAS verification. Existing sidebar, navigation, allocation,
course-card and mobile regressions are retained.

Recovery verification (2026-11-10): the backend suite passed with 615 tests
and 413 opt-in/environment skips. The production build, 2074-key locale check,
launcher syntax check and 103 related Chromium browser cases passed. Screenshots
were inspected for desktop half-width content, phone/tablet drawers and short
landscape layouts. The My Courses search field uses the same container breakpoints
as its grid, preventing its column span from following the wider screen instead.
