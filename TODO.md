# TODO

Unchecked items are unfinished; completed work is listed separately below. Current behavior and limitations are also recorded in [`docs/ILIAS_SUPPORT_MATRIX.md`](docs/ILIAS_SUPPORT_MATRIX.md) and [`docs/COURSE_MANAGEMENT_SPECIFICATION.md`](docs/COURSE_MANAGEMENT_SPECIFICATION.md).

## Deployment and onboarding

- [x] Rebuild Safari Companion independently of Chrome/Firefox: Safari background
  page, isolated cookie verification, activity-based sync and validated upload ZIP.
- [ ] Upload Safari Companion 1.1.0 to Apple's packager and verify TestFlight on
  macOS and iPhone/iPad. Local WebKit/API simulations do not prove native signing,
  packaging, Safari permissions or physical-device background execution.
  See `docs/SAFARI_REBUILD_ANALYSIS.md`.

- [x] Add the public feature request board, browser-owned voting/comments,
  shared forum composer, administrator moderation and bounded image storage.
- [x] Compact request search/filters, disclose public-content/browser ownership
  guidance on demand and make existing administrator status management discoverable.
- [x] Promote request statuses to labelled icon/colour badges above card titles
  and in detail headers, with matching light/dark styles and responsive coverage.
- [ ] Replace the shared administrator key with individual sign-in and server-enforced
  roles (administrator/moderator and scoped permissions), including account recovery,
  revocation and attributable moderation. Until then, request moderation/status
  changes use the existing `ADMIN_API_KEY` login at `/admin/`; do not share this
  full-administration credential with prospective moderators.
- [ ] Strengthen community-board abuse protection as usage grows: authenticated
  ownership/recovery, vote integrity, rate limits and accessible spam prevention.
  Cookie identities intentionally allow a new vote after cookies are cleared.
  See `docs/FEATURE_REQUESTS.md` for storage and deployment details.

- [x] Resolve the Dependabot backlog: paired React updates, compiler-API
  compatibility for TypeScript 7, pinned Docker Actions and Node 26 LTS.
- [ ] Revisit Python 3.15 with a compatible Pydantic/runtime lock and verified
  binary wheels for both container architectures. See `docs/DEPENDENCY_UPDATES.md`.
- [x] Stabilise inline edit actions, constrain reply prose beside its options,
  match forum material rows, and fix pinned-thread parsing/post confirmation.

- [x] Refine forum density, inline post editing, contained reply forms, profile
  photo delivery and thread view counts; verify responsive drafts and slow edits.

- [x] Align native forums with shared caching, sync, breadcrumbs and management;
  fix invisible-content posts, post anchors and contained reply/file-drop layout.

- [x] Add native forum threads, conversation reading/writing, permission-aware
  moderation and responsive introduction editing/preview from the supplied dumps.
  Native text-block editing and implementation locations: `docs/NATIVE_FORUM.md`.
- [ ] Validate native forum posting, attachments, moderation and text-block writes
  against live ILIAS after deployment (current checks use dumps and mock transport).

- [x] Fix the 14 state-machine audit findings: account request ownership, calendar
  merges/polling, editor drafts and write certainty, feedback replacement,
  companion resync, queued dialogs, download deduplication and notification lifetime.
  See `docs/STATE_MACHINE_INTEGRITY.md` for behavior, receipt semantics and validation.

- [x] Unify session/connection recovery in a persistent workspace status card and
  page/modal errors in a shared notice; simplify signed-out landing navigation,
  link Chrome Web Store installation, and cover responsive recovery without replaying writes.

- [x] Remember Assignments/Info/Submissions & Grades per lecture and signed-in
  account; honour explicit links/history and fall back safely without TA permission.
- [x] Open deletion review immediately; keep Cancel available during inspection,
  disable confirmation with a spinner until ready, and show deletion progress until completion.
- [x] Unify management creation/upload/delete/order feedback in dismissible banners;
  prevent unconfirmed upload success and distinguish saved writes from refresh failures.
- [x] Discover course-upload metadata inside empty native HTML templates across
  parser versions; verify handler upload, metadata save and the newly created object.
