# Reviewed audit backlog

**Reviewed on 2026-11-24. 16 actionable items remain: 10 backend and 6 frontend.**

Review reference: `4c0929ae4b483aa58c52cdddea405f4266c67d87` and the current
working tree. Review began at `66c12b0`; the intervening UniSport/CI changes did
not alter the audited ILIAS authentication, grading, calendar or legacy modal
implementations. Original source reports were `CODEX_BACKEND_AUDIT.md`,
`AGY_FRONTEND_AUDIT.md` and `COMPILED_TOP_10_IMPROVEMENTS.md` from
`C:/Users/manue/.superagent/reports/`.

The entries below survived current-code review. **Unchecked means unresolved,
not unreviewed.** A code-supported risk is distinguished from a behavior actually
reproduced. This review did not implement fixes, run the full application test
suite, contact live ILIAS or use real accounts. Four backend behaviors were
reproduced through isolated in-memory probes of extracted production functions
or HTTPX behavior. One Chromium CSS probe measured a representative compact
control using the compiled stylesheet. No production stores or credentials were
used by those probes.

Record a fix/test/deferral link and checked revision when closing an item. Keep
account isolation and uncertain writes ahead of optional architectural cleanup.

## Backend: still relevant

- [ ] **B01 | P1 | Prevent calendar migration between different accounts**
  - **Evidence:** `backend/api/routes/auth.py:105-112` rotates the capability when
    `previous_user != user_or_msg`, then still calls `migrate_tenant_state` from
    the submitted old capability. `backend/services/calendar_service.py:177`
    copies the entire old JSON file, including subscription metadata, without
    verifying identity continuity.
  - **Assessment:** current code supports the cross-account data-transfer risk;
    a full authenticated account-switch reproduction was not run.
  - **Next:** require verified identity continuity and test different-account
    switches with existing rules/subscriptions. Locks alone do not fix identity.

- [ ] **B02 | P1 | Scope ILIAS participant caches to tenant and credential generation**
  - **Evidence:** `backend/services/ilias_client.py:120` still defines the
    class-level `_course_user_cache`, keyed only by exercise ID. Reads around
    lines 759 and 1319 reuse cached `is_self` flags, including in team deletion.
    `__init__` does not replace this dictionary with an account-scoped instance.
  - **Assessment:** shared tenant-sensitive state is present in current code;
    destructive actions were not exercised. This is the ILIAS exercise cache,
    not an allegation about the newer UniSport participant-list cache.
  - **Next:** isolate tenant/generation keys and interleave synthetic accounts
    through display, credential rotation and team-deletion ownership checks.

- [ ] **B03 | P1 | Stop in-flight sync from reviving logged-out capabilities**
  - **Evidence:** sync validates an existing capability before awaiting cookie
    verification, then saves afterwards without a generation/revocation check.
    `backend/auth/session.py:118` deletes the file on logout; `save_cookies`
    can recreate it. Separate save/delete locks do not protect the whole async flow.
  - **Reproduced:** an isolated execution of the actual sync function, with an
    in-memory session manager, recreated the same capability after logout was
    simulated during verification. No session files or network were used.
  - **Next:** check terminal revocation/generation under the persistence lock
    immediately before save; add a deterministic verification/logout race test.

- [ ] **B04 | P1 | Validate session-material IDs and encode native query parameters**
  - **Evidence:** the route in `backend/api/routes/materials.py:159` names its
    path argument `session_id`; `backend/api/deps.py:61` validates
    `session_ref_id`, not that actual name. `expand_id` also has no numeric query
    validation. `IliasClient.get_session_materials` interpolates both into URLs.
  - **Reproduced:** executing that method with a fake HTTP client and
    `expand_id='70&cmd=delete'` constructed a native request with `cmd=delete`
    as an independent query parameter. No request was sent. Native-origin
    pinning does not itself validate these unflagged native command parameters.
  - **Next:** validate actual route/query arguments and build encoded query
    parameters; add endpoint-level encoded-delimiter regressions.

- [ ] **B05 | P1 | Verify grades and feedback before reporting success**
  - **Evidence:** `grade_student_submission` ignores the fallback feedback POST
    response and bases the aggregate result on the table response. It passes
    `allow_unconfirmed=True` for HTTP 200/302 into `verify_grading_success`.
  - **Reproduced:** the actual parser function returned success for an empty
    HTML response with `allow_unconfirmed=True`. Code inspection also confirms
    that a failed feedback response need not make the aggregate result fail;
    that full network sequence was not independently replayed in this review.
  - **Next:** verify both persisted results and preserve partial/uncertain
    outcomes. Test empty responses, failed feedback saves and lost responses
    without automatically replaying mutations.

