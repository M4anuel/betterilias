# TA work distribution, downloads and feedback return — implementation plan

**Status:** planning only. No feature implementation or live ILIAS writes were performed.
**Research date:** 30 October 2026. **Repository baseline:** `822c6d6`, including the recent native submission-download parsing/proxy fix.

## 1. Improved implementation prompt

> Design, but do not implement, an assignment-level work-distribution system for teaching assistants in BetterIlias. Inspect the existing application, saved ILIAS pages and upstream ILIAS source first. Clearly distinguish verified native capabilities, version-dependent behavior and unresolved questions.
>
> Add a “Distribute work” action to the tutor submissions view. Its dialog should accept any positive TA count within a documented operational limit, editable names with TA1/TA2/etc. defaults, and an ordered priority list. Cache these defaults per authenticated user and lecture/course, while saving the actual assignment mapping in ILIAS tutor-internal notes so other BetterIlias users can read it. Preserve existing notes, grades, statuses and student-visible feedback.
>
> Support random allocation and deterministic sorting, defaulting to native ILIAS order, with team-number, submission-time and participant-name alternatives where applicable. Divide unique submission units evenly; the first assistants in the chosen priority order receive the remainder. Preview the exact result before saving. Use native multi-row note saves rather than one grading request per row.
>
> Offer submission downloads for the whole assignment or one assistant using native bulk/selected downloads when supported. Account for native background jobs and provide a bounded fallback when necessary.
>
> Allow a TA to return feedback using a folder or ZIP. Support a BetterIlias manifest format, explicitly identified team/participant folders, and native ILIAS feedback ZIPs where supported. Discover whether native multi-feedback infrastructure still exists, including its team limitations. Match through verified native identities, preview every recipient/file mapping, and publish only after confirmation. Reuse existing per-submission feedback upload infrastructure when a native bulk import is unavailable.
>
> Cover team and individual assignments, pagination, note-length limits, concurrent tutors, partial failure/retry, authentication, privacy, mobile use, localisation and accessibility. Produce a phased Markdown implementation plan, proposed interfaces, release gates and acceptance tests. Do not add application code, endpoints, UI components or live write probes in this task.

## 2. Research findings that determine the design

| Capability | Evidence | Consequence |
| --- | --- | --- |
| Tutor notes already exist | `SubmissionItem.notice`, `GradeSubmissionRequest.notice`; `parse_exercise_submissions()`; `ExerciseView.tsx` note editor | Extend this workflow; do not create a separate private-only allocation database. |
| Multi-row note saving is native | Saved `evaluation_by_file/submissions_and_grades_view.html` contains `cmd[saveStatusAll]`, repeated `listed_part_ids[]` and `notice[participant-id]`. Upstream implements `saveStatusAllObject()`. | Save batches through discovered native forms. |
| The captured note input is short | The real fixture has `maxlength="200"` on its tutor-note input | A complete JSON roster/plan cannot simply be appended to every note. Budget the marker and preserve existing text. |
| A note-only POST can change grades | Upstream `saveStatusAllObject()` supplies a status for every listed participant; `saveStatus()` maps an empty status to “not graded” [S1, S4] | Echo each targeted row’s freshly fetched native status. Omitting status is unsafe. |
| Team writes propagate | `saveStatus()` expands a representative participant into the submission’s team members [S1, S4] | One work unit per team; verify preservation and consistency of underlying member notes/statuses. |
| Selected downloads already exist | The saved native table contains `selected_cmd=downloadSelected` and `sel_part_ids[]`; upstream passes selected participants into `downloadSubmissionsObject()` [S1] | A TA’s set can use a real native bulk operation, subject to deployment verification. |
| A bulk download may not return a ZIP immediately | Upstream launches `ilDownloadSubmissionsBackgroundTask`, then redirects to the overview [S1] | Treat the response as job initiation, not as archive bytes. Discover the native completion/download workflow. |
| Multi-feedback still exists upstream | ILIAS 9 and 10 provide structure download, ZIP upload, confirmation and save commands [S1, S4] | Investigate a native adapter before building a wholly custom uploader. |
| Native multi-feedback UI excludes team assignments in the inspected versions | Toolbar logic only exposes it for non-team assignment types with tutor feedback files enabled [S1, S4]. No multi-feedback action was found in the local saved team view. | Do not promise native team ZIP import. Use existing team feedback-file operations as the supported fallback. |
| Individual ZIP identity is a user ID, not a team number | Structure folders contain surname/first name/login/user ID; the reader takes the final underscore-separated ID and validates exercise membership [S2, S3] | Names are display metadata, not the matching key. Team and individual formats require separate adapters. |
| Native feedback import has a confirmation step and notification effects | Native confirmation lists recipient/file selections; commit adds files, marks feedback availability and sends notifications [S1–S3] | Preview before final commit and explain that recipients may be notified. No promise of silent publication or a single notification per team. |
| A useful fallback already exists | `upload_submission_feedback_file()` and the feedback-files routes perform the native upload + `postUpload` resource-token flow | Reuse the native feedback collection for each unit, without uploading once per team member. |