- [ ] Confirm the reported production course-upload failure with a live retry
  after deployment; the affected user's request/response is not yet available.

- [x] Refine narrow/collapsed sidebar geometry, quiet pin actions, exclusive active
  destinations and confirmed sidebar unpinning; keep content pin toggles instant.

- [x] Add a resizable desktop sidebar, width-aware course layouts and account-scoped
  course pins with parent/current-page controls and full-screen mobile navigation.

- [x] Remove the redundant outer scrollbar from the work-distribution dialog;
  keep its heading/actions visible and allow the body and assignment preview to scroll.

- [x] Reveal the login-status label on mouse hover even when a hybrid device
  reports no hover support; provide keyboard focus, touch access and a 44 px target.

- [x] Remove persistent browser-UUID statistics, its settings and dashboard
  series; delete the old browser preference on app startup and purge stored
  browser samples while preserving short-lived connection counts.
- [x] Anchor desktop/tablet settings below the actual gear button, cap its height
  to the space below that button, and preserve mobile full-screen settings and
  QR/address drafts across resizing.

- [x] Improve private logs with frozen route templates, literal parser names,
  application/backend source version, fixed failure categories and bounded
  code-only frames. Add request-ID lookup in the dashboard/API/CLI while
  excluding runtime values, raw exception text, absolute paths and locals.

- [x] Accept `/admin` as well as `/admin/` and add responsive connection-activity
  graphs for five-minute active connections and rolling 24-hour distinct usage;
  keep pseudonymous samples separate from logs with a 24-hour expiry. See
  [definitions, privacy and proxy setup](docs/ADMIN_DASHBOARD.md).

- [x] Recover manual companion sync when an open app tab has no content-script
  receiver or session header, using separate one-use connection codes per tab.
  Verify header authentication and cookie acceptance with and without the bridge.

- [x] Make Firefox live-tab session events readable across its extension/page
  boundary and propagate extension-storage changes; verify real React course
  requests carry the replacement credential after sync.

- [x] Fix Firefox local host match patterns and verify native popup sync,
  expired sessions, backend errors, request timeout/retry and scoped page handoff.

- [x] Group browser companions under `extensions/chrome/` and `extensions/firefox/`;
  update setup links and provide copy controls for restricted browser-internal addresses.
- [x] Add a Safari MV3 companion and exact-origin upload ZIP, sharing the verified
  manual flow and using tab activity/optional alarms for best-effort automatic sync.
- [ ] Validate the Safari companion on native macOS/iPhone/iPad: website/cookie
  permissions, automatic/manual sync, suspension/resume, popup and toolbar; complete
  Apple packaging, TestFlight acceptance and App Store distribution.

- [x] Enforce strict HTTP session isolation, remove local/manual login, gate
  maintenance endpoints by server runtime mode, replace long-lived URL session
  credentials, and coordinate workers sharing one VPS data volume. See
  [deployment security and limitations](docs/DEPLOYMENT_SECURITY.md).
- [x] Build a responsive bilingual landing/get-started page with extension
  installation, ILIAS sign-in/sync instructions, a BetterIlias preview, and clear
  expired-session/reconnect guidance.
- [x] Keep landing-to-course and overview navigation in sync with the URL;
  preserve the landing view in browser history and honour navigation guards.
- [x] Build an authenticated admin dashboard with separate administrator
  authorization, health/worker/queue metrics, sanitized error reports and audit
  records; keep raw student pages and credentials out of public diagnostics.
  The independent `/admin/` page uses short-lived HttpOnly admin cookies,
  responsive bilingual metrics/log views, filters and event details. Deployment
  and remaining identity/MFA limitations: [admin dashboard](docs/ADMIN_DASHBOARD.md).
- [x] Add the [private logging foundation](docs/OBSERVABILITY_PRIVACY.md): fixed
  security/compatibility events, request timing, write outcomes, bounded local
  retention, privacy-safe parser artifacts and separately keyed read-only admin
  diagnostics. Dashboard UI and administrator sessions are implemented separately;
  operator privacy review remains open before public hosting.
