# Shared frontend UI

The presentation primitives live in `frontend/src/components/ui/`. Reuse them
when changing related workflows, keeping network requests, credentials, drafts
and domain-specific state in the caller. All labels supplied by application code
must use the existing localisation helpers.

| Primitive | Responsibility | Current consumers |
| --- | --- | --- |
| `FeedbackBanner` | Success/info/warning/error surface, announcement semantics, optional actions and dismissal | `ErrorNotice`, requests, forum notices, course management, grading feedback, TA editor/management, diagnostic saved notice and administrator alerts |
| `Badge` | Static translated label, optional decorative icon and shared light/dark tones | Request statuses, grading feedback, submission-detail statuses |
| `Button` / `IconButton` | Native button semantics, default `type="button"`, 44 px targets, focus styles, variants and optional loading state | Feedback/recovery actions, request controls, discussion composer, course authoring, membership and diagnostics |
| `DialogShell` | Controlled native modal lifecycle, labelled header/close control, scrolling body and footer | Object creation/uploads, course membership and diagnostic consent |

## Feedback and status ownership

`FeedbackBanner` is presentation only. It does not classify connection failures,
sign users in, retry operations or dismiss itself on a timer. `ErrorNotice`
continues to own ILIAS connection-recovery classification and its existing
dismissal/reset behaviour. Administrator and public-community callers use the
banner directly, with their own credential and retry paths.

The banner defaults to `role="alert"` for errors and `role="status"` for other
tones. Retain explicit announcement labels/live-region attributes required by a
workflow. Preserve the caller's distinction between a successful native write,
an unconfirmed result and a subsequent refresh failure. Never infer a successful
write from a refresh or replay a mutation through a generic Retry action.

`Badge` is static metadata without a live-region role. Callers retain the mapping
from request/grade/submission states to translated labels, icons and tones. A
declined request and a failed grade share presentation without sharing meaning.

## Buttons and dialogs

`Button` forwards native button props and refs; use `type="submit"` explicitly
for form submissions. `loading` disables activation and exposes `aria-busy`, with
a decorative spinner that respects reduced-motion preferences. `IconButton`
requires a localised `label`; supply decorative icons with `aria-hidden`.

`DialogShell` calls `showModal()` and closes during layout cleanup before its DOM
node is removed, allowing the browser to restore focus. Native dialogs provide
focus containment and background inertness; callers do not add a manual focus
trap. `open={false}` keeps children mounted so callers can preserve drafts.
Changing width, theme, language or parent data does not remount the editor.

The shell's close control and native cancel event call `onRequestClose`.
`closeDisabled` blocks the close
button and native cancel while work is pending; the cancel guard also works
where `closedby` is unsupported. Callers remain responsible for confirmation of
unsaved changes, pending-write protection and deciding when to close. Existing
queued confirmations continue through `confirmDialog`/`ConfirmModal`.

The shell uses shared visible-viewport CSS variables, bounded width/height and an
independently scrolling body. Its header and supplied footer remain reachable
on short screens. Shell styles are scoped to `.ui-dialog` and do not change
unmigrated overlays, player controls or settings dialogs.

## Validation and next steps

`tests/test_shared_ui_browser.py` exercises real DOM interactions in React Strict
Mode: native focus containment/restoration, pending-close guards with/without
`closedby`, button loading/contrast, feedback dismissal, controlled close and
unmount, and draft preservation through resizing and parent refreshes. Screenshots
cover 320/390/430/768/1280 px and short landscape, German/English and light/dark.
Existing request, forum, management, membership, diagnostics, grading, connection
and administrator browser regressions exercise the migrated callers.

These are Chromium emulation/mocked-API checks, including a simulated missing
`closedby` attribute; they do not establish physical iOS/Android, native Safari
or live ILIAS validation.

Form fields, disclosures, attachment rows, filter layouts and empty states remain
follow-ups in `TODO.md`. Share these incrementally with the same ownership and
accessibility boundaries; do not move workflow-specific logic into UI primitives.
