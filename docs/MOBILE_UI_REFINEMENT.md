# Mobile UI refinement

## My Courses & Groups scrolling

The screen-reader full course title uses absolute positioning through `sr-only`.
Its course button must establish a positioning context; otherwise the hidden
titles can escape the scrolling workspace and extend the document, creating a
second scrollbar and blank space below the app. Positioning the button relatively
keeps the full accessible title inside its card without changing the visible grid.

`test_membership_scrolling_stays_inside_workspace` checks a 30-item list, search
results, no results and an empty list at 320/390/430/768/1280 px, 1440 x 766 and
short landscape in German/English and light/dark mode. It checks document height,
the last card and bottom padding, and captures screenshots for visual inspection.
These are Chromium emulation checks; no physical-device or live ILIAS validation
is implied.

## Stable sidebar collapse and foregrounds

All navigation/course rows share a 44 px height, the same icon wrapper and an
inherited foreground colour. Raw SVG-only buttons otherwise match a global
centering rule after their labels disappear, which moved three icons while the
wrapped course/overview icons stayed put. The shared wrappers remove that split.

Only sidebar width animates. Its header/footer and subject/custom-divider slots
keep their height during collapse; labels truncate on one line rather than
wrapping. The header title cannot shrink its row, and the customization action
stays keyboard-accessible in the compact rail. Reduced motion disables the width
transition. Phone/tablet drawers retain their full available width.

Primary inactive labels and icons use the same inherited slate foreground
(`slate-700` light, `slate-200` dark); the selected row uses the accent colour.
Section headings, course-code subtitles and secondary actions remain muted.
The design deliberately does not make every piece of sidebar text pure white.

`tests/test_sidebar_collapse_browser.py` samples icon coordinates throughout
repeated collapse/expand animations, compares primary computed colours and checks
fixed header/row heights. It covers default/custom sections, German/English,
light/dark and short desktop windows, plus phone/tablet drawer geometry.

## One page sync indicator

Use `SyncIndicator` once in the visible page header for ILIAS fetches. Initial
content placeholders, refresh actions, folder rows, progress summaries and cached
content must not add another loading animation for that fetch. The mobile page
header owns the phone indicator; the desktop status badge owns the desktop one.
Course session drawers and TA management/editor children report their activity to
the parent. Automatic feedback-file batches share the grading indicator too.
Standalone session drawers retain one indicator for the whole drawer.

The audit covers semester, course/folder, assignments, information, grading,
assignment management/editor, calendar, memberships and repository pages. The
information tab fetches on tab/context changes, rather than restarting when its
response updates state. Upload/save/download progress remains tied to its own
operation.

`tests/test_page_sync_browser.py` holds actual frontend API calls open to check
initial loads, cached revalidation, nested requests, failure cleanup and reduced
motion. Screenshots cover German/English, light/dark, phones, tablet, desktop and
short landscape using Chromium emulation. Live ILIAS and physical-device checks
are separate.

## Semester layouts and Escape navigation

Landing-page exits clear the landing flag only after navigation is approved.
The same-view shortcuts for courses, semesters and the overview must account for
that flag, and the initial history entry includes it so Back/Forward restores the
correct screen. The landing CTA uses the guarded overview handler before marking
the app visited. `test_landing_course_navigation_matches_url_and_history` checks
first-time visits, explicit landing URLs, course selection, history and the
overview CTA in German/English and light/dark mode at 320/390/430/768/1280 px,
1440 x 766 and short landscape. Screenshots use Chromium emulation with mocked
ILIAS data, not physical devices or live ILIAS sessions.

Sidebar dividers and their course positions are stored per semester. The old
global layout migrates once into the selected semester; editing/resetting another
semester leaves it intact. Nicknames and icons remain shared. Editor drafts still
survive refreshes and viewport changes within their semester.