- [x] Connect structured events to JSON console logging and private storage;
  retain safe severity/component context, configurable console verbosity,
  collector failure counters, and filtered read-only local/admin inspection.
- [x] Add [consented diagnostic reports](docs/DIAGNOSTIC_REPORTS.md): once/always/no
  choices, editable sharing and deletion in settings, text-free parser evidence,
  bounded SQLite storage and grouped open/resolved admin review with safe exports.
- [ ] When stable user accounts/profiles exist, move diagnostic-report preferences
  from connection scope to the profile, preserving withdrawal/deletion and policy
  versioning. Add reviewed named-maintainer attribution/fix references if needed;
  resolved reports currently expire instead of forming a permanent bug archive.
- [x] Add shared outbound request budgets, native-session fairness, allowlisted
  in-worker GET coalescing, 429/Retry-After handling and offline multi-process
  10/25/50/100-user load scenarios. See [traffic controls, measurements and
  limitations](docs/OUTBOUND_TRAFFIC.md).
- [ ] Confirm aggregated traffic expectations with university ILIAS support and
  validate configured limits/latency on the intended VPS before broad rollout.
- [x] Restrict server-side targets and redirect hops to configured origins, pin
  public DNS answers at connection time, strip external credentials/cookies,
  constrain resource-proxy commands and bound PDF probes. See
  [target security and deployment limitations](docs/OUTBOUND_TARGET_SECURITY.md).
- [ ] Before multi-VPS scaling, migrate persistent data and coordination to
  networked database/object storage and a coordinator such as Redis. Current
  shared local filesystem locks support multiple containers on one VPS only.
- [x] Prepare pinned frontend/backend container images, tested same-origin Caddy
  routing, private persistent volumes, retention maintenance, GitHub Actions/GHCR
  publication and exact-host Chrome/Firefox packaging. See
  [container hosting](docs/CONTAINER_HOSTING.md).
- [ ] Select the VPS/domain, configure DNS and registry access, review the public
  privacy/imprint text, establish encrypted backups and test restoration. Validate
  production companions and real ILIAS workflows on the chosen public HTTPS host;
  publish the browser packages/store listings and update installation links.

## Teaching-assistant work distribution

- [x] Prevent submission action parsing from borrowing a later participant's
  download URL across feedback/modal handlers; reproduce incorrect submitted
  counts and downloads with German/English ILIAS and app language combinations.

- [ ] Finish the reviewed [TA work distribution, downloads and feedback-return documentation](docs/TA_WORK_DISTRIBUTION.md); core phases are implemented, with remaining plan differences below:
  - [x] Phase 0 & Phase 1: Shared allocations via [BI:<ta_id>|<ta_name>] markers and native saveStatusAll batch updates (backend/services/ta_allocation.py, DistributeWorkModal.tsx).
  - [x] Phase 2: TA and bulk submission downloads with live progress, ZIP streaming, and betterilias-feedback.json round-trip manifest templates.
  - [x] Phase 3: Reviewed feedback return with safe preflight ZIP/folder inspection, mapping preview, conflict detection/resolution, and authenticated publication (backend/services/feedback_import.py, ReturnFeedbackModal.tsx).
  - [x] Phase 4: Hardening (200-char note budget guard, fingerprint concurrency verification, zero-work TA quotas), unmatched-files manual mapping resolver with searchable recipient combobox and portal popover, on-demand overwrite file deletion, and allocation CSV export.
  - [x] Persist assistant count/names/priority per session and lecture, with an
    exercise-scoped fallback and stable slot IDs on this device.
  - [x] Refuse allocations exceeding the 200-character tutor-note budget in the
    preview and server; preserve human note text and recheck fresh native state.

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

- [x] Remove the extra document scrollbar and blank space in My Courses & Groups
  by containing screen-reader course titles within their buttons; verify long,
  filtered and empty lists across viewport sizes, languages and themes.

- [x] Keep sidebar icons/rows stationary throughout collapse, prevent header
  wrapping, unify primary icon/label colours and keep compact-rail editing accessible.