- [ ] **B06 | P1 | Bound file intake and aggregate export memory**
  - **Evidence:** feedback preview calls `await file.read()` before archive
    validation in `backend/api/routes/exercises.py:590`. Bulk export retains
    every downloaded `resp.content` in an `asyncio.gather` result and builds an
    in-memory ZIP in `backend/services/exercise_bulk.py`.
  - **Existing protection:** archive inspection limits uncompressed content to
    500 MB / 1,000 entries, and export downloads use a semaphore of five. Those
    limits do not bound initial file-read memory or aggregate/concurrent-job memory.
    The community body-limit middleware does not cover this upload route.
  - **Next:** stream/spool intake and ZIP output, enforce intake limits before
    loading the file, and bound concurrent jobs. Resource exhaustion was not run.

- [ ] **B07 | P2 | Prevent unlocked calendar reads from rewriting stale state**
  - **Evidence:** `_load_tenant_state` calls `atomic_json` after normalising
    colours, without acquiring the calendar-state lock. Public service reads
    such as `build_semester_response` call it without that lock, while mutations
    use separate coordinated methods.
  - **Assessment:** the read/write race remains code-supported. Atomic file
    replacement prevents partial files, not stale snapshots overwriting updates.
  - **Next:** make reads pure or reread/normalise under the same tenant lock;
    reproduce normalisation racing a rule/subscription update.

- [ ] **B08 | P2 | Reject colliding feedback destination filenames**
  - **Evidence:** `backend/services/feedback_import.py:400-411` writes each
    mapped item to `unit_folder / filename`. Multiple source paths with the same
    basename for one recipient overwrite the same file while creating separate
    preview items. The staging loop has no duplicate-destination rejection.
  - **Existing protection:** previews have unique staging directories and compute
    hashes/snapshot tokens. Those protections do not prevent collisions inside
    one recipient's directory.
  - **Next:** reject duplicate destinations or use unique staging names and
    verify preview-to-commit file identity; cover nested paths/duplicate entries.

- [ ] **B09 | P2 | Keep download framing consistent with decompressed bytes**
  - **Evidence:** `stream_download` copies upstream `Content-Length`, omits
    upstream content encoding, then yields decoded `resp.aiter_bytes()` output.
    The transport preserves raw compressed bytes/headers for HTTPX to decode.
  - **Reproduced:** a synthetic gzip response advertised 38 bytes while HTTPX
    decoded it to 4,096 bytes. Together with the current forwarding code this
    confirms the header/body mismatch mechanism, without a live download.
  - **Next:** preserve matching raw bytes/encoding or drop the upstream length
    for decoded output; add compressed-download and relevant range regressions.

- [ ] **B10 | P2 | Isolate all backend test stores before application import**
  - **Evidence:** `tests/test_session_isolation.py` imports the application before
    its fixture redirects only session/coordination settings. `tests/conftest.py`
    has no global persistence/network isolation. Calendar creates a default-path
    singleton at import; authenticated dependencies call activity recording using
    `settings.observability_path`.
  - **Assessment:** local default paths remain reachable by tests. Runner-specific
    temporary environment variables help CI but do not isolate all local tests.
    This review did not run tests against developer stores.
  - **Next:** configure temporary stores before imports, reset singletons and
    prohibit unintended network access centrally; verify with sentinel paths.

## Frontend: still relevant, corrected in scope

- [ ] **F01 (includes F06) | P1 | Finish shared modal lifecycle adoption**
  - **Evidence:** StudentAssignmentModal, ContentOrderModal, NicknameModal and
    the TAExerciseManagementView deletion overlay still render custom div
    overlays rather than `ui/DialogShell.tsx`; several lack modal semantics and
    focus containment. Student/content-order/nickname overlays already have
    Escape listeners, so that behavior must not be described as universally absent.
  - **Merged F06 evidence:** ReturnFeedbackModal and SemesterRangeModal have
    `role='dialog'` / `aria-modal`, but no local Escape/focus-return lifecycle;
    the TA deletion overlay also lacks that handling. The global Escape hook
    deliberately leaves visible overlays alone rather than closing them.
  - **Next:** verify actual keyboard interactions and migrate remaining overlays
    to the shared native shell, preserving pending/dirty guards. Do not add
    redundant ARIA, competing Escape handlers or a manual focus trap to native
    `showModal()` dialogs. The audit's 'only three users of DialogShell' is stale.

