# ILIAS support inventory

Last audited: 2026-10-27, against the current implementation. This is the record
of **what BetterIlias actually handles**. Use [TODO](../TODO.md) for future work
and the [unified management plan](UNIFIED_MANAGEMENT_PLAN.md) for the design.

## How to read this inventory

- **Native workflow:** BetterIlias provides its own UI and communicates with
  ILIAS; the supported operations are listed explicitly.
- **Structured rendering:** Existing content is parsed into BetterIlias blocks
  or components. This does not imply that the element can be authored here.
- **Recognized/link:** A type is identified, but its activity opens in ILIAS or
  at an external URL rather than running inside BetterIlias.
- **Generic HTML:** Markup may survive rich-content extraction; there is no
  dedicated parser/player for that feature and no claim of complete behavior.
- **Catalogue only:** The type is listed and localized in Add content, with
  creation disabled. It does not yet have a dedicated content workflow. A
  generic link may still be shown if the existing material parser extracts it.

The catalogue's 30 types are the types found in the supplied course-authoring
saves, not a claim to cover every ILIAS version, installation or plugin.
Recognizing a label in the catalogue does not guarantee type detection in all
course layouts. In particular, `_detect_material_type` still has heuristic
fallbacks and does not recognize all 30 types explicitly.

## Repository objects: all 30 course-catalogue types

