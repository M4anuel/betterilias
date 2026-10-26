# TODO

Unchecked items are unfinished; completed work is listed separately below.

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
  - [x] Full-height PDF embed containers.
  - [x] Responsive table wrappers and optimal reading measure (~68ch max width for prose).
- [ ] Continue preserving custom lecturer layouts and edge cases.

## Comprehensive ILIAS Object Support & Course Management

**Status:** Inventory of all 30 native ILIAS object types extracted from course authoring views (`htmlfromilias/ActualListOfAllSubjects/Ilias Course Formatting/`). Complete technical specification documented in [`docs/COURSE_MANAGEMENT_SPECIFICATION.md`](docs/COURSE_MANAGEMENT_SPECIFICATION.md). Core learning objects (`file`, `fold`, `exc`, `xoct`, `sess`) are fully supported; remaining objects are catalogued below with current status and integration roadmap.

### Object Inventory & Current Support Status

#### 1. Content (`Inhalt`)
- [x] `file` — **File** (`Datei`): Fully supported. Dedicated file card/row, download link, PDF preview embed, and file size parsing.
- [x] `webr` — **Weblink** (`Weblink`): Partially supported. Detected by `_detect_material_type`, opens external link in a new tab.
- [ ] `copa` — **Content Page** (`Inhaltsseite`): Needs parser to extract rich HTML page content directly into BetterIlias rather than redirecting.
- [ ] `glo` — **Glossary** (`Glossar`): Needs glossary term extraction, search, and letter index navigation.
- [ ] `lm` — **Learning Module ILIAS** (`Lernmodul ILIAS`): Needs chapter tree and page navigation viewer.
- [ ] `htlm` — **Learning Module HTML** (`Lernmodul HTML`): Needs sandboxed iframe viewer with asset resolution.
- [ ] `sahs` — **Learning Module SCORM** (`Lernmodul SCORM/AICC`): Needs SCORM API player runtime wrapper.
- [ ] `dcl` — **Data Collection** (`Datensammlung`): Needs table view, field filters, and entry detail view.
- [ ] `xds2` — **Literature Ordering (DigiSem)** (`Digitale Seminarbibliothek`): Needs status display and direct link handling.

#### 2. Video and Audio (`Video und Audio`)
- [x] `xoct` — **Video- & Audioseries (Opencast/Tobira)** (`Video- & Audioserie`): Supported. In-app Opencast podcast player modal with dual-stream audio/slides support.
- [ ] `xvid` — **Interactive Video** (`Interaktives Video`): Needs interactive video player supporting embedded questions and jump markers.
- [ ] `mep` — **Media Pool** (`Medienpool`): Needs media gallery viewer (audio/video/image assets).

#### 3. Organisation (`Organisation`)
- [x] `fold` — **Folder** (`Ordner`): Fully supported for browsing. Multi-column row layout, nested navigation, breadcrumbs, search, and file counts.
- [x] `sess` — **Session** (`Sitzung`): Supported. Identified with calendar badge, scheduled date/time, and room/location details.
- [ ] `itgr` — **Item Group** (`Objektgruppe`): Needs container/section divider styling to group related materials logically under a title.
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

### Instructor & TA Course Authoring Actions
- [ ] Course "Add Object" toolbar button & creation modal (`c-toolbar__item navbar-form -> button "Add Object"`):
  - [x] Support creating folders using fresh native forms, title/description fields, and the available native folder templates (Default/Hidden folder; `dtpl_5` is not a column layout).
  - [x] Support uploading files using the native temporary-upload handler and metadata-save form, multi-file dropzone, per-file progress, license selection, and verified creation.
  - [ ] Support creating weblinks (`ilObjLinkResourceGUI&new_type=webr`).
  - [ ] Support creating item groups (`ilObjItemGroupGUI&new_type=itgr`).
  - [ ] Support creating exercises (`ilObjExerciseGUI&new_type=exc`).
- [ ] Support deleting course objects with native confirmation (`select_and_deleting.html` via `ilObjectTableGUI&cmd=delete`).
- [ ] Support course page customization & resource placement (`edit_page.html` via `ilPCResourcesGUI`).

## Media & Podcast Streaming

- [ ] Native In-App Opencast Podcast Player with Dual-Stream Support:
  - [ ] Synchronized playback for presenter camera feed (with `mainAudio`) and presentation slides feed.
  - [ ] Viewing layouts: Picture-in-Picture (PiP), Side-by-Side (desktop split), and one-click screen swap.
  - [ ] Bandwidth Saver / Slides-Only Mode: Ability to set presenter video quality to lowest (480p) while keeping presentation slides at 1080p.
  - [ ] Slide chapter navigation using Opencast `frameList` thumbnails and timestamps.
  - [ ] Fast on-demand stream resolution for podcast episode IDs (`eid`).

### Technical Specification & Findings for Podcast Streaming
*(Reference dump inspected under `htmlfromilias/PodcastStreaming/`)*

