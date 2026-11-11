# Native forums

Forum material cards and pinned forum links open an in-app repository container
(`?course=<course>&folder=<forum>`). Its `container_type: "frm"` selects the forum
workspace. Course navigation and browser Back retain the existing history flow.

The workspace shows threads on the left and the selected conversation on the
right. On phones it shows one pane at a time, with a Back to threads control.
Posts use the existing 68ch prose limit, with a 72ch outer message bubble. Wide
code/tables get labelled, keyboard-focusable scrolling regions. Live native
profile photos use authenticated resource downloads; missing photos use initials.
Names, lecturer content and dates are preserved; known relative date labels are
localized. Thread search filters the current native listing page.

Forum listings, each thread/page and page-editor models use the shared browser
cache, keyed by account, forum and native page. Cached data renders immediately;
background reads refresh it without replacing drafts. ILIAS Saver respects its
shared TTL. The standard `SyncRefreshControl` bypasses that TTL, including while
editing text blocks. Failed background reads retain the cached content. Successful
writes invalidate the forum's other cached views; logout/account changes clear
the forum cache with the other private page caches.

The header uses `CompactBreadcrumbs` and the normal page-management toggle.
There is no separate Conversations tab. The reply composer stays inside the
viewport-sized forum workspace, with reachable cancel/publish actions and a
compact editor; on phones it replaces the message list while composing. File
selection/drop handling is shared with course uploads in `FileDropzone.tsx`.
Post subjects remain visible even when a body contains only invisible Unicode
format characters. Clicking a subject or native `selectPost`/post link highlights
the post locally instead of navigating to ILIAS.

## Implemented interactions

- Read thread lists/posts, unread/pinned/closed indicators and native pagination.
- Create threads, reply to individual posts, edit posts with a fresh native form,
  choose reply notifications, upload attachments and download post attachments.
- Close/reopen, pin/unpin and delete a thread when ILIAS exposes that action.
  Deletion uses a fresh native confirmation and verifies the exact selected ID.
- The page-management view adds, edits and deletes individual native text blocks.
  Other page elements remain in place and appear as read-only previews. The
  thread area is represented by a placeholder below the custom page elements.
- Drafts survive responsive resizing and background reads. Leaving a dirty
  editor asks before discarding. Page refresh retains a text draft; replacing a
  concurrently changed block requires review/confirmation.

This implements text blocks in an existing forum page, not a general editor for
all ILIAS page-component types. Forum-container creation/settings, moving or
merging threads, renaming threads, post deletion/censorship, subscription settings
and moderator assignment remain in ILIAS. These unavailable operations are not
presented as working BetterIlias actions.

## Native write protocol

Every read/write requires the current tenant credential. Native control URLs,
CSRF fields and paragraph-adapter endpoints are discovered afresh from the
authorized page. No browser-supplied native action URL is accepted. HTTP writes
require explicit credentials, while profile photos/attachments use the existing
HttpOnly credential cookie. No session ID is placed in a URL.

Post creation/editing uses the native form's hidden fields, chosen submit command
and upload field names. COPage editing uses its discovered server adapter:
`Page/ui.all` loads models; `Paragraph/insert`, `update` and `delete` operate on
one component. Existing paragraph characteristics are retained. A page revision
over all models prevents overwriting another editor's change. Shared forum-write
coordination serializes BetterIlias writers across workers on the existing shared
local data volume.

Private atomic receipts under `COORDINATION_DIR/forum-writes` and
`COORDINATION_DIR/forum-page-writes` are keyed by tenant, forum and operation ID.
They contain fingerprints, object IDs and dispatch/confirmation state. They do
not contain message bodies, uploaded bytes or credentials. After an uncertain
POST, a retry reconciles readback without dispatching it again. Dispatched
receipts do not expire automatically; deleting them could permit a duplicate
write. Native paginated reconciliation is bounded to 100 pages and fails closed
if a result cannot be uniquely confirmed.

The resource proxy's forum exception permits only `viewThread` with an exact
forum/post selector and a 32-digit hexadecimal attachment identifier. Reply,
edit, draft and mark-read parameters remain blocked in the resource proxy.

