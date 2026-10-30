# TODO

Unchecked items are unfinished; completed work is listed separately below. Current behavior and limitations are also recorded in [`docs/ILIAS_SUPPORT_MATRIX.md`](docs/ILIAS_SUPPORT_MATRIX.md) and [`docs/COURSE_MANAGEMENT_SPECIFICATION.md`](docs/COURSE_MANAGEMENT_SPECIFICATION.md).

## Teaching-assistant work distribution

- [ ] Implement the reviewed [TA work distribution, downloads and feedback-return plan](docs/TA_WORK_DISTRIBUTION_PLAN.md), starting with native capability/identity probes. Planning and read-only source/fixture research are complete; the feature is not implemented.

## Calendar and timetable

Goal: combine all courses from the current semester into a calendar, a weekly
timetable and one iCalendar feed, with flexible manual schedules when ILIAS has
no lecture dates.

- [x] Add calendar views (including week/month/agenda) and a weekly timetable
  generated from the current semester's courses. Provide course filters/colours,
  readable overlaps and usable phone/tablet/desktop layouts in both languages
  and themes.
- [x] Discover each course's ILIAS iCalendar link and import its actual events.
  Distinguish a valid but empty calendar from unavailable feeds, failed requests
  or expired sessions; explain when a course needs a manual schedule.
- [x] Let users create, edit, duplicate and delete multiple schedule entries per
  course. Each weekly rule specifies weekday(s), start/end dates and start/end
  times, with optional location/title. Preserve drafts and saved rules per user
  and course when changing semesters or refreshing ILIAS data.
- [x] Make both examples straightforward: two lectures every week, and one rule
  for Wednesday 16:00-18:00 during the first part of the semester followed by a
  separate Friday 14:00-16:00 rule during the second part. Support different date
  ranges and hours without forcing one fixed timetable slot per course.
- [x] Combine imported dates and custom rules into one consistent event model.
  Handle time zones/daylight-saving changes (Europe/Zurich), recurrence bounds,
  exceptions/cancellations, updates and duplicate prevention. Keep manually
  entered schedules when re-importing course calendars.
- [x] Export the combined semester calendar as one .ics file. Investigate a
  stable, automatically updating subscription URL usable by external calendar
  clients; give events stable UIDs so refreshes update existing entries.
- [x] For subscriptions, design a private, unguessable and revocable feed URL
  without exposing ILIAS cookies. Check server reachability, refresh scheduling
  and session/feed expiry; document local-only hosting limitations and retain
  downloadable .ics export where subscriptions cannot be supported.
- [x] Verify native events, empty feeds, multiple weekly slots, mid-semester
  schedule changes, overlapping events, DST and import/export round trips.
  Validate subscriptions with representative external calendar clients where
  hosting supports them.

## Mobile usability

- [x] Restore two-row sidebar editor cards on tablet/desktop; enlarge the phone
  assignment selector and balance submission header metadata and actions.

- [x] Rebalance sidebar editor typography and stable ordering controls; simplify
  semester list titles/actions and submission-card names/status controls; shorten
  the mobile tutor view label and verify both languages/themes.

Follow-up audit: [`docs/MOBILE_UI_REFINEMENT.md`](docs/MOBILE_UI_REFINEMENT.md)
records the refined prompt, grouped problems and causes found during implementation.

- [x] Refine compact mobile controls, settings, semester/course/exercise navigation,
  material rows, grading/team actions and stable sidebar editing drafts; verify
  related cases in both languages and themes.

Implementation: responsive phone/tablet navigation, visible-viewport overlays,
safe-area spacing, touch targets, contained rich-content tables, PDF fallback links,
and narrow-screen exercise tabs are implemented. Automated phone workflow checks
cover navigation/settings, authoring, uploads/retry and reviewed management.
Real-device and live ILIAS acceptance remains tracked below.

Goal: complete everyday student and supported TA workflows comfortably on a
phone, including portrait/landscape use and the on-screen keyboard.

- [x] Audit core screens at 320–430 CSS px and tablet widths; remove page-wide
  horizontal overflow while allowing contained scrolling for wide tables/media.
- [x] Adapt the header, sidebar, breadcrumbs, search and settings for narrow
  screens; keep navigation and current-course context accessible without hover.
- [x] Make dialogs, drawers and menus fit the visible viewport, including safe
  areas and the on-screen keyboard; keep focused inputs and primary actions
  reachable and preserve drafts when rotating or resizing.
