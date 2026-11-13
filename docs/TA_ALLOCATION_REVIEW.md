# TA allocation defaults and note safety — review branch

> [!NOTE]
> The primary, production documentation for TA allocation, downloads, and mass feedback return is maintained in **[`TA_WORK_DISTRIBUTION.md`](TA_WORK_DISTRIBUTION.md)**. This document records the historical review, branch acceptance, and test criteria from 5 November 2026.

Assistant names, count, remainder priority and the next stable slot ID persist
in localStorage per BetterIlias session/course on this device. Without a course,
the key is scoped to the exercise; without a session, nothing is saved globally.
Changing account/course does not reuse another scope's roster. Removing the last
slot and adding another does not recycle its ID. Corrupted or unavailable storage
cannot crash the editor; a failed write shows a translated hint.

Only defaults persist automatically. Opening, editing or reordering assistants
does not call the allocation API. Actual assignments still require the explicit
save action. Defaults initialize when the editor opens; refreshes and viewport
changes do not overwrite an open draft. A new assignment/context opens its own
editor using the relevant saved defaults.

The preview blocks saving if an assistant name is empty/ambiguous, the current
snapshot fingerprint is unavailable, or any participant's resulting tutor note
exceeds 200 Unicode code points. It identifies affected participants and the
resulting character count. No human note is shortened, including its whitespace.
Marker-looking text inside a human note is preserved; only a valid terminal
BetterIlias marker is interpreted/replaced. Names cannot contain marker delimiters.

The server independently verifies note preservation, limits, participant identity,
duplicates, route/body context and the required snapshot fingerprint. It rereads
the native form immediately before a batch write and aborts if its notes changed.
Status and marks come from that fresh form, so an intervening grade is preserved.
This is not an atomic compare-and-swap against tutors editing directly in ILIAS;
shared BetterIlias locks and existing read-back verification still apply.

The dialog uses native focus containment/Escape dismissal and restores focus to
the opener. It uses the shared visible-viewport bounds, touch-sized controls,
phone roster rows and a reachable footer. Closing and editor controls are disabled
while a native save is pending. Storage and note errors are translated.

## Review locally

From this worktree, use the normal development launcher (`python start.py`) and
connect the companion to that local instance. Worktrees do not copy saved user
sessions or credentials. Avoid running two development launchers on the same
ports. The original workspace and its pending tab-label edits remain separate.

In a tutor exercise, open **Distribute work**, name/reorder/add/remove assistants,
close/reopen and refresh. Another exercise in the same course shares these
defaults; another course/account does not. No allocation should change until
**Save distribution to ILIAS** is pressed. For a long tutor note, the preview
must disable saving and explain the overflow. Native live writes were not
performed during automated verification.

## Verification

```powershell
python -m pytest tests/ --basetemp=.pytest-tmp-allocation
npm.cmd --prefix frontend run build
npm.cmd --prefix frontend run check:locales
node --test tests/ta_allocation_defaults.test.mjs
$env:BETTERILIAS_BROWSER_TESTS='1'
$env:BETTERILIAS_BROWSER_CHANNEL='chrome'
python -m pytest tests/test_allocation_browser.py --basetemp=.pytest-tmp-allocation-browser
```

Browser regressions use the production build and mocked native/API responses at
320, 390, 430, 768 and 1280 px and short landscape dimensions in German/dark and
English/light. They exercise naming, priority, stable IDs, resizing, reopening,
reload, explicit saving, note refusal and account/course isolation. Screenshots
are under `scratch/allocation-review/`. This is Chrome viewport emulation, not
physical iOS Safari/Android Chrome or live authenticated ILIAS acceptance.