Escape goes back through BetterIlias history. Two consecutive eligible presses
within 700 ms return to the current semester overview. Dialogs, menus, native
controls, editable fields, IME input, fullscreen and pointer lock take priority;
their Escape presses do not start a double-press sequence. Held keys and modified
Escape presses do not navigate. Navigation waits for existing confirmation guards
and never steps past the app's first history entry. Custom dismissible widgets
should mark their visible content with `data-escape-scope` or consume the keyboard
event with `preventDefault()`/`stopPropagation()`.

`tests/test_escape_and_semester_sidebar_browser.py` exercises actual editing,
reset/migration, folder history, timing, modal and native menu priority, editable
controls, fullscreen-state protection, and pending-operation confirmation. Checks
use Chromium emulation at 320/390/430/768/1280 px and short landscape sizes in
German/English and dark/light modes. Native fullscreen is simulated for the
shortcut-suppression check; real iOS/Android and live ILIAS remain manual checks.

## Design Principles & Scope

The mobile UI is designed around compact layouts, touch-accessible controls, and stable editing drafts across responsive breakpoints. It addresses shared mobile constraints across components rather than applying isolated cosmetic fixes, preserving compact desktop behavior while adapting to touch viewports. All actions are accessible, localized, and fully supported in dark mode across 320–430 px phone widths, short landscape viewports, tablets, and desktop displays.

## Problems to fix

- Shared controls: center icon controls and search adornments; separate switch
  hit areas from their pill-shaped tracks; animate gear clicks with reduced-motion support.
- Settings: full-screen phone settings with a working gear close action and
  appropriate focus/scroll behavior.
- Semesters: short labels without HS/FS explanations or current badges on all
  devices; dropdown-only phone navigation and wrapping secondary controls.
- Content chrome: compact course/folder/exercise headers with mobile course names,
  back navigation and secondary actions in a menu instead of persistent rows.
- Materials: consistent compact folder rows across renderer variants; omit phone
  file sizes and download text; hide session-wide phone filters.
- Exercises: title-row tab dropdown, single-row quick filters, compact searches,
  optional grading statistics, advanced filters in a dialog, readable German
  correction controls and same-row team actions; hide phone Escape hints.
- Sidebar editor: readable course titles, stable drafts despite course refreshes,
  no TA preset, automatic default grouping when custom sections are absent.

## Causes found

- Global mobile button minimum dimensions enlarged the *visible* switch from a
  short rectangle into a square. Icon-only buttons with padding also retained
  left-aligned SVGs. Switch tracks need a separate visual element.
- Search icons used fixed top offsets while mobile inputs grew to 44 px.
- Course content uses separate renderers for all-folder blocks, generic rows,
  image/tile blocks and search results. Different markup and flex directions
  produced different folder heights, including nested folders. Mobile folders
  should use one shared row renderer regardless of their source block.
- The sidebar editor initialised drafts on `[isOpen, courses]`. `App` creates a
  new courses array on ordinary renders, so the effect repeatedly replaced
  unsaved edits with stored values. Initialisation must follow opening the editor,
  with genuinely new courses reconciled without resetting existing drafts.
- A blanket wrapping rule also affected modal headers, moving close controls
  onto another row. Header constraints now allow text to shrink while preserving
  the close control's space.

## Implementation and regression coverage

The grouped fixes above are implemented. Mobile page headers retain a back
action and move secondary actions into a menu. Desktop page titles and tabs are
preserved. Course-only custom ordering now uses default subject grouping rather
than suppressing all sections; course order within those groups is retained.

`tests/test_mobile_refinement_browser.py` covers full-screen settings, gear
toggle/rotation, icon and switch geometry, short semester labels, folder renderer
variants, file actions, title-row exercise navigation, compact grading controls,
German team actions and sidebar drafts surviving real parent refresh events.
Existing mobile, upload, authoring, membership and TA regressions are also run.

## Readability follow-up