| Native type | Object | Current handling | Authoring and limits |
| --- | --- | --- | --- |
| `file` | File / Datei | Native material rows/cards, authenticated download proxy, size/properties; existing embedded PDFs receive specialized rendering. | Upload with native temporary-upload + metadata-save flow, license selection, three concurrent workers and per-file results. Single/bulk deletion with native confirmation. Shared ordering where the native Sorting form supports it. No general rename/version-management editor. |
| `xds2` | Literature ordering / DigiSem | Catalogue only. | No ordering/status workflow. |
| `webr` | Weblink | Recognized/link: extracted resource URL opens outside BetterIlias. | Creation, editing and deletion are not implemented as dedicated workflows. |
| `copa` | Content page / Inhaltsseite | Catalogue only as a repository object. Rich HTML already embedded in a course page is handled separately below. | No dedicated standalone content-page reader/editor. |
| `glo` | Glossary / Glossar | Catalogue only. | No term extraction, search or letter index. |
| `lm` | ILIAS learning module | Catalogue only. | No chapter-tree/page-navigation reader. |
| `htlm` | HTML learning module | Catalogue only. | No packaged-asset resolver or dedicated sandboxed module viewer. |
| `sahs` | SCORM/AICC learning module | Catalogue only. | No SCORM runtime, completion tracking or score reporting. |
| `dcl` | Data collection / Datensammlung | Catalogue only. | No native table, entry-detail or filtering workflow. |
| `xoct` | Opencast/Tobira video and audio series | Episode metadata, pagination, recorded/scheduled filters and search. Native on-demand Paella MP4 resolution for episode links and course embeds, synchronized audio/slides, inset or split views, screen swap, overlay quality settings, chapter timeline previews, whole-player keyboard shortcuts, canvas-only fullscreen and supplied WebVTT/SRT subtitles. Internally these resources commonly map to `mcst`. | HLS/DASH-only configurations, DFXP captions, OS-level picture-in-picture and series creation/deletion remain unsupported. Live authenticated playback and physical mobile-device acceptance remain pending. |
| `xvid` | Interactive video | Catalogue only as a repository activity. Generic embedded media is not an interactive-video implementation. | No embedded-question, feedback, branching or jump-marker runtime. |
| `mep` | Media pool / Medienpool | Catalogue only. | No asset-gallery browser or media-pool management. |
| `fold` | Folder / Ordner | Native hierarchical browsing, breadcrumbs, material search, cached folder discovery/counts and folder navigation inside management mode. | Create with title, description and fresh native templates; single/bulk deletion with recursive review and cascade acknowledgement; shared ordering where offered. `dtpl_5` means Hidden folder, not columns. Move/copy/evacuation and a general folder-settings editor remain pending. |
| `sess` | Session / Sitzung | Structured session drawers with date/time/location, past/upcoming information and on-demand nested materials. | No native session creation, editing, attendance or deletion workflow. Management inspection recognizes sessions as possible containers but refuses incomplete inspection. |
| `itgr` | Item group / Objektgruppe | Catalogue only as a repository type. Existing resource groups on a course page can be rendered as grouped material blocks. Management inspection also recognizes the container icon. | No dedicated item-group creation/settings/resource-assignment editor. Do not confuse rendering a resource group with implementing the repository object. |
| `lso` | Learning sequence / Lernsequenz | Catalogue only for learning behavior; recognized as a possible container during management inspection. | No step progression, prerequisite or completion runtime. |
| `frm` | Forum | Detected and represented as linked material; forum-only material groups get forum styling. | Threads/posts remain in ILIAS. No native forum reader, posting, moderation or creation. |
| `blog` | Blog | Catalogue only. | No post timeline, comments or authoring. |
| `wiki` | Wiki | Catalogue only. | No page/history reader, wiki-link resolver or editor. |
| `xpdl` | Etherpad text editor | Catalogue only. | No dedicated collaborative editor integration. |
| `grp` | Group / Gruppe | Explicit recognition and generic container browsing in the repository explorer; recognized as a container for management inspection. Course-material detection is less comprehensive. | No dedicated group workspace, group-membership management or group creation/deletion workflow. |
| `exc` | Exercise / Übung | Native exercise overview, assignment details, formatted instructions, instruction-file downloads, student submission uploads/deletion and supported team controls. TA views support grading, feedback files and assignment management. | Create/edit/delete **assignments within an existing exercise**, reorder assignments, manage instruction attachments and grading. Creating/deleting the repository exercise container is not implemented. Assignment type is fixed after creation; forms expose supported native fields rather than every possible ILIAS assessment feature. |
| `tst` | Test | Recognized/link: opens the ILIAS test environment. | No native test runner, question editor, scoring runtime or test creation. |
| `qpl` | Question pool for tests | Catalogue only. | No instructor question-pool browser/editor. |
| `prtt` | Portfolio template | Catalogue only. | No template preview or portfolio-authoring workflow. |
| `poll` | Poll / Umfrage | Catalogue only. | No native voting or live-results workflow. |
| `xlvo` | LiveVoting | Recognized/link with voting-specific icon/action. Internally commonly mapped to `voting`. | Voting runs in ILIAS; no native voting/results or creation workflow. |
| `svy` | Survey / Befragung | Catalogue only. | No native participation, results or authoring workflow. |
| `spl` | Question pool for surveys | Catalogue only. | No survey-question pool browser/editor. |
| `xsev` | Self-evaluation / Selbstevaluation | Catalogue only. | No questionnaire/rubric runtime or results charts. |

### Additional navigation types and aliases

| Type/context | Current handling |
| --- | --- |
| `crs` — Course | Dashboard/semester discovery, course opening, repository cards, membership availability and supported join/leave forms, breadcrumbs and course contents. Course creation and full administration are not implemented. |
| `cat` — Category; repository root | Repository explorer parses categories and available/locked objects, supports nested navigation and breadcrumbs. No category/root authoring UI. |
| `mcst` — MediaCast/legacy podcast alias | Shares the podcast discovery/modal path. This internal label does not establish support for every MediaCast deployment. |
| `voting` | Internal display/detection alias used for LiveVoting links. |
| `other` / unknown | Generic extracted item/link fallback. No dedicated type-specific workflow or promise of interactivity. |

## Page elements: the complete insertion menu in the supplied saves