- [x] Provide comfortably spaced touch targets (aim for at least 44×44 CSS px),
  visible focus states and tap-accessible explanations/actions currently exposed
  through hover. Retain keyboard and screen-reader access.
- [x] Adapt course blocks, session cards, PDFs and video layouts to small screens;
  preserve readable lecturer content and provide usable media fallback actions.
- [x] Support phone file selection, upload status/retry and submission management;
  provide tap controls for ordering wherever drag-and-drop is offered.
- [x] Adapt TA grading, assignment editors and course-management selection/review
  flows so fields, feedback and destructive confirmations remain usable on phones.
- [ ] Validate login/session sharing, browsing/search, student submission and
  supported TA/management flows in German/English and light/dark mode. Add focused
  mobile browser regressions and check representative iOS Safari/Android Chrome
  behavior, including keyboard, scrolling, rotation and media playback.

## Localisation

**Status:** Implemented with shared German/English catalogues, saved language
selection in the app and both extensions, request-scoped server messages,
build validation, and English fallback for partial languages.

- [x] Add a language setting with German and English support.
- [x] Move hardcoded user-facing text into translation files (for example,
  `translations.ts`) and look up the selected language when rendering it.
  Cover the app, user-facing server messages, and both Chrome and Firefox
  extension popups. Keep course titles and other content supplied by ILIAS
  as provided.
- [x] Give each language an explicit fully supported or partially supported flag.
- [x] Check translation completeness at compile/build time:
  - Fully supported languages must contain every translation key; missing entries
    must fail the build.
  - Partially supported languages may report warnings for missing entries, but
    must still build and run. Use English for missing translations without
    crashing the app or server.
- [x] Verify language selection, translation coverage, build failures for
  incomplete fully supported languages, and English fallback for partial ones.

## ILIAS content and formatting