Phone sidebar editor cards give course titles the same readable scale as inputs,
followed by the editable field and a consistent ordering/reset toolbar. Desktop
and tablet cards retain two compact rows: title/actions, then editable field.
The DOM order follows the visual order at each breakpoint, while the draft inputs
remain mounted. Optional reset controls no longer shift the phone ordering arrows.
Mobile semester list rows hide course identifiers and the repeated official title;
their open indicator is an arrow, leaving room for two lines of course title.

Submission cards stack team names vertically instead of applying the horizontal
quick-filter layout to them. Status choices share one row above the larger comment
field, with full accessible labels and pressed states. On phones, names occupy the
left side of the header without an avatar; the team number and submission time sit
on the right. Details and Download occupy opposite ends of the next row.
The tutor view is labelled “Abgaben” / “Submissions”; its native selector occupies
a full-width row below the title with a minimum 48 px touch target.
`tests/test_mobile_card_layout_browser.py` checks these layouts
at 320, 390 and 430 px in German/dark and English/light mode, including saving a
grade and correction comment. It also checks the compact sidebar editor at tablet
and desktop widths.

Physical iOS Safari/Android Chrome and live ILIAS acceptance must be recorded
separately from automated browser emulation.

Submission-detail Save and Close controls keep their labels on one line and do
not shrink under pressure from secondary links. The grading header stacks on
phones, and footer links wrap separately from the primary action row. This avoids
inheriting the overlay's anywhere-word-wrapping rule on action labels. Application
text and locale keys use Swiss ss spelling; supplied lecturer/student content and
captured native HTML fixtures remain unchanged.
`tests/test_submission_detail_browser.py` checks both Save controls and Close,
including a real form interaction against mocked APIs, at 320/390/430/768/1280 px
and 667 x 375 landscape in German/English and light/dark mode. It captures
screenshots and checks text ranges to catch labels wrapping within buttons.
These checks use headless Chrome emulation, not physical devices or live ILIAS.

Submission-list retrieval requests the native filter-reset command with 800 rows
per page on every network read. This deliberately resets the native ILIAS view,
as requested by the user; old filters, row counts and page offsets are not
restored. Assignments up to 800 rows normally need only one request. Larger
assignments follow the native paging controls and still reject incomplete or
repeated pages. A discovered reset-form fallback handles routes that return an
active filter despite the initial reset command, without posting grading fields.
A session-scoped lock prevents concurrent BetterIlias reads from resetting each
other's pages; direct ILIAS browser changes and other servers cannot share it.
Legacy submission caches without a completeness flag are ignored, including in
Saver mode. A localised retry panel explains failed complete reads.
`tests/test_submission_listing_browser.py` checks replacing a legacy graded-only
cache with 50 submissions, keyboard retry, and client-side grading filters at
320/390/430/768/1280 px and short landscape in German/dark and English/light mode.
The native HTTP tests check request counts, filter resets, 800-row pages,
empty lists, failed/repeated pages and concurrent reads. These are mocked tests;
they do not establish live ILIAS or physical-device acceptance.

## Nested settings report details

Desktop/tablet settings are portalled outside the blurred header and positioned
below the actual gear-button rectangle. Keep `.settings-panel` excluded from the
shared vertically centred dialog rule: that rule's higher selector specificity
previously pulled a growing menu up over its own close trigger. Settings never
flip above the trigger; cap height to the viewport space below it and scroll
inside the panel. Recompute its anchor for resize, scrolling and visual-viewport
changes. Phones retain the full-screen sheet and its sticky close gear. QR and
address drafts stay mounted when rotating across this breakpoint.

`tests/test_settings_menu_browser.py` expands the QR code, scrolls to logout,
checks the desktop trigger's hit area and stable menu top, then resizes across
the phone breakpoint while preserving the address draft. Screenshots cover
320/390/430/768/1280/1440 px, short desktop/landscape windows, both languages and
light/dark mode using Chromium emulation.