These are elements of the course/folder **page**, not the 30 repository types
above. BetterIlias currently has **no native COPage create/edit/delete adapter
for any of these elements**. Manage → Add content → Text and layout groups
them into 12 user-facing choices and provides an explicitly labelled native
ILIAS editor handoff when the current page advertises that capability.

Existing page content has the following reading/rendering support:

| Native insertion-menu entry | How existing content is handled | Boundary |
| --- | --- | --- |
| Insert Text | Rich-content blocks retain extracted paragraphs, headings, emphasis, links and lists. Known headings/dividers receive structured rendering and reading-width styling. | This is reading existing HTML, not a course-page text editor. The assignment-instructions editor is a separate feature. |
| Insert Image/Media | Images, figures, audio/video markup can remain within retained rich content; compatible Opencast containers have a specialized playback/fallback path. | Generic media markup is not a full asset resolver, upload-to-page flow or media editor. Individual media-only layouts/source URLs can need additional handling. |
| Insert Data Table | Existing HTML tables are retained and wrapped for responsive horizontal scrolling, with light/dark styling. | No table creation, cell editing or data binding. |
| Insert Section | Known section headings, dividers and styles become ordered blocks; surrounding extracted content is retained. | No general section/style editor; arbitrary lecturer-defined layouts are not guaranteed. |
| Insert Accordion/Carousel | Known ILIAS accordion containers become expandable drawers with extracted text/materials and persisted collapse state. | Carousel-specific playback/swipe/navigation is not implemented as a dedicated component. |
| Insert Column Layout | Known Bootstrap-style `row-flex` layouts and supported column patterns become nested column blocks rendered side by side responsively. | No column-layout authoring, and no guarantee for arbitrary custom grids. |
| Insert Interactive Image | Catalogue/native-editor handoff; retained static image/HTML may still display. | No hotspot, overlay or interaction engine. |
| Insert Content Snippet | Extracted snippet output can render through generic rich HTML. | No snippet identity, reuse/update or snippet editor. |
| Insert Item Group | Existing material/resource group markup is extracted into titled/grouped item blocks; matching items use native BetterIlias rows/cards. | No native resource-assignment editor; deleting a display element must not be treated as deleting its referenced objects. |
| Insert Code | Existing `pre`/`code` content may pass through generic rich HTML. | No dedicated code-element parser, language-aware editor, runner or syntax-highlighting guarantee. |
| Insert Advanced Table | Uses the same generic HTML-table rendering/wrapping where extraction retains it. | No advanced table editing/structure operations or full style parity claim. |
| Insert Advanced List | Existing HTML lists may render through the rich-content path. | No dedicated advanced-list layout/editor semantics. |
| Insert Map | Generic retained HTML/absolute iframe may display; unsupported relative iframe sources fall back to an ILIAS link. | No native map configuration, map-data extraction or interaction integration. |
| Insert existing Interactive Video | Recognized as a native-editor choice, with generic embedded markup at most. | No interactive questions, branching or video-activity integration. |
| Insert Opencast Video | Special Opencast container extraction and keyboard-accessible on-demand launch into the shared synchronized player, with exact native-episode fallback links. | Page-element authoring and non-MP4-only player configurations remain unsupported. |

**Paste/clipboard** is an editing command shown beside those entries, not an
additional content type. BetterIlias does not implement the native COPage
clipboard or page-element history/style editor.

### Additional explicitly handled rendering cases

| Content/layout case | Handling |
| --- | --- |
| Embedded PDF (`iframe`, `embed`, `object`) | Detect `.pdf` sources, normalize supported relative URLs, preserve/render the embed and request hidden viewer chrome plus width fitting through URL flags. Browser PDF-viewer behavior still varies. This does not automatically embed every downloadable PDF. |
| MathML/MathJax output | Recover mathematical markup from known MathJax containers and trigger frontend MathJax typesetting for retained rich content. |
| Accent/section divider titles | Preserve known divider titles/colors and their sequence; avoid merging unrelated headings. |
| Material cards, tiles and lists | Parse supported native list/tile markup into material blocks and rows/cards; preserve source groupings and known presentation hints. |
| Page reading order | Preserve native ILIAS block order and lecturer structure. Personal block ordering/visibility is local; saving repository item order through management changes ILIAS. Creation/upload order is not a universal default. |
| Embedded external frames | Retain supported absolute frames; relative unsupported sources can become an explicit ILIAS fallback. There is no universal embedded-app adapter. |