- [x] Keep one visible ILIAS sync animation per page during initial loads and
  cached refreshes; consolidate nested session/feedback requests and retain
  static placeholders, error cleanup and reduced-motion support.

- [x] Scope custom sidebar dividers/order to each semester, and add guarded
  Escape navigation (back once; twice within 700 ms for the semester overview)
  while preserving dialog/menu/editor/fullscreen dismissal and navigation guards.

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
- [ ] Audit the whole app for scrapers and workflows where the user's ILIAS interface language could break BetterIlias:
  - Inspect backend scrapers (`backend/scrapers/`) and service flows (`backend/services/`) for hardcoded or language-specific string matching on ILIAS UI elements (e.g. German vs. English button labels like "Herunterladen" / "Download", form submit buttons, table column headers, status badges, or navigation breadcrumbs).
  - Use language-agnostic DOM selectors, input names, and URL command parameters (`cmd=...`, `cmdClass=...`, `baseClass=...`) where available, and support both German and English (and other common ILIAS languages) wherever text inspection is required.
  - Verify key student and TA workflows against both German and English ILIAS fixtures and page dumps to prevent broken actions, missing download links, or false session expirations.

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
- [x] `frm` — **Forum** (`Forum`): Native thread/post workspace, posting and attachments,
  supported thread moderation, and native page text blocks. Remaining operations
  and validation scope are documented in `docs/NATIVE_FORUM.md`.
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

Design: [`docs/COURSE_MANAGEMENT_SPECIFICATION.md`](docs/COURSE_MANAGEMENT_SPECIFICATION.md) and [`docs/UNIFIED_MANAGEMENT.md`](docs/UNIFIED_MANAGEMENT.md).

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

Design and retained stream findings: [`docs/PODCAST_PLAYER.md`](docs/PODCAST_PLAYER.md).

- [x] Native In-App Opencast Podcast Player with Dual-Stream Support:
  - [x] Synchronized playback for presenter camera feed (with `mainAudio`) and presentation slides feed.
  - [x] Viewing layouts: Picture-in-Picture (PiP), Side-by-Side (desktop split), and one-click screen swap.
  - [x] Bandwidth Saver / Slides-Only Mode: Ability to set presenter video quality to lowest (480p) while keeping presentation slides at 1080p.
  - [x] Slide chapter navigation using Opencast `frameList` thumbnails and timestamps.
  - [x] Fast on-demand stream resolution for podcast episode IDs (`eid`).

- [ ] Validate authenticated playback after renewing the expired local ILIAS session, and verify real iOS Safari / Android Chrome playback. CDN byte-range checks and local Chromium decoding pass; these do not replace live account/device acceptance.

## Completed

- [x] Audit all backend Python modules for German ILIAS compatibility, fix confirmed parser/session issues and add focused German-layout regressions; record remaining capture needs in [the German backend audit](docs/GERMAN_BACKEND_AUDIT.md).

- [x] Fetch complete assignment submissions independently of saved native ILIAS filters, page offsets and row limits; reset to default filters and 800 rows per network read without restoring the native view, and replace legacy partial caches.

- [x] Keep submission-details Save/Close labels on one line with responsive action rows, and use Swiss ss spelling throughout application text and locale keys.

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

- [x] TA work distribution, allocation notes, and submission export (TA_WORK_DISTRIBUTION.md):
  - [x] Added DistributeWorkModal.tsx for configurable tutor quotas, priority reordering, and preview before saving.
  - [x] Implemented compact versioned tutor notice markers ([BI:<ta_id>|<ta_name>]) preserving human note text and respecting the 200-character native ILIAS limit.
  - [x] Implemented native multi-row note updates (cmd[saveStatusAll]) echoing existing status and marks for every targeted row to prevent grade degradation.
  - [x] Added structured submission bundle export (GET /exercises/{exercise_id}/assignments/{ass_id}/export-zip) containing etterilias-feedback.json manifest, organized files, and return feedback placeholders.
  - [x] Added TA filter selector (All / Unassigned / per-TA) in the submissions overview.