The diagnostic-details dialog is portalled to the document body to avoid the
settings panel's inner scrolling area. Mark it `data-settings-owned` so parent
outside-click handling does not close settings when a child control is tapped.
While the child dialog is open, the parent must not handle Escape. Its React
`cancel` event must also stop propagation: portals preserve React event ancestry
even when native DOM elements live outside the parent. Closing restores focus
to the settings info control. Show deletion feedback inside the active child
dialog and preserve 44 px touch targets. The diagnostic-report browser matrix
checks deletion, nested Escape behavior, focus restoration and viewport fit in
both languages/themes across phone, tablet, desktop and short landscape sizes.
These are Chromium emulation checks, not physical-device validation.

## Extension installation guidance

The companion installation dialog uses a native modal with explicit focus
restoration, a visible close button and a scrolling content area. Restricted
browser-internal setup addresses have 44 px copy controls, localised success
feedback and a manual-copy fallback if clipboard access fails. Browser packages
and installation paths now live under `extensions/chrome/` and `extensions/firefox/`.

`test_extension_setup_addresses_copy_and_fit_viewports` checks both browser choices,
copied addresses, clipboard rejection, Escape/focus restoration and GitHub targets
at 320/390/430/768/1280 px and 844 x 390 in German/English and light/dark mode.
Screenshots were inspected for wrapping, alignment and reachable close controls.
These are Chromium emulation checks with mocked API/clipboard responses, not
physical iOS Safari/Android Chrome or live ILIAS validation. Safari companion
compatibility remains a separate, unfinished task.

## Resizable navigation and course pins

See [sidebar navigation](SIDEBAR_NAVIGATION.md) for the refined implementation
brief, width/collapse limits, workspace container queries, account-scoped pins
and browser coverage. The mobile drawer uses the full visible viewport and safe
areas; desktop resizing preserves mounted editors and adapts the content pane.

The compact rail now uses centered 44 px square buttons rather than full-width
rectangles with expanded padding. Expanded minimum/collapse widths are 160/140 px.
One pinned destination takes precedence over the parent course's highlight;
unpinned destinations retain the course highlight. Sidebar removal is confirmed,
while content toggles remain instant. Small sidebar pin glyphs keep full touch
targets. Grey unpinned pins light up on hover; saved pins stay lit and show a
struck-through pin on hover/focus. Unpinning immediately restores grey. Folder-card pins follow the name
at the trailing edge. Native confirmation autofocus/close preserves safe initial
focus and returns it on cancellation, including inside the mobile drawer.

## Work-distribution dialog scrolling

The native dialog is the flex container for its fixed header/footer and shrinking,
scrollable body. A second wrapper with the same viewport height limit previously
overflowed the dialog's content box because of its borders, causing a third scrollbar.
The assignment preview retains its own labelled, keyboard-focusable scrolling region
and opaque sticky headings so rows do not show through while scrolling.

The allocation browser regression uses 15 submissions at 320/390/430/768/1280 px
and 667 x 375, in German/English and both themes. It verifies zero outer overflow,
reachable close/save actions and scrolling to the final preview row. Existing
roster editing, reordering, draft persistence, saving and note-budget checks remain.
The surrounding submission toolbar wraps filter and action groups at tablet widths
instead of expanding the page after a resize.
Phone and desktop screenshots are inspected; these are mocked Chromium emulation
checks, not physical-device or live ILIAS validation.

## Login-status hover on hybrid devices

The header status label uses explicit hover/focus selectors rather than Tailwind's
hover variant, which is gated by `hover: hover`. Touch-capable devices can report
`hover: none` while a mouse is attached. The green dot keeps a 44 px button target;
keyboard focus and tapping reveal the label too, and Escape clears focus.
The label transition and dot animation respect reduced-motion preferences.