1. **Episode URL & Player Initialization:**
   - Episodes in ILIAS point to:
     `https://ilias.unibe.ch/ilias.php?baseClass=ilobjplugindispatchgui&cmdClass=xoctPlayerGUI&cmd=streamVideo&ref_id=<ref_id>&eid=<eid>`
   - Requesting this page with authenticated session cookies returns an HTML payload containing:
     `il.Opencast.Paella.player.init(<config_json>);`

2. **Stream Structure & Audio Track Mapping:**
   - `<config_json>.streams` provides two synchronized MP4 streams:
     - **Stream 0 — Presenter Camera:** `content: "presenter"`, `role: "mainAudio"`. Contains the lecturer camera feed **and the primary AAC audio track** from the lecture hall microphone.
       - *1080p:* ~1,078 MB (Video ~1665 kbps, Audio 129 kbps AAC stereo 44.1 kHz)
       - *720p:* ~716 MB (Video ~1059 kbps, Audio 129 kbps AAC stereo 44.1 kHz)
       - *480p:* ~443 MB (Video ~668 kbps, Audio 65 kbps AAC mono 44.1 kHz — crystal clear voice quality, cuts data by ~60%)
     - **Stream 1 — Presentation/Slides:** `content: "presentation"`, `role: null`. Contains the projector / slides screen capture. Muted / video-only (854x480, 1280x720, 1920x1080).
     - **Bandwidth Optimization Tip:** When students only care about the presentation slides, BetterIlias can stream the 480p presenter feed for audio and the 1080p presentation feed for crisp slide text, saving over 600 MB of cellular/Wi-Fi bandwidth per lecture with zero loss in spoken audio comprehension.
   - **Stream Synchronization:** Both streams start at timestamp `t = 0.000` and have identical duration (`<config_json>.metadata.duration` in ms).
   - **CDN & Range Requests:** Streams are hosted on `https://dist.opencast.unibe.ch/...mp4`. They support standard HTTP byte-range requests (`HTTP 206 Partial Content`) and do **not** require cookies, credentials, or special CORS headers.

3. **Slide Timestamps & Thumbnails (`frameList`):**
   - `<config_json>.frameList` contains an array of slide change events:
     ```json
     [
       { "id": "frame_0", "time": 0, "url": "https://dist.opencast.unibe.ch/.../frame_0.jpg", "mimetype": "image/jpeg" },
       { "id": "frame_119", "time": 119, "url": "https://dist.opencast.unibe.ch/.../frame_119.jpg", "mimetype": "image/jpeg" }
     ]
     ```
   - Can be used directly in the UI as a chapter scrubber or slide sidebar.

4. **Frontend Dual-Video Sync Architecture:**
   - Use two HTML5 `<video>` elements:
     - Master video: Presenter (with sound unmuted).
     - Slave video: Presentation (muted to avoid potential audio conflicts/echo).
   - Sync logic:
     ```ts
     const syncPlayback = () => {
       if (Math.abs(presentationRef.current.currentTime - presenterRef.current.currentTime) > 0.3) {
         presentationRef.current.currentTime = presenterRef.current.currentTime;
       }
     };
     presenterRef.current.onplay = () => presentationRef.current?.play();
     presenterRef.current.onpause = () => presentationRef.current?.pause();
     presenterRef.current.onseeking = syncPlayback;
     presenterRef.current.ontimeupdate = syncPlayback;
     ```
   - Layout modes:
     - **Picture-in-Picture (Default):** Presentation full container width; presenter camera floating card in the bottom corner with a 1-click swap button.
     - **Side-by-Side:** 70% slides / 30% camera or 50/50 split on desktop screens.

## Teaching assistant tools

- [x] Support creating folders (`ilObjFolderGUI&cmd=save&new_type=fold`).
- [ ] Support creating exercises (`ilObjExerciseGUI&cmd=create&new_type=exc`).
- [ ] Support course content creation via native "Add Object" dialog (`cmd=create&new_type=<type>`).
- [ ] Course object management: delete, reorder, and organize items into folders/item groups.
- [ ] Course page layout editor (`ilPCResourcesGUI`).
- [ ] Identify remaining TA workflows that should be available in BetterIlias.

## Data Safety & Navigation Guards

- [x] Confirm before leaving the page when there are unsaved steps or pending operations:
  - [x] Unsaved grading & corrections: Prompt the user with a confirmation dialog before navigating away if any submission has unsaved edits (e.g. modified points/mark, passed status, feedback statement, or internal tutor notice).
  - [x] In-progress uploads & pending requests: Guard against accidental tab closing or navigation while file uploads (student assignment files, TA feedback files, instruction attachments) or background POST/DELETE requests are actively in flight.
  - [x] Handle both in-app navigation (tab switching, breadcrumbs, back/forward history, Mouse 4 & 5) and browser-level actions (tab close, window close, page reload via window.beforeunload).

## Completed

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
