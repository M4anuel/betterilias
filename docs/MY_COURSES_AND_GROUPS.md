# My courses and groups

## Refined implementation prompt

Implement a BetterIlias overview of all course and group memberships, using the
saved ILIAS “My Courses and Groups” page as the structural reference. Integrate
it into the existing sidebar and URL/history navigation. Retrieve the membership
overview rather than only the dashboard's selected items.

Provide case-insensitive search over original titles, display names, descriptions
and semesters, a semester filter, alphabetical sorting in both directions and
newest/oldest semester sorting. Keep favourites in a separate first section under every sort
order. Offer an accessible star button separate from the open action; preserve
keyboard focus when a card moves. Initialise from existing ILIAS favourites and
persist local overrides and sorting per session in the browser, including explicit
unpin overrides. Keep the page header free of explanatory favourites hints.

Use existing course display names and icons, retain course/group navigation,
provide loading, empty, no-results, refresh and retry states, and retain the last
successful list when refresh fails. Support German/English, light/dark themes,
phones, tablets, desktop and short landscape viewports. Keep phone search and
favourites prominent; collapse optional filters without unmounting their inputs.
Validate the saved HTML parser, API integration and real browser interactions
with mocked API responses, and run the repository's required checks.

## Data and preference behavior

- Navigation: sidebar entry and `?view=my-courses`.
- Data: `GET /api/dashboard/memberships` fetches `ilmembershipoverviewgui` with
  the existing authenticated, tenant-specific client and session checks.
- Favourites and sorting use `betterilias_my_courses_<session_id>` in localStorage
  (`local` for the existing single-user fallback). They do not change ILIAS's
  favourites or memberships. Active search and filters apply to both sections.
- Semester metadata is extracted from explicit HS/FS year codes in item titles.
  Entries without such a code are available under “Without semester”.
  Dropdown options come from the loaded memberships and update after refresh;
  there is no fixed semester list. Undated entries follow dated entries in both
  semester sort directions.
- The portable HTML fixture retains the 64 membership items from the user's
  saved page (60 courses, four groups). Account navigation, notifications, bulk
  dialogs, scripts, DOM IDs and event handlers are excluded. Saved asset paths
  remain to regress the “Courses and Groups” directory misclassification.

## Verification

`tests/test_my_courses.py` covers saved markup, types, semesters, native favourites,
excluded dialogs, authenticated closed-course notices and the API/service path.
`tests/test_my_courses_browser.py` exercises search, filters, sorting, pin/unpin,
persistence, session isolation, focus, sidebar entry, course/group navigation,
refresh failure/retry and empty results. It captures screenshots at 320, 390,
430, 768 and 1280 px, plus 740 × 360 landscape, in all four language/theme
combinations. These are mocked Chromium checks with viewport/touch emulation;
physical iOS/Android and live ILIAS validation are not claimed.