- [x] Preserve original ILIAS structure and formatting:
  - [x] Multi-column layouts (2-column flex rows rendered side-by-side).
  - [x] Section divider titles and accent colors (#d81e5b / #fb7185) preserved sequentially without merging.
  - [x] Embedded Opencast video playback directly in BetterIlias with fallback link to exact ILIAS folder.
  - [x] Clean, responsive PDF embed containers fitting width without viewer chrome or empty void margins.
  - [x] Responsive table wrappers and optimal reading measure (~68ch max width for prose).
- [ ] Continue preserving custom lecturer layouts and edge cases.

## Comprehensive ILIAS Object Support & Course Management

**Status:** The 30 repository types found in the supplied course-authoring views are catalogued below. The authoritative, implementation-audited record is [`docs/ILIAS_SUPPORT_MATRIX.md`](docs/ILIAS_SUPPORT_MATRIX.md): it covers all 30 types, all 15 page-element insertion choices, additional rendering cases and management operations. Complete technical specification documented in [`docs/COURSE_MANAGEMENT_SPECIFICATION.md`](docs/COURSE_MANAGEMENT_SPECIFICATION.md). Checked rows here indicate some implemented handling, not complete support for every native operation.

### Object Inventory & Current Support Status

#### 1. Content (`Inhalt`)
- [x] `file` — **File** (`Datei`): Native reading/downloads, existing PDF embeds, file properties, course upload and reviewed deletion. General rename/version management remains unsupported.
- [x] `webr` — **Weblink** (`Weblink`): Partially supported. Detected by `_detect_material_type`, opens external link in a new tab.
- [ ] `copa` — **Content Page** (`Inhaltsseite`): Needs parser to extract rich HTML page content directly into BetterIlias rather than redirecting.
- [ ] `glo` — **Glossary** (`Glossar`): Needs glossary term extraction, search, and letter index navigation.
- [ ] `lm` — **Learning Module ILIAS** (`Lernmodul ILIAS`): Needs chapter tree and page navigation viewer.
- [ ] `htlm` — **Learning Module HTML** (`Lernmodul HTML`): Needs sandboxed iframe viewer with asset resolution.
- [ ] `sahs` — **Learning Module SCORM** (`Lernmodul SCORM/AICC`): Needs SCORM API player runtime wrapper.
- [ ] `dcl` — **Data Collection** (`Datensammlung`): Needs table view, field filters, and entry detail view.
- [ ] `xds2` — **Literature Ordering (DigiSem)** (`Digitale Seminarbibliothek`): Needs status display and direct link handling.

#### 2. Video and Audio (`Video und Audio`)
- [x] `xoct` — **Video- & Audioseries (Opencast/Tobira)** (`Video- & Audioserie`): Episode discovery/filtering/search and native synchronized MP4 audio/slides playback with layouts, independent quality, slide chapters and ILIAS fallback. Live authenticated and physical-device playback validation remains pending below.
- [ ] `xvid` — **Interactive Video** (`Interaktives Video`): Needs interactive video player supporting embedded questions and jump markers.
- [ ] `mep` — **Media Pool** (`Medienpool`): Needs media gallery viewer (audio/video/image assets).

#### 3. Organisation (`Organisation`)
- [x] `fold` — **Folder** (`Ordner`): Fully supported for browsing. Multi-column row layout, nested navigation, breadcrumbs, search, and file counts.
- [x] `sess` — **Session** (`Sitzung`): Supported. Identified with calendar badge, scheduled date/time, and room/location details.
- [ ] `itgr` — **Item Group** (`Objektgruppe`): Existing page resource groups render as grouped materials, but the repository object has no dedicated creation/settings/resource-assignment workflow.
- [ ] `lso` — **Learning Sequence** (`Lernsequenz`): Needs sequential step-by-step progress viewer.

#### 4. Communication & Collaboration (`Kommunikation und Zusammenarbeit`)
- [x] `frm` — **Forum** (`Forum`): Partially supported. Forum card representation and direct navigation to ILIAS forum threads.
- [x] `grp` — **Group** (`Gruppe`): Partially supported. Group membership parsed; needs dedicated group workspace view.
- [ ] `blog` — **Blog** (`Blog`): Needs blog post timeline and comments feed.
- [ ] `wiki` — **Wiki** (`Wiki`): Needs wiki page viewer, page history, and internal wiki linking.
- [ ] `xpdl` — **Texteditor (Etherpad)** (`Texteditor / Etherpad`): Needs collaborative live editor embed.

#### 5. Performance & Assessment (`Leistungsüberprüfung`)
- [x] `exc` — **Exercise** (`Übung`): Fully supported. Student submission uploads with drag-and-drop, TA assignment management (create, edit, delete), feedback files, and grading.
- [x] `tst` — **Test** (`Test`): Partially supported. Detected in backend; links to ILIAS test environment.
- [ ] `qpl` — **Question Pool for Tests** (`Fragenpool für Tests`): Needs question pool browser for instructors/TAs.
- [ ] `prtt` — **Portfolio Template** (`Portfoliovorlage`): Needs portfolio template preview.

#### 6. Feedback & Evaluation (`Feedback und Evaluation`)
- [x] `xlvo` — **LiveVoting** (`LiveVoting`): Partially supported. Quick launcher card and vote icon.
- [ ] `poll` — **Poll** (`Umfrage`): Needs quick voting card and live results chart.
- [ ] `svy` — **Survey** (`Befragung`): Needs survey overview, participation link, and results summary.
- [ ] `spl` — **Question Pool for Surveys** (`Fragenpool für Umfragen`): Needs survey question pool browser.
- [ ] `xsev` — **Self-evaluation** (`Selbstevaluation`): Needs self-evaluation question rubric and spider/bar chart results.

### Object Detection & Parsing Roadmap
- [ ] Extend `_detect_material_type` in `backend/scrapers/materials.py` to recognize all 30 object types by `icon_<type>` CSS class, `/go/<type>/` permalink, or `cmdClass=ilObj<Type>GUI` instead of falling back to `"other"`.
- [ ] Map distinct Lucide React icons, semantic color badges, and localized labels for all 30 types in `frontend/src/components/CourseView.tsx`.

### Course and Folder Management Workflows

Design: [`docs/COURSE_MANAGEMENT_SPECIFICATION.md`](docs/COURSE_MANAGEMENT_SPECIFICATION.md) and [`docs/UNIFIED_MANAGEMENT_PLAN.md`](docs/UNIFIED_MANAGEMENT_PLAN.md).

- [ ] Verify repository deletion and shared ordering against controlled live ILIAS test content; committed fixtures/mocks do not replace live acceptance.
- [ ] Add exercise-container creation and open the existing assignment editor afterwards.
- [ ] Add native weblink and item-group creation.
- [ ] Add native rename/title/description editing for supported objects.
- [ ] Add native move, copy and reference-link workflows with a destination picker.
- [ ] Add an optional move-to-parent/evacuation flow before folder deletion (default: delete folder and contents together with safety check); verify each move and never delete after a partial evacuation.
- [ ] Add native selected-item ZIP download and trash/restore workflows where ILIAS exposes supported forms.
- [ ] Extend management to additional repository types once their permission, confirmation and verification paths are implemented.
- [ ] Add native page-element creation/editing/removal and resource placement to the unified catalogue, replacing the current explicit ILIAS editor handoff.
- [ ] Support complete review of currently refused paginated/unsupported folder trees without assuming that a partial listing is empty.
- [ ] Identify remaining TA workflows that should be available in BetterIlias.

## Media & Podcast Streaming

Design and retained stream findings: [`docs/PODCAST_PLAYER_PLAN.md`](docs/PODCAST_PLAYER_PLAN.md).

- [x] Native In-App Opencast Podcast Player with Dual-Stream Support:
  - [x] Synchronized playback for presenter camera feed (with `mainAudio`) and presentation slides feed.
  - [x] Viewing layouts: Picture-in-Picture (PiP), Side-by-Side (desktop split), and one-click screen swap.
  - [x] Bandwidth Saver / Slides-Only Mode: Ability to set presenter video quality to lowest (480p) while keeping presentation slides at 1080p.
  - [x] Slide chapter navigation using Opencast `frameList` thumbnails and timestamps.
  - [x] Fast on-demand stream resolution for podcast episode IDs (`eid`).

- [ ] Validate authenticated playback after renewing the expired local ILIAS session, and verify real iOS Safari / Android Chrome playback. CDN byte-range checks and local Chromium decoding pass; these do not replace live account/device acceptance.

## Completed

- [x] Enlarge the toolbar logo within its icon canvas and replace covering text badges with small corner status dots; retain full localized status in the tooltip and popup in both extensions.
- [x] Increase the corner status dot diameter by 25% for clearer visibility while preserving the toolbar logo.

- [x] Fix intrinsic extension popup sizing and header/badge wrapping; verify an installed Chromium action popup at normal and doubled content scaling, with matching Firefox markup.

- [x] Verify extension session cookies before showing success; use amber checking/unavailable and red invalid toolbar/popup states, invalidate stale success caches and show a prominent ILIAS login action in both Chrome and Firefox.

- [x] Give the player a taller default 16:10 canvas, save/resume playback positions per session and episode, and replace the cone with a straight volume track and volume-sensitive speaker waves.
- [x] Remember player layout, visible stream and playback preferences per session; unify mute glyph sizing, double slide preview sizes, and add persistent title/date sorting in either direction to recordings, using upload dates only when explicitly supplied.
- [x] Replace recording sort dropdowns with compact field/order toggles; put titles above readiness and align mobile ILIAS/Stream actions along the bottom of compact cards.

- [x] Add whole-player keyboard toggles, canvas-only fullscreen, animated click/tap playback feedback, icon layouts with switching in every mode, overlay quality settings and supplied WebVTT/SRT subtitles; move episode ILIAS links below Stream and remove persistent reload/bandwidth actions.

- [x] Refine the video player with loading skeletons, a translucent playback overlay that hides after inactivity, chapter markers and scrubbing thumbnails in the thicker timeline, and a volume slider; replace the separate slide collection.

- [x] Simplify My courses and groups by removing the favourites hint and type filter; support both alphabetical and semester sort directions while keeping semester options derived from actual memberships.

- [x] Add My courses and groups with all-semester membership discovery, search, type/semester filters, alphabetical/newest ordering and persistent session-scoped favourites pinned above other entries.

- [x] Animate upload progress smoothly and accurately across multiple files, while retaining confirmed-file counts and reduced-motion support.

- [x] Replace native upload bars with gradient progress tracks, distinguish measured transfer from indeterminate ILIAS saving/verification, respect reduced motion, and count only confirmed files as saved.

- [x] Keep license dropdown choices compact and show the selected explanation underneath in smaller, muted text.

- [x] Correct upload confirmation for native extensionless file titles, process queued course files concurrently with independent outcomes, localise the file picker, explain license choices, clarify object switching, and show authoring wait hints only on the disabled submit button.

- [x] Add reusable course/folder authoring permission context, a searchable bilingual 30-object creation catalogue (folder/file enabled; other types disabled), native folder creation and course file uploads. Cover native saved-page forms and browser flows in German/English and dark/light mode. Exercise creation, batch organization and navigation guards remain separate work.

- [x] Sort the ILIAS default grading order by the feedback recipient surname shown under Evaluation by file; replace the incorrect first-added-team-member lookup.

- [x] Highlight invalid assignment inputs, show localised errors beside each field, and scroll/focus the first invalid input on submission; clear errors as values are corrected.

- [x] Show dismissible, localised green confirmations in assignment management after creation, editing and confirmed deletion, including screen-reader announcements.

- [x] Verify TA assignment deletion after slow or lost ILIAS responses without replaying the deletion; use the native confirmation and show localised errors for uncertain outcomes.

- [x] Correct and grade exercise submissions.
- [x] Connect a phone using a QR code in the desktop app's top-right settings menu.
- [x] Follow live assignment upload links and ILIAS file-field encoding; validate upload responses and confirm the new file, with GTI/MMS regression fixtures.
- [x] Create and edit TA assignments using native form defaults, conditional fields and the correct save/update commands; preserve drafts while selecting the submission type.
- [x] Recognise the native TA list's layout table and unnamed creation button; cover the full list markup through parser, API and browser tests.
- [x] Encode empty TA file controls with explicit empty filenames, including optional subforms; compare with browser FormData and retain rejected HTML for diagnosis.
- [x] Confirm assignment creation works (user verified); preserve ILIAS instruction HTML, restore existing instructions, indicate active formatting, and add HTML editing and a link dialog.
- [x] Follow the native instruction-file upload handler and verify the new attachment; parse the filename column and retain failed queued files for retry. Live attachment upload confirmed by the user.
- [x] Show the fixed submission type explanation in an edit-only info tooltip; preserve live caret formatting when toggling bold and italic independently.
- [x] Preserve formatted instructions in student assignment dialogs and show team controls only for assignments with native Team Upload support; verify rendered styles in light and dark mode.
- [x] Localise known ILIAS assignment status, requirement, type and deadline messages in overviews and dialogs; document localisation requirements in AGENTS.md.
- [x] Evaluation by file for exercise submissions: Parse native ILIAS feedback files table (`ilResourceCollectionGUI`), follow 2-step Dropzone + postUpload upload flow, support file deletion via interruptive form POST, route file downloads through authenticated backend proxy, and provide dedicated management UI in both the submission details modal and the submissions overview table.
- [x] Standardise exercise view layout and navigation: replaced disruptive standalone "Zurück zur Vorlesung" button with unified CompactBreadcrumbs matching CourseView (preventing layout jump), reflected active exercise tabs and TA management views in URL search params, and enabled Mouse 4 & 5 browser history back/forward navigation across all tabs and editor views.
- [x] ILIAS Saver mode & cache timestamping: Added timestamped cache entries and an opt-in ILIAS Saver toggle in settings with custom TTL (2, 5, 10, 15, 30, 60 minutes or custom). Skips automatic background revalidation when cache is fresh while preserving instant manual refresh on demand across CourseView, SemesterView, and ExerciseView.
- [x] Modeless grading feedback: Added a persistent green feedback bar below the TA grading filter menu bar and emerald card highlight banners when saving submission grades. Informs the user when a submission is filtered out of "To Correct", showing student name, assigned grade/status, remaining visible until dismissed via its close button (X), and offering quick 1-click actions to view the submission details or reset the filter.

- [x] Universal custom confirmation and alert dialog system (ConfirmModal.tsx, dialog.ts): Replaced all browser-native window.confirm and window.alert dialogs across the application (ExerciseView, CourseView, CourseManagement, SubmissionDetailModal, StudentAssignmentModal, TAExerciseEditorView, ExerciseModal). Implemented semantic dialog styling (danger, warning, info), keyboard trapping, backdrop blur, light/dark themes, and stacked 44px mobile touch targets.
- [x] Unsaved changes navigation guard lifecycle & duplicate warning fix: Added onDiscard handler to navigation guards. When a user confirms leaving a view with unsaved grading notes or form edits, 
avigationGuard invokes onDiscard to synchronously clear dirty flags, preventing double prompts and ghost warnings when switching between tabs or navigating across courses.