- [ ] **F02 | P2 | Expand compact hit areas on touch tablets, not already-covered phones**
  - **Correction:** `frontend/src/index.css:861-867` enforces 44px minimum button
    width/height below 768 CSS px. The original claim of 24px phone buttons
    overlooked this rule.
  - **Reproduced CSS geometry:** a representative `h-6 w-6` compact button using
    the compiled stylesheet measured 44x44 at widths 320/390, but 24x24 at
    768/1280. DownloadButtons still uses those compact classes; calendar controls
    also retain smaller dimensions outside the phone media query.
  - **Next:** check actual touch-tablet workflows at/above 768px and provide
    suitable hit areas without distorting switches or unnecessarily expanding
    compact desktop controls. This was CSS emulation, not a physical-device test.

- [ ] **F03 | P1 | Scope persistent TA filters to the editing context**
  - **Evidence:** `ExerciseView.tsx:231-323` still reads/writes global
    `ilias_ta_filter_submission`, `ilias_ta_filter_grade` and
    `ilias_ta_quick_filters` keys. Other preferences and save ownership already
    use course/account/exercise context, but those filter keys do not.
  - **Next:** reproduce navigation across unrelated contexts, define intended
    scoping and migrate old preferences deliberately. Preserve drafts and avoid
    confusing empty lists caused by another context's filters.

- [ ] **F04 | P2 | Remove genuinely unreferenced legacy components**
  - **Evidence:** repository source/test/script searches find ExerciseModal and
    CourseLogsPanel only in their own definitions, with no component glob-loader
    referencing them. Current file sizes are 991 and 158 lines, not the older
    audit's 611/172 counts.
  - **Assessment:** still a cleanup candidate, not proof of shipped bundle bloat.
  - **Next:** reconfirm references at deletion time, remove unused files if still
    orphaned and verify type-check/build behavior. No files were deleted here.

- [ ] **F05 | P2 | Test real React state logic in a fast harness**
  - **Evidence:** no Vitest/React Testing Library or equivalent React component
    test runner is declared. Existing Node tests do exist, so 'frontend has only
    Playwright tests' is inaccurate. In particular, `test_dialog_and_guard.test.mjs`
    exercises a copied simulation rather than importing the production guard.
  - **Assessment:** a relevant testing improvement, not a demonstrated production
    bug or a requirement to adopt a particular library.
  - **Next:** identify uncovered production hooks/components and test the real
    implementations using the smallest suitable harness. Keep browser tests for
    layout, focus and native interaction; avoid tests of copied implementations.

- [ ] **F07 | P2 | Reduce CalendarView responsibility coupling**
  - **Evidence:** CalendarView remains 3,482 lines with timetable/date helpers,
    schedule state, multiple render modes, rule editing and subscription/export UI.
  - **Assessment:** maintainability work remains relevant, but the original
    rerender/performance claims were not demonstrated by profiling.
  - **Next:** extract cohesive hooks/components only with behavior-preserving
    coverage and draft ownership. Do not treat file length alone as a runtime bug.

## Removed or consolidated after review

These are not active backlog items. Their original detailed claims were removed.

| Original item | Disposition | Current evidence |
| --- | --- | --- |
| F06: separate modal Escape/focus task | Merged into F01 | Same modal lifecycle work; missing behavior is retained there rather than duplicated. |
| F08: narrow-toolbar/rename overlap | Removed as unsubstantiated in current code | ContentOrderModal has no rename input and already stacks rows on phones. Current responsive CSS and `test_mobile_refinement_browser.py` address grading toolbar layout; a specific current clipping reproduction was not established. This is not a guarantee that every layout is perfect. |
| F09: outdated branch/UniSport sidebar reconciliation | Removed as historical/satisfied for current code | Sidebar, NicknameModal and cache helpers already include UniSport, its icon and navigation IDs, including appending missing default nav items to custom orders. Old Google-branch lag is not a current product defect. |
| F10: blanket absence of async announcements | Removed as contradicted by current code | NotificationToast has `role='alert'`; GradingFeedbackBar has `aria-live='polite'` and uses FeedbackBanner's status role. The grading save handler publishes to that bar. Adding redundant announcements everywhere could make feedback noisier. |

## Compiled-summary coverage

The surviving compiled recommendations map to B06 (intake), F01 (modals),
B01/B02 (tenant isolation), F03 (filters), B03/B07 (races), the narrowed F02
(tablet controls), B08/B09 (file integrity/framing), F07 (calendar structure),
F05 (test coverage) and F04/B10 (cleanup/test isolation). B04 and B05 remain
explicit high-priority items even though the compiled top ten omitted them.