### Evidence scope

Local inspections were read-only. No current authenticated deployment, native bulk download job, team-wide note write or feedback publication was exercised. The deployed Uni Bern ILIAS version is not established by this research. Upstream support does **not** prove that a particular native action is exposed to this user on this installation.

Pinned official source references:

- **S1:** [ILIAS 9 exercise management](https://github.com/ILIAS-eLearning/ILIAS/blob/ba6f1323d3ae1cd77a06b67b7d525b9abb951912/Modules/Exercise/classes/class.ilExerciseManagementGUI.php): toolbar conditions around lines 470–485; selected/bulk download 515–540; note/status writes 1405–1492; multi-feedback 1815–1939.
- **S2:** [ILIAS 9 feedback ZIP manager](https://github.com/ILIAS-eLearning/ILIAS/blob/ba6f1323d3ae1cd77a06b67b7d525b9abb951912/Modules/Exercise/TutorFeedbackFile/TutorFeedbackZipManager.php): structure naming 55–84; publication and notifications 120–159.
- **S3:** [ILIAS 9 feedback ZIP repository](https://github.com/ILIAS-eLearning/ILIAS/blob/ba6f1323d3ae1cd77a06b67b7d525b9abb951912/Modules/Exercise/TutorFeedbackFile/TutorFeedbackZipRepository.php): recipient/path interpretation 101–129. [Confirmation table](https://github.com/ILIAS-eLearning/ILIAS/blob/ba6f1323d3ae1cd77a06b67b7d525b9abb951912/Modules/Exercise/classes/class.ilFeedbackConfirmationTable2GUI.php): native recipient/file selection values.
- **S4:** [ILIAS 10 exercise management](https://github.com/ILIAS-eLearning/ILIAS/blob/5feb6dbfa7ad63d185ef8fbf9fae0128b56b04e3/components/ILIAS/Exercise/classes/class.ilExerciseManagementGUI.php): same non-team UI restriction around 447–455, status propagation 1418–1451, and multi-feedback 1723–1847.

## 3. Scope and defaults

- “Lecture” means the enclosing `courseRefId` supplied to `ExerciseView`. Cache the TA count, stable local slot IDs, names, priority, allocation mode and last selected TA under `(session/account scope, courseRefId)`. If no course is available, use an explicit exercise-scoped fallback; never a global cross-course key.
- Actual allocations belong to `(ILIAS installation/client, exercise_ref_id, ass_id)`. Tutor notes on that assignment are authoritative. A local cache is only a draft/default and must not override freshly read notes.
- Default pool: submitted, not-yet-graded work. Allow “all submitted work” explicitly. Show the excluded and unsubmitted counts. The preview must say whether search/filter selections affect the pool; default to the full assignment, not just currently visible rows.
- Default allocation: **sorted, native ILIAS order**. Random is an explicit alternative.
- TA names are editable labels, not permissions or proof of an ILIAS account. Stable slot IDs survive renaming/reordering. Default labels are TA1, TA2, etc.; duplicate labels need disambiguating slot numbers.
- No automatic grade changes, pass/fail decisions, student-comment changes, enrolment/team changes, or email-to-TA workflow.
- Do not redistribute existing allocations when a page refreshes, a TA name changes locally, a late submission arrives or a team changes. These require an explicit previewed operation.

## 4. Canonical work units and identity

Create a normalized assignment snapshot before allocating, downloading or matching feedback:

| Field | Purpose |
| --- | --- |
| Assignment context | Installation/client, exercise reference and assignment ID; course reference for preferences only. |
| Unit key | `team:<verified-native-team-id>` or `user:<verified-native-user-id>`. |
| Native participant IDs | The row representatives/member IDs accepted by native forms, plus verified team membership where available. |
| Display information | Team number/name, participant names/logins, submission time; never the sole write target. |
| Native order index | Position in a complete native assignment enumeration. |
| State snapshot | Existing notice, native grading status, mark, file/collection identities and relevant hidden fields. |
| Fingerprints | Unit-set and relevant-state fingerprints used to detect changes before commit. |

Important identity rules:

1. Deduplicate teams even if ILIAS returns several member rows or propagates the same download link/files to them. Count, assign, download and upload feedback once per team.
2. Do not assume a displayed team number equals the internal team ID. Verify identifiers through native links/forms/team context; `listed_idl_ids[...]` in the saved fixture includes assignment/team context.
3. `SubmissionItem.member_id` currently allows a synthesized name fallback. Such IDs are display-only for this feature: a mutation requires a verified native participant identity.
4. For individuals, use the real user/participant ID; a login is a matching aid only after unique resolution against the current assignment.
5. A team’s representative participant can change. Re-resolve it from the current snapshot rather than persisting a representative as the permanent unit identity.
6. Detect multiple rows that refer to the same shared feedback collection before scheduling uploads.

### Complete enumeration is a prerequisite

The current `get_exercise_submissions()` returns the parsed page and does not enumerate all participant-table pages. Add complete traversal using discovered pagination/row-limit controls, deduplicate units, detect repeated pages, and reconcile totals before allowing “whole assignment” allocation. Native filters must not silently hide units. Any session-level filter/order changes needed by the adapter must be deliberate and restored where possible.

## 5. Distribution dialog and algorithm

Open from the selected assignment’s tutor view, keeping the course/exercise/assignment title visible.

1. **Pool:** show eligible unique teams/individuals, excluded graded work and unsubmitted rows. Block a misleading empty/partial snapshot; offer retry for enumeration failures.
2. **Assistants:** positive integer count, editable names, stable slot identifiers and priority order. Provide up/down buttons as well as optional drag-and-drop. TA counts greater than the work count are allowed with an explicit “some assistants receive no work” preview.
3. **Method:** random or sorted. Sorted options: native ILIAS order, numeric team number when verified, submission time, participant/team display name. Support ascending/descending for explicit field sorts. Disable inapplicable choices instead of guessing.
4. **Preview:** each TA’s quota and actual units, total coverage, remainder recipients, changes to existing allocations, and tutor-note capacity/conflicts. Allow regeneration only explicitly.
5. **Save distribution:** publish exactly that preview after revalidation; show per-batch progress, then a read-back-confirmed result.

For `M` unique eligible units and `N` assistants:

- Each receives `floor(M/N)` units.
- The first `M mod N` assistants in the priority order receive one extra unit each.
- Fill contiguous blocks in that same priority order. This keeps sorted team-number ranges together. Round-robin interleaving is not an MVP option.
- Example: ten units, three TAs, priority `TA2 → TA1 → TA3`: quotas are `4, 3, 3` in that order. Reordering priority must not rename the slots.
- Random mode shuffles units once with a reliable shuffle and then applies the same quotas. Keep the exact mapping in the preview; reopening/re-rendering/saving must not reshuffle it. Record the seed locally for reproducibility, but shared notes store the actual assignment, not a reconstruction dependent on that seed.
- Time sorting uses normalized timestamps and the installation’s timezone. Missing values sort last in either direction; ties use native order and then stable unit key.

“Native ILIAS order” must mean the actual ordered native snapshot. The existing UI’s `ilias` mode resolves feedback-recipient surnames; that is useful existing behavior but is not proof of the exact native table order. Keep these meanings distinct and label any explicit recipient-name sort separately.

## 6. Shared tutor-note protocol and capacity

### Recommended storage contract

Append one compact, versioned allocation suffix to each unit’s tutor note. Preserve all pre-existing human text byte-for-byte where the native field permits it; replace only a recognized BetterIlias allocation suffix during an explicit redistribution.

Illustrative format, to be finalized against native length/encoding tests:

```text
Existing tutor note [BI-TA1|p=7f2c9a10|id=9a18fe02|ta=Ada|n=3|i=1|pr=2|c=10|s=09fa01ab]
```

The marker carries a protocol version, distribution ID, stable TA slot ID, escaped TA label, roster size, slot ordinal, remainder-priority rank, expected unit count and unit-set fingerprint. Field values must have an unambiguous escaped encoding. IDs must be collision-checked and sufficiently random; the short example values above are illustrative, not an entropy specification.

- Keep the assignee readable to a native ILIAS tutor, not just a BetterIlias parser.
- Measure the complete native value against the discovered limit, including Unicode, escaping, existing text and the suffix. The captured limit is **200 characters**, not an invitation to truncate notes to 200.
- If it does not fit, block that unit’s publication and identify the conflict. Offer a shorter TA alias or deliberate human editing; do not erase notes, silently shorten names, split JSON into unrelated tutor notes, or switch to a private-only mapping while claiming it is shared.
- Treat malformed, duplicate or unsupported markers as conflicts/unrecognized text. Do not execute/render markup or infer an allocation from a fuzzy name match.
- A native tutor can edit/delete the suffix. The next fresh read must reflect that; cached allocations must not resurrect it silently.

### What is and is not shared

Per-unit assignees and their labels are shared through ILIAS. The full local roster defaults, random seed and UI preferences are cached per lecture/account. Assistants with **zero assigned units** have nowhere to publish a name in this row-based protocol: another client can reconstruct their numbered empty slots from `n`, but may not recover custom names or priorities for those empty slots. Show that limitation and require those details to be confirmed before extending/rebalancing such a plan. Do not promise fully shared course-wide preferences without an additional storage mechanism.

## 7. Native bulk save, preserving grades and notes

Add a dedicated **bulk allocation-note operation**, not a loop over `grade_student_submission()` and not a call that also saves student-visible feedback.

1. Fetch the current native grading forms, participant identities and states for the relevant pages. Recheck assignment and permissions.
2. Compare unit membership, existing notes and grading values with the preview snapshot. Changes cause a conflict/re-preview, not an overwrite.
3. Discover the current action URL, CSRF fields, submit command, per-row field names and field limits. Do not copy fixture tokens or routing nodes into the implementation.
4. Preserve repeated fields using a multi-value representation. The existing `GradingFormData.hidden_fields: Dict[str, str]` loses repeated names such as `listed_part_ids[]`; it is not sufficient for bulk serialization unchanged.
5. Submit the changed rows through native `cmd[saveStatusAll]` or a verified selected-save equivalent. Include the current native `status[id]` for every listed row, preserve other fields required by that form and exclude untargeted rows from the listed set. Do not indiscriminately submit stale grades/marks for the whole assignment.
6. A single request per native page/bounded batch is the target. Use conservative batch sizes based on the form and configured request limits; account for PHP input-variable/body limits. Never pretend an arbitrarily large assignment fits one POST. Verify the response and every affected note/status/mark by fresh read-back.
7. A 200/302 response or generic success notice alone is not confirmation. The current single-row service has permissive success fallback behavior; the new operation must not inherit it.
8. Report verified, failed, conflicted and unknown-result units separately. Retry only after re-reading actual state. Do not automatically roll back other tutors’ notes or grades using old snapshots.

### Team preservation gate

Native saves expand the representative row to all team members. Establish whether their existing notes/statuses are identical/shared and whether the native interface exposes enough state to preserve them. If members have divergent values that this operation would normalize or overwrite, block that team and explain the conflict. Do not claim strict note/grade preservation without a validated team write contract.

### Concurrent tutors and partial publication

Use a per-assignment write lock within the BetterIlias backend, expected-state fingerprints and immediate read-back. Store one distribution ID across the published unit markers; expected count/set fingerprint help detect incomplete or mixed publication.

A published revision covers the complete currently allocated set. When distributing only a selected eligible pool, carry forward other existing assignees unless their removal is explicitly previewed. If the revision/count/set fingerprint changes, existing allocated rows also need a **metadata-only marker refresh**. Include those writes in the preview and capacity checks; do not leave old markers that would falsely make a legitimate plan look incomplete.

This is optimistic concurrency. Native ILIAS forms do not provide a verified compare-and-swap operation or cross-row transaction; separate BetterIlias servers and direct ILIAS edits cannot be locked by this app. A second tutor must see existing allocations and choose explicitly whether to extend or redistribute them. Concurrent changes detected before a batch block it; changes between native GET/POST remain a documented residual risk. Mixed/incomplete distributions must be labelled and reconciled before offering a supposedly complete TA bundle.

Late submissions remain unassigned by default. “Allocate new work” preserves existing assignees, previews updated loads/priority and changes assignees only for new or explicitly selected units; explain any metadata-only refresh of other rows. For this incremental operation, balance the resulting open-work loads where possible, using the priority order to break ties, rather than claiming the initial equal-split formula always balances an already uneven workload. Team membership changes invalidate affected mappings and feedback previews.

## 8. Submission downloads and a returnable package

Use one compact selector with **All submissions / TA1 / TA2 / …**, followed by Download. TA options come from freshly read shared notes, including custom labels and counts. Unassigned work is visible as a separate option/count. “All” refers to the selected assignment, not the whole course or just the current page.

### Preferred native path

- All: use the discovered `cmd[downloadSubmissions]` toolbar form.
- TA subset: discover the native selected-action form and select the corresponding verified participant representatives using repeated `sel_part_ids[]`. The fixture uses `selected_cmd=downloadSelected` plus its actual Apply control; do not substitute similarly named fields from the existing grading helper.
- Preserve exact form context and tokens. Deduplicate teams and repeated download links.
- Support native immediate archives **and** background-task initiation. Discover job/status/result links from actual native responses. Never download an HTML overview as `submissions.zip`, invent polling endpoints, or announce success before the archive is ready.
- If completion tracking cannot be integrated on this deployment, provide a clearly identified native ILIAS handoff or use the fallback below; this limitation is a release-gate outcome, not an assumed solved API.

### Bounded fallback

Use the authenticated download proxy and verified per-unit links, with limited concurrency, streamed/disk-backed ZIP creation, progress/cancellation, bounded retries and per-unit errors. The recently merged download parsing/proxy changes are reusable. Failures must be listed in a manifest; a partial archive must be labelled partial, not silently complete. Student-uploaded ZIPs remain student files; do not recursively unpack them as trusted structure.

### BetterIlias round-trip contract

Offer a package/template containing a versioned `betterilias-feedback.json`, immutable assignment/unit IDs, distribution ID, expected unit/file mapping, and empty feedback locations, for example:

```text
betterilias-feedback.json
submissions/team-<native-id>/original-file.pdf
feedback/team-<native-id>/           ← TA adds feedback here
```

Individuals use `user-<native-id>`. TA labels can be outer display folders but are not recipient keys. The manifest contains no cookies, session IDs, CSRF tokens or signed/native download URLs. Include only information needed for the round trip.

Only normalize a native bulk ZIP into this structure when its original entries can be mapped reliably to verified units. Otherwise preserve the original native archive unchanged and provide a companion manifest/feedback template; do not guess identities from the names in an unknown archive. The importer must never upload the untouched `submissions/` tree as feedback.

## 9. Folder/ZIP feedback import

### Supported input families

1. **BetterIlias round trip:** manifest plus `feedback/team-<id>/...` or `feedback/user-<id>/...`, either as a directory selection or ZIP.
2. **Explicit native-ID folders:** the same team/user folder layout without a manifest; resolve against the currently selected assignment and show the mapping before upload. Optional single outer wrapper/TA folder must be normalized explicitly.
3. **Native individual multi-feedback ZIP:** use the actual structure downloaded from ILIAS. In inspected ILIAS 9 source, the recipient is the final user-ID component in a second-level folder, with files directly below it; deeper paths are not imported by that native reader. Validate exact structure/context/membership rather than loosely matching names.
4. **Later optional convenience:** flat files with an explicitly chosen naming pattern or a mapping CSV. No fuzzy surname matching or bare “17 means Team 17” guesses; ambiguous/unmatched files require user resolution.

Directory selection must be feature-detected. Keep ZIP and multi-file/manual mapping usable when a browser/device does not expose folder selection. Preserve relative paths supplied by the picker; do not require dragging from a desktop file manager.

### Preflight entirely in BetterIlias

- Stage files privately under the authenticated session and selected assignment. Inspect ZIP entries safely before extraction: reject traversal/absolute paths, symlinks, encrypted/unsupported archives, unreasonable expansion/count/depth/size, and duplicate/case-colliding paths.
- Normalize wrapper directories, ignore only explicitly recognized metadata with a visible skipped-files count, and never infer recipients from TA folder names.
- Verify manifest version/context and re-resolve every unit against current native IDs/membership. A user-supplied manifest is input, not authorization.
- Show source path → team/individual → destination file, existing feedback conflicts, file counts/sizes and chosen publication method. Unmatched, ambiguous, changed-team or foreign-assignment items block those items until resolved.
- Restrict a “return TA’s feedback” operation to that selected TA set unless the tutor explicitly broadens the scope. Do not silently send someone else’s feedback because the ZIP contains extra folders.
- Default to preserving existing feedback. Identical files may be skipped only when identity can actually be established; same name alone is not proof. Conflicting files need explicit skip/rename/validated native replacement choices. Never silently delete existing feedback.
- No uploads to ILIAS during this preflight. Confirmation applies to an exact file-content hash/mapping snapshot; changed inputs require another preview.

### Publication adapters

**Individual assignments, when native multi-feedback is available:** discover the structure/upload form and current upload-token mechanism. Normalize the approved files to the verified native layout, stage the ZIP in ILIAS, parse its native confirmation table, compare its recipient/file mapping with the approved preview, and submit only the corresponding native selections to `saveMultiFeedback`. Stop on mismatches. Capture native side effects, including notifications, in the final confirmation.

Native staging is keyed by assignment and tutor in the inspected source. Serialize import operations for that tutor/assignment and detect a replaced/stale staged ZIP; do not allow another browser tab’s staged upload to be committed accidentally.

**Teams, or deployments without native multi-feedback:** schedule the existing native two-step feedback-file upload for each approved file and unique feedback collection. Do not fan the upload out to every team member. Validate that a representative member URL reaches the team-shared collection and that its sharing/notification behavior matches the intended recipients.

For both adapters, verify destination file/resource identities after writing. The current fallback can recognize an existing title; that alone is insufficient confirmation of a new upload. Track verified/failed/unknown outcomes and hashes locally to avoid duplicate feedback or duplicate notifications after a timeout. A job is not an all-or-nothing ILIAS transaction; resume only after inspecting current native state. File publication must not implicitly save grades or tutor notes.

## 10. Proposed implementation boundaries

These are future interfaces, not routes/classes added by this planning task.

| Area | Proposed responsibility |
| --- | --- |
| `backend/scrapers/submissions.py`, `forms.py`, `feedback_files.py`, optional new bulk-feedback parser | Complete enumeration, native capabilities, verified identities, multi-value fields, limits, job/confirmation forms. Wrap DOM parsers with `@safe_parser`. |
| `backend/services/ta_allocation.py` | Pure allocation/marker parsing, validation, note merge, snapshot/fingerprint comparison and publication result model. |
| `backend/services/exercise_bulk.py` | Native bulk save/download adapters and bounded fallback ZIP jobs; keep HTTP/session ownership in existing client infrastructure. |
| `backend/services/feedback_import.py` | Staging, safe folder/ZIP parsing, mapping, preview, native multi-feedback or per-collection publish adapters and reconciliation. |
| Existing `IliasClient` and session manager | Authenticated requests, current native form discovery, permission/session checks and reusable feedback/download operations. |
| `backend/api/routes/exercises.py`, `backend/schemas.py` | Assignment-scoped preview/commit/job contracts, scoped errors, progress and result summaries. |
| `frontend/.../ExerciseView.tsx` and new distribution/import dialogs | Compact entry actions, TA filter/download choice, editable roster/priority, mapping preview and persistent drafts. |
| `frontend/src/lib/cache.ts` | Account/course-scoped defaults; assignment-scoped read cache with invalidation after verified writes. |

Illustrative API shape: allocation preview/commit under `/api/exercises/{exercise}/assignments/{assignment}/allocation/...`; separate download jobs and feedback-import preview/commit/status endpoints under the same assignment context. Preview returns a snapshot token, exact proposed changes and blockers. Commit supplies that token and an idempotency key; the server rechecks scope/permissions/current state. Job IDs are scoped to the current authenticated user, not globally guessable download links.

Use bounded workers, temporary disk storage, configured upload/archive limits and expiry cleanup. Keep drafts/progress across dialog rerenders and refreshes where appropriate, but do not cache feedback file bodies in localStorage. Record a minimal operation journal for reconciliation, not sensitive content or credentials in logs. Retention limits and restart behavior must be specified before release; completed mappings remain in ILIAS tutor notes.

## 11. Interface, localisation and mobile requirements

- On desktop, keep roster/order controls compact and preview lists scrollable. On phones, use a single-column dialog with a visible close action, clear current assignment, adequate name fields and a reachable primary action.
- Avoid the recently removed oversized sort dropdown pattern. Use compact method/direction controls, with labelled selectors where choosing a TA is genuinely a multi-option selection.
- Reordering must work with buttons and keyboard, not just drag-and-drop. Show why a TA receives an extra unit.
- Keep unsaved roster/import mappings mounted across resizing, background refresh and rotation. Opening another assignment must not reuse the wrong draft.
- Support loading, empty, stale snapshot, existing allocation, partial publication, authentication loss, invalid files and retry states in both languages/themes.
- Localise labels, tooltips, accessible names and generated errors with the existing shared catalogues; preserve TA labels and lecturer/student content.
- Test 320/390/430/768/1280 px and short landscape, including long German labels, long TA names, keyboard focus restoration and real selection/reorder/save interactions. Distinguish emulation from physical iOS/Android and live ILIAS acceptance.

## 12. Phased delivery and release gates

### Phase 0 — capability/identity probes, before implementation assumptions are frozen

In an authorized disposable exercise, capture current individual/team forms, all pagination states, multi-feedback availability, native ZIP structure, selected-download initiation/completion, feedback confirmation, and per-member/team notes/status behavior. Use harmless named fixtures and compare before/after state for any later write probe. Do not run those writes as part of this planning task.

Deliver saved regression fixtures and a deployment capability matrix. Resolve these gates:

- **G1:** Can every relevant unit be enumerated and identified, including duplicate member rows and changing representatives?
- **G2:** Can batch tutor-note writes preserve all existing grades/notes, including underlying team-member state? What are the actual note and POST limits?
- **G3:** Does a native selected download produce an immediate archive or a trackable job? How is its result retrieved securely?
- **G4:** Is individual native multi-feedback exposed? What upload/confirmation values and nested-folder rules does this installation use?
- **G5:** Does the existing team feedback-file path publish once to the shared collection, with what replacement/notification behavior?

### Phase 1 — shared allocations

Implement complete snapshots, strict identities, marker/capacity/conflict handling, deterministic allocation and the dialog. Add the genuine multi-row notes adapter and read-back verification. Release only when G1/G2 and grade-preservation tests pass. Another fresh BetterIlias client must reconstruct the same assignments from ILIAS notes alone.

### Phase 2 — TA downloads and feedback templates

Add All/TA selection, native bulk adapter/background tracking if verified, bounded fallback, complete/partial results, and canonical IDs/manifest/template output. Never claim native efficiency if the fallback actually performs separate downloads.

### Phase 3 — reviewed feedback return

Add folder/ZIP preflight, explicit mapping/conflict handling, per-collection fallback and progress/reconciliation. Add native individual multi-feedback once G4 is proven; it is an optimization, not a prerequisite for team support. Validate G5 before team publication.

### Phase 4 — hardening and optional convenience

Exercise simultaneous tutors, permission/session changes, timeout/restart recovery, large archives, zero-work TA slots, late submissions/team changes, and optional filename/CSV adapters. Complete bilingual/theme/mobile screenshots, physical-device checks where folder workflows matter, and authenticated deployment acceptance.

## 13. Acceptance and regression checklist

- Allocation: zero work, one TA, more TAs than units, exact division and remainders; priority reorder changes quotas predictably; stable sorted ties/missing times; random preview is not reshuffled on save.
- Identity/enumeration: multi-page assignments, repeated pages, hidden native filters, duplicate team rows, actual team IDs versus display numbers, synthesized participant IDs, changed representatives and mixed assignment types.
- Notes: preserve human text and unrelated markers; Unicode/escaping and the captured 200-character boundary; malformed markers, deleted markers, multiple plans, incomplete batches and zero-work custom-name limitations.
- Write safety: repeated POST fields survive encoding; only changed participants are listed; required current status is echoed; existing marks/statuses/student-visible comments remain unchanged; conflicting team-member state blocks the write; HTTP success without read-back does not count as success.
- Collaboration: two tutors preview the same assignment, one commits first; changes before the second commit are detected; native edits between reads are documented/reconciled; no automatic stale rollback or redistribution.
- Downloads: selected TA contains each unique unit once; all pages are included; empty/partial/error states are honest; immediate ZIP and native background-job responses differ; authenticated proxy reuse and session isolation remain intact.
- Imports: all three primary input families; wrapper/nested directory rules, individual ID suffixes, ambiguous names, incorrect course/assignment, changed teams, missing units, duplicate filenames, malicious ZIP paths/expansion, ignored metadata, and accidental inclusion of student submissions.
- Publication: native confirmation matches approved recipients/files; team collection receives each file once; unrelated students receive nothing; grade/status/notice values remain untouched; notification behavior is disclosed; unknown-result retries do not duplicate publications.
- UI: user can name/reorder assistants, reverse a sort, inspect quotas, save a plan, choose a TA download, preview a folder/ZIP mapping and recover a partial operation at the required viewport widths with touch and keyboard.
- Future implementation checks: full backend suite, frontend build, locale validation and launcher syntax; add focused browser regressions and sanitized real-dump fixtures for every native adapter. Mocked tests alone do not establish live ILIAS compatibility.

## 14. Decisions to confirm before coding

| Question | Recommended starting decision |
| --- | --- |
| What does lecture-scoped caching mean? | Per account/session and enclosing course; exercise-only fallback if no course context exists. |
| Which work enters the initial distribution? | Submitted and ungraded; “all submitted” is an explicit option. |
| How should sorted work be assigned? | Contiguous blocks, with the priority list controlling both remainder and block order. |
| Must TA labels be linked to real accounts? | No; use logical named/numbered slots and an optional local “this is my slot” choice, never name-based authentication. |
| Must custom names of zero-work TAs be shared? | Not in the notes-only MVP. If this is required, agree a separate shared metadata location before implementation. |
| What happens to late work? | Remains unassigned until an explicit “allocate new work” preview; never reshuffle completed work automatically. |
| Is returning feedback immediately student-visible? | Follow native publication semantics after explicit confirmation; a separate scheduled release is out of scope unless native support is verified. |
| What if notes cannot fit or team fields cannot be preserved? | Block affected publication and resolve it; no silent text loss or unsafe grade-reset workaround. |
| Are filename-only matching and arbitrary archive formats required initially? | No; start with manifest, explicit-ID folders and native individual ZIPs, then add reviewed convenience adapters. |

These are plan assumptions and research gates, not claims that the feature has been implemented.