## Shared management operations

| Operation | Implemented behavior |
| --- | --- |
| Enter/leave management | Permission-aware entry for the current course/folder, with mode continuity within the course and clean normal browsing. |
| Add content | One catalogue; file/folder creation only. Other repository objects are disabled; page elements use the explicit native-editor handoff. |
| File/folder deletion | Single/bulk selection, recursive contents review, explicit folder cascade acknowledgement, fresh native confirmation, matching selected references, rechecks for changed contents and verified absence afterwards. No automatic retry after uncertain outcomes. |
| Deletion scope limits | Only direct selected files/folders are deletion targets. Inspection of nested containers is conservative: unsupported/incomplete/paginated, cyclic or over-limit trees are refused. The review is not an inventory of every private assignment submission. No additional object references are selected automatically. |
| Shared repository ordering | Reads native Sorting controls, preserves unrelated nested position fields, accepts only the current full item set/revision, posts the native save and verifies the result. Offered only when supported controls/items are available. |
| Personal display changes | Existing local block visibility/reordering and virtual all-files display are separate from shared repository ordering or deletion. Hiding a block does not delete content from ILIAS. |
| Navigation/cache safety | Existing unsaved/pending-operation guards protect writes and ordering drafts. Confirmed management changes refresh affected material caches, including an emptied parent. |
| Rename/edit object settings | Not implemented as a general repository workflow. |
| Move/copy/link to another container | Not implemented as native BetterIlias management actions. Dragging management rows changes order only. |
| Evacuate folder contents before deletion | Planned; currently the reviewed operation is cascading deletion, with acknowledgement. |
| Trash/restore | No native trash browser/restore workflow. Recoverability depends on ILIAS settings; the UI does not promise restoration. |

## Evidence and maintenance

Implementation entry points:

- [Object catalogue](../frontend/src/lib/iliasObjects.ts): the 30 types and the
  separate file/folder creation allowlist.
- [Material parser](../backend/scrapers/materials.py) and
  [repository parser](../backend/scrapers/repository.py): type detection,
  containers, rich content and page-block extraction.
- [Course rendering](../frontend/src/components/CourseView.tsx),
  [session drawers](../frontend/src/components/SessionDrawer.tsx) and
  [podcast modal](../frontend/src/components/PodcastModal.tsx).
- [Unified catalogue](../frontend/src/components/AddObjectModal.tsx) and
  [management UI](../frontend/src/components/CourseManagement.tsx).
- [Authoring](../backend/services/authoring.py) and
  [management](../backend/services/management.py) services, plus their native-form
  parsers under `backend/scrapers/`.
- [Exercise routes](../backend/api/routes/exercises.py) and exercise/student/TA
  components: assignment, submission, feedback and grading workflows.

Evidence includes the supplied `Ilias Course Formatting` saves, the sanitized
[authoring fixtures](../tests/fixtures/authoring/README.md),
[management fixtures](../tests/fixtures/management/README.md), parser tests and
real-dump regressions in [test_unibe_real_dumps.py](../tests/test_unibe_real_dumps.py).
Some real-dump tests depend on local HTML files and may be skipped when those
files are unavailable. Mocked native-write and browser tests establish protocol
behavior; they are not proof that every operation has been verified live on
every ILIAS installation.

When adding support, update the relevant row with the exact reading, authoring,
deletion and interaction scope, link the implementation/fixtures, and update
TODO status. A catalogue entry, generic iframe or external link must never be
promoted to full native support without the corresponding workflow.
