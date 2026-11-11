# State-machine integrity fixes

The fourteen findings from the source audit are addressed as local lifecycle
changes rather than a single global state machine.

| Finding | Resulting behavior | Regression coverage |
|---|---|---|
| F01: cross-credential management flights | Read coalescing includes credential generation and resource ID. Old responses and body readers reject after a credential change. | `test_management_flights_and_auth_events_are_credential_scoped`, body-generation check |
| F02: calendar overwrites concurrent rules | Every progress/import update patches freshly loaded tenant state under the rule/preferences state lock, including failure/cancellation. | Calendar interleaving tests with successful, failed and cancelled jobs |
| F03: grade save acknowledges later edits | Dirty state compares the live editor with the submitted, confirmed snapshot. Newer input stays dirty. | Deferred grade saves across phone/tablet/desktop, languages and themes |
| F04: assignment revalidation overwrites drafts | Fresh details initialize only a pristine draft; file edits and pending attachments also prevent replacement. Scope generations reject late results. | Cached editor/deferred-response checks |
| F05: replacement loses original feedback | Upload and verify a new file ID before removing the old file. Partial imports retain staging and receipts. | Failed upload, lost upload response and retry tests for automatic/manual mappings |
| F06: uncertain assignment creation duplicates | Creation carries a stable operation ID. Persisted native-write receipts make retries reconcile a read instead of repeating the create POST. | Lost-response native markup test; frontend check/edit/update flow |
| F07: failed deletion counted as overwrite success | Removal must be confirmed with the new file still present. Failure is reported and its retry reuses the confirmed upload. | Rejected and ineffective deletion tests |
| F08: stale auth signals | Transport events require the current credential/logout generation; older-started evidence cannot replace a newer auth result. | Cross-account, logout/body and same-credential response ordering tests |
| F09: ILIAS server error appears expired | Verification propagates upstream server failure as service unavailability, preserving credential validity as unknown. | HTTP 500/502/504 verification tests |
| F10: joined calendar job stops polling | An active-job response continues polling until terminal progress. Superseded polling responses are ignored. | Joined-job observation test |
| F11: companion loses cookie-change retry | Both companions invalidate older verification generations and drain pending cookie/forced changes after an attempt settles. | Chrome/Firefox deferred verification and disabled-auto-sync harnesses |
| F12: dialogs strand earlier promises | FIFO confirmations settle each promise; unmount settles abandoned requests as cancelled. Parent Escape handlers defer to native dialogs. | Queue/unmount and dirty-modal Escape tests |
| F13: completed download masks active flight | URL lookup prioritizes preparing/downloading/saving items over historical entries. | Repeated download regression |
| F14: new notice inherits old countdown | Newly added IDs reset the remaining lifetime; parent renders do not. Hover pauses preserve remaining time. | Appended-notification lifetime regression |

## Creation receipts

HTTP assignment creation now requires `operation_id` (16-128 URL-safe characters).
The frontend generates and retains it for the editing instance, including lost
responses. An uncertain check uses the original submitted payload; newer edits
remain dirty and can be saved as an update once the created ID is confirmed.
Ordinary updates continue to use `ass_id`.

Receipts are private atomic JSON files under
`COORDINATION_DIR/assignment-creations`, keyed by a digest of session, exercise
and operation. They hold the request fingerprint, pre-create IDs, dispatch state
and confirmed ID, without storing the submitted instructions or session cookie.
All workers must share the existing local coordination volume. Dispatched
receipts must not be deleted merely because a request timed out: absence of a
confirmation is not permission to create again. Ambiguous matches or a changed
payload require inspection instead of another POST.

## Feedback receipts

Each staged file records dispatch, pre-upload IDs, a confirmed replacement ID
and completion. Rechecking a partial import verifies/reuses those results and
does not repeat completed uploads. An ambiguous upload is inspected before any
retry; its original file remains intact. Completed staging is removed only when
all items are successful or deliberately skipped. Existing staging-expiry
cleanup still applies to abandoned imports.

## Validation

`tests/test_state_machine_integrity.py` injects native transport failures and
interleaves calendar edits in isolated temporary storage. Existing feedback
tests now return real file-list DTOs from their fake native store, including
verified upload/delete results.

`tests/test_state_machine_browser.py` runs actual components and transport
modules through a test-owned Vite server and installed headless Chrome. It
captures German/English and light/dark screenshots at 320/390/430/768/1280 px
and short landscape, and exercises edits, saves, retry checks, dismissal and
focus. Existing production-build browser suites cover the surrounding app.
These are mocked/emulated checks, not live ILIAS or physical-device acceptance.

Verification on the combined upstream changes:

- Full Python suite: 660 passed, 555 skipped (optional fixture/browser checks).
- Broader opt-in Chrome app/extension run: 180 passed; four native Firefox tests
  skipped because `marionette_driver` is unavailable. Both companion background
  scripts pass the deferred cookie-change/disabled-sync JavaScript regressions.
- Final recovery/sidebar run after the latest upstream notice changes: 93 passed,
  including all 56 new component/transport regressions.
- Frontend production build, 2,126-key bilingual locale validation, six
  localization runtime tests and launcher syntax check passed.
- Reviewed narrow German dark-mode grade and feedback-retry screenshots;
  responsive checks cover the editing and retry interactions described above.