Protocol references: the supplied forum dumps, ILIAS's
[COPage client](https://github.com/ILIAS-eLearning/ILIAS/blob/release_9/Services/COPage/Editor/js/src/client/client.js),
[paragraph action handler](https://github.com/ILIAS-eLearning/ILIAS/blob/release_9/Services/COPage/PC/Paragraph/class.ParagraphCommandActionHandler.php),
and [forum controller](https://github.com/ILIAS-eLearning/ILIAS/blob/release_9/Modules/Forum/classes/class.ilObjForumGUI.php).
The 68ch layout follows the existing app's prose rules and is below the
[W3C visual-presentation guidance](https://www.w3.org/WAI/WCAG21/Understanding/visual-presentation)
of 80 characters; this does not claim full WCAG conformance.

## Where the implementation lives

| File | Responsibility |
|---|---|
| `frontend/src/components/ForumView.tsx` | Thread/conversation panes, post composer, moderation and recovery |
| `frontend/src/components/ForumPageEditor.tsx` | Native text-block editing and thread-area placeholder |
| `frontend/src/components/InstructionEditor.tsx` | Shared rich-text controls, configurable labels/sanitizer and disabled state |
| `frontend/src/lib/forum.ts` | Typed client, rich-content sanitization, date labels and operation IDs |
| `frontend/src/lib/cache.ts` | Account/forum/page caches, Saver freshness and mutation invalidation |
| `frontend/src/components/FileDropzone.tsx` | Shared drag-and-drop/native file selection for forum and course uploads |
| `frontend/src/components/CourseView.tsx` | Forum cards and native forum-container selection |
| `frontend/src/lib/sidebarPins.ts` | Native forum pin destinations |
| `frontend/src/index.css` | Forum layout and readable/scrollable rich content |
| `backend/forum_models.py` | Public forum/page request and response schemas |
| `backend/api/routes/forums.py` | Credential-protected forum and page endpoints |
| `backend/scrapers/forum.py` | Native thread/post/form parsing and inert rich content |
| `backend/services/forum.py` | Native forum reads, posting, receipts and moderation |
| `backend/services/forum_page.py` | COPage adapter discovery, page revisions and paragraph receipts |
| `backend/services/ilias_client.py` | Forum/page service mixins and forum-container dispatch |
| `backend/scrapers/materials.py`, `backend/schemas.py` | Forum-container recognition and metadata |
| `backend/outbound_targets.py` | Strict native attachment resource validation |
| `backend/observability.py` | Fixed-name audit events without content/credential logging |
| `backend/main.py` | Forum router registration |
| `locales/en.json`, `locales/de.json` | English and Swiss Standard German interface text |
| `tests/test_forum.py`, `tests/test_forum_page.py` | Native forms, supplied dump parsing, permission and failure regressions |
| `tests/test_forum_browser.py` | Responsive interactions, drafts, native page editing and production-build navigation |

## Validation scope

Parser tests read the supplied private dumps locally without copying their user
content into the repository. Other tests use synthetic markup and mock native
transport. Browser coverage uses installed headless Chrome at 320/390/430/768/1280
CSS px and short landscape, German/English, light/dark, with screenshot review.
The page-command tests follow the native COPage protocol and verify add/update/
delete, preservation of other components, stale revisions and lost responses.

No live ILIAS write, physical iOS/Android test or end-to-end screen-reader audit
was performed. Production compatibility still needs a live user exercise of the
forum and text-block workflows after deployment.

Verification results for the caching/layout follow-up: full Python suite 696
passed; a combined 97-case forum/authoring/page-sync/sidebar browser run passed.
The final forum and shared-upload browser run passed 57 cases (55 forum cases).
The production build, 2,208-key locale validation, six localization runtime
tests and launcher syntax check passed. Screenshots remain in ignored
`scratch/forum-checks`.

The follow-up checks cover forced refresh, Saver TTL,
cached reads during background failure, cross-account/logout isolation,
invalidation, post highlighting, drag-and-drop, shared navigation and responsive
scroll containment. The new private dump's invisible body/changed subject is
covered without copying student content into repository fixtures.