`test_session_status_hover_browser.py` covers mouse movement with and without
touch capability, keyboard focus/Escape and tapping in German/English and both
themes at 320/390/430/768/1280 px and 844 x 390. These checks use Chromium
emulation with mocked API data, not physical-device or live ILIAS validation.
Phone and desktop screenshots were inspected for readable status text, spacing
and clipping alongside the logo and settings button.

## Course-management feedback and uploads

Creation, uploads, deletion and saved ordering share one dismissible inline banner.
Its close control has a 44 px target and returns keyboard focus to the management
heading. A confirmed save followed by a failed refresh uses one warning explaining
that the write completed and should not be repeated. Confirmed created objects stay
visible while their management permissions await a successful refresh. Invalid or
empty successful HTTP responses cannot produce an upload-success message; an empty
upload queue cannot submit. Successful uploads trigger one refresh.

On phones, item actions occupy a separate row so the name retains readable width;
tablet and desktop layouts keep compact inline controls. The feedback regression
exercises creation, four unconfirmed upload responses, a confirmed upload with a
failed refresh, deletion and keyboard dismissal in German/English and both themes,
at 320/390/430/768/1280 px and 844 x 390. Screenshots are inspected for wrapping,
alignment and clipping. These are mocked Chromium emulation checks, not physical
iOS Safari/Android Chrome or live ILIAS validation. Native upload tests also cover
an initially empty widget whose metadata controls exist only inside a template.
The reported production failure still needs a live retry after deployment.

Deletion review now opens immediately with the selected item names. Only confirmation
waits for a fresh backend inspection, with a spinner in that button; Cancel/Escape
remain available during the read. Late responses after cancellation are ignored.
Cached previews never enable confirmation before the fresh review arrives. Inspection
errors stay in the dialog with a retry action. During the actual deletion, confirmation
shows its spinner again, dismissal is disabled, and confirmed success closes the
dialog and shows the shared banner. Spinner space is reserved to keep buttons stable,
animation respects reduced motion, and native Cancel autofocus/focus return is retained.
The same emulated viewport/language/theme matrix covers delayed reviews/deletions,
cancelled requests, failed inspection/retry and cached previews, with screenshots.

## Lecture-specific exercise tabs

The exercise view remembers Assignments, Info or Submissions & Grades per lecture
and session account in browser storage, including across reloads and different
exercise containers in the same lecture. Explicit tab links override the preference;
Assignments is explicit in browser history so Back/Forward cannot accidentally
restore a different remembered tab. Management/editor modes are not saved. A user
without TA access falls back from remembered grading to Assignments. Storage failures
leave the default navigation usable.

The browser regression uses the existing phone selector and desktop navigation
buttons across 320/390/430/768/1280 px and 844 x 390, German/English and light/dark.
It exercises independent lectures, another exercise in the same lecture, explicit
links, Back/Forward, reload, account isolation and lost TA access. Screenshots use
mocked Chromium emulation; physical-device and live ILIAS validation are not claimed.

## Custom Confirmation & Navigation Dialog System

Browser-native window.confirm and window.alert dialogs have been entirely replaced across student and TA workflows with a responsive custom dialog system (ConfirmModal.tsx and dialog.ts):
- **Mobile Geometry & Touch Targets:** Width fits within min(30rem, 92vw) and max-h-[90dvh]. On viewports under 640px, action buttons stack vertically in reverse column order (lex-col-reverse) to place primary affirmative actions comfortably within thumb reach, with min-h-[44px] touch targets.
- **Accessible Focus & Backdrop:** Backed by native <dialog> element with showModal(), ria-labelledby, ria-describedby, keyboard Esc listener, and focus trapping. Backdrop uses subtle dark blur (ackdrop-blur-xs) and supports light and dark modes (dark:bg-slate-900, dark:border-slate-800).
- **Clean Discard Lifecycle:** Registered navigation guards support an onDiscard callback. When the user confirms discarding changes on navigation, 
avigationGuard immediately resets dirty state flags, preventing ghost warnings or repeated prompts when changing tabs or navigating courses.

