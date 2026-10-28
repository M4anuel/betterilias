# Mobile UI refinement

## Implementation prompt

Refine the mobile UI around compact layouts, consistent controls and stable
editing drafts. Treat the reported defects as examples of shared problems and
audit related components rather than applying isolated cosmetic fixes. Preserve
desktop behavior except for the explicitly requested semester simplification,
gear animation and sidebar editor changes. Keep all actions accessible, localised
and usable in dark mode. Verify 320-430 px widths, short landscape viewports,
German/English, desktop regressions and form state across parent rerenders.

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

## Custom Confirmation & Navigation Dialog System

Browser-native window.confirm and window.alert dialogs have been entirely replaced across student and TA workflows with a responsive custom dialog system (ConfirmModal.tsx and dialog.ts):
- **Mobile Geometry & Touch Targets:** Width fits within min(30rem, 92vw) and max-h-[90dvh]. On viewports under 640px, action buttons stack vertically in reverse column order (lex-col-reverse) to place primary affirmative actions comfortably within thumb reach, with min-h-[44px] touch targets.
- **Accessible Focus & Backdrop:** Backed by native <dialog> element with showModal(), ria-labelledby, ria-describedby, keyboard Esc listener, and focus trapping. Backdrop uses subtle dark blur (ackdrop-blur-xs) and supports light and dark modes (dark:bg-slate-900, dark:border-slate-800).
- **Clean Discard Lifecycle:** Registered navigation guards support an onDiscard callback. When the user confirms discarding changes on navigation, 
avigationGuard immediately resets dirty state flags, preventing ghost warnings or repeated prompts when changing tabs or navigating courses.

