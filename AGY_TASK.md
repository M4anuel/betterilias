# AGY handoff: fix shared UniBE login in Chrome and affiliation transitions

Requested by the user on 2026-11-27. This is a handoff for implementation by AGY;
Codex has investigated the paths below but has **not implemented these fixes**.

## Baseline and scope

- Published baseline: BetterIlias **1.11.0**, Chrome/Firefox Companion **1.6.0**.
- Release commit: `7cbbcace6be62ed546963ee99e36bb0a4b1137a2` (`v1.11.0`).
- Fix both browser extensions. Preserve the legacy cookie-login mode, paired
  logout, language sync, bounded popup sizing and stable backend retry warning.
- Read the current `AGENTS.md` before work. Local workflow instructions now use
  `develop` for integration; release to `main` only when the user requests it.
- Existing unrelated edits in this workspace: `AGENTS.md`,
  `.github/workflows/containers.yml`, the audit follow-up block in `TODO.md`, and
  `docs/AUDIT_FINDINGS_TO_VERIFY.md`. Preserve them and do not accidentally include
  them in the fix. Check git status again because other work may have advanced.

## 1. Blocking: Chrome native callback login fails

User reproduction:

1. Start SWITCH edu-ID login through the Companion in Chrome.
2. After authentication, the browser displays:
   "Die Angaben, die du senden möchtest, sind nicht sicher. Dieses Formular wird
   über eine Verbindung gesendet, die nicht vollständig sicher ist ..."
3. The destination shown is `ch.unibe.campusapp://campusapp.unibe.ch`.
4. Clicking **Trotzdem senden** does not complete login. The user reports login
   always fails in Chrome. The equivalent flow works in Firefox.

Known implementation facts:

- Native client: `unibe-campusapp`, issuer `https://login.eduid.ch`, callback
  `ch.unibe.campusapp://campusapp.unibe.ch`, authorization-code flow with PKCE
  S256 and explicit `response_mode=form_post`.
- `extensions/chrome/unisport-callback.js` is an isolated-world content script
  injected at `document_start` on the provider origin. Its MutationObserver asks
  the background for the pending state, finds a POST form with the exact native
  callback action and hidden fields only, validates the state, then sends
  `UNISPORT_CALLBACK`. It **does not prevent the provider's form submission**.
- `extensions/chrome/unisport.js`: `startBridge`, `parameters`, `pendingFor`,
  `finish`, and the `webRequest.onBeforeRedirect` listener. `finish` atomically
  removes the pending extension record, POSTs the callback to the selected backend,
  and closes the provider tab only on success. The listener observes redirects;
  it does not block submissions and cannot itself capture a POST body.
- Shared login uses `/api/auth/unibe/start` and `/complete`; older UniSport flow
  uses `/api/unisport/auth/*`. `backend/services/unisport_auth.py` owns provider
  transaction/state/PKCE validation. Inspect it before changing the response mode.
- The callback is a native URI, independently of whether BetterIlias is hosted
  locally over HTTP or remotely over HTTPS. Making the backend HTTPS does not
  change this form action. This warning was documented, not fixed, in 1.6.0.

Investigate and implement a reliable callback capture before native form
navigation. A race between provider autosubmit and the asynchronous content-script
state lookup is a plausible cause, **not yet a confirmed live-browser diagnosis**.
Inspect actual Chrome behaviour, including synchronous `form.submit()` (which
bypasses the ordinary submit event), requestSubmit, parser/onload autosubmit,
isolated-world versus page-world execution and extension worker wake-up.
Do not assume a submit event listener alone covers all provider paths. Do not
disable browser security warnings or broadly intercept unrelated provider forms.
Do not claim a fix just because clicking the interstitial works in a mock.

If using a page-world bridge, keep it minimal and exact-callback-only; do not
expose extension APIs, credentials or backend configuration to the page. Validate
sender origin/tab, callback fields, state, current pending transaction and expiry
again in the privileged background/backend. Preserve single consumption, no
uncertain exchange retries, no provider passwords/cookies or token logging, and
no callback secrets in BetterIlias navigation URLs. A registered HTTPS callback is
the future production migration, but this task is to fix the existing prototype.
Do not assume a different response mode/redirect URI is registered or supported.

## 2. Automatically select AND connect the UniBE affiliation

User report: Firefox login succeeds, but still requires clicking the organisation
confirmation. If a UniBE affiliation exists, automatically use and confirm it so
the user finishes login without that extra click.

Current implementation only **preselects the dropdown draft**:

- `extensions/chrome/unibe-popup.js`, `apply(next)`, prefers a provider-supplied
  affiliation whose substring after the final `@`, lowercased, is `unibe.ch`.
- Actual persistence and connection occur only in the `affiliation-form` submit
  handler: `UNIBE_AFFILIATION` -> `UNIBE_CONNECT` -> `UNIBE_ACTIVATE`.
- `extensions/chrome/unibe.js`, `BetterIliasUnibe.completed`, currently only sends
  `UNIBE_UPDATED`. Authentication opens a tab and the popup may be closed. Put
  reliable completion orchestration in the background rather than depending on
  an open popup or repeated renders/focus/poll events.
- Backend: `backend/api/routes/unibe.py` (`connection`, `affiliation`,
  `connect_ilias`) delegates to `backend/api/routes/unisport.py` and the auth service.
- Use the full exact affiliation supplied by the verified provider, never invent
  an affiliation from a display domain. Display only the domain as before.
- Auto-use UniBE on a new successful login when available. Preserve an explicit
  organisation selection during the current connected session; do not auto-switch
  back after the user manually chooses another organisation. Retain the manual
  selector when UniBE is absent, and report rejected affiliation/exchange errors.
- Guard against duplicate connect/exchange attempts, stale login generations,
  logout during completion, popup closure and extension worker restarts.

## 3. Remove the false ILIAS account-switch warning on organisation changes

User report: switching organisation displays this warning, which should disappear
for an organisation change within the same account:

> ILIAS-Konto wechseln
>
> ILIAS wurde als Manuel Flückiger bestätigt, konnte aber deinem aktuellen Konto
> nicht sicher zugeordnet werden. Beim Wechsel werden die zwischengespeicherten
> Inhalte des bisherigen Kontos geleert. Fortfahren?

The name above is the user's reported example; use synthetic names in tests.

Relevant paths and identity contract:

- Popup `confirmation`, `confirm-switch`, `confirm-message`, `confirm-btn`, and
  `cancel-switch-btn` in `unibe-popup.js` / `popup.html`.
- Locale keys: `unisport.ilias_replace_confirm`, `unibe.switch_title`,
  `unibe.switch_confirm` in `locales/de.json` and `locales/en.json`.
- `UNIBE_AFFILIATION` persists the affiliation and clears the pending candidate.
- `UNIBE_CONNECT` passes the nominated previous session via `X-Session-Id`, stores
  a candidate, and currently sets confirmation solely when `previousSession`
  exists and differs from returned `session_id`.
- Backend `backend/api/routes/unisport.py::connect_ilias` returns
  `{authenticated, session_id, user_name, renewed}`. It verifies the new account's
  unique ILIAS identity and reuses the old capability/cache only on a proven match.
- Identity proof: `backend/services/unisport_ilias.py::profile_identity`,
  `existing_identity`, `exchange`. The unique login is read from the verified
  cookie-authenticated **own-profile editor**, hashed as `ilias_account_key`.
  A display name, avatar, email domain, affiliation or mere SWITCH login success
  is insufficient to prove the same ILIAS account.
- Same-account renewal calls `previous.replace_unchanged(snapshot, cookies,
  metadata)` and retains the session ID/caches. If the prior identity cannot be
  verified or differs, the backend creates a fresh isolated capability.

Trace why this user reaches replacement on an organisation change: stale/missing
previousSession, lost page nomination, connection metadata, or a failed old-profile
identity proof are possibilities. **Do not simply remove all account-switch
confirmation or force capability reuse.** Eliminate the false positive by fixing
identity/session continuity. Preserve caches and avoid the warning for the verified
same ILIAS account; retain a truthful safeguard and tenant isolation for an actual
different account or genuinely unverifiable replacement. Clear stale confirmation
UI when changing affiliation/cancelling, and reject delayed candidates for old
scope/affiliation/generation. Do not clear caches merely because affiliation changed.

## Tests and acceptance criteria

- Chrome: real installed-extension flow with an **HTTPS** synthetic provider,
  native callback action and immediate native `form.submit()`. Assert successful
  backend completion without the insecure-form interstitial/native app launch;
  verify callback consumed once. Cover delayed background replies and duplicate
  observer/redirect events, expired/wrong state, unrelated/login forms, error
  callbacks, logout mid-login and failed completion without an automatic retry.
- Existing `tests/test_unibe_companion_integration_browser.py` does include a
  synthetic autosubmitting form, but rewrites the provider origin to HTTP
  loopback. That does not reproduce the secure-page-to-native-form warning.
  Strengthen the regression rather than assuming the old passing test proves it.
- Firefox: retain installed/native parity. A mocked content script alone is not
  live SWITCH acceptance; report explicitly what was tested and what was not.
- New login with UniBE available automatically persists affiliation, verifies
  ILIAS and activates; no organisation-confirm click, including popup closure.
  No-UniBE case remains manually selectable. An explicit later choice stays put.
- Same verified identity + different affiliation: no replacement warning, same
  credential/cache content, stale confirmation removed. Actual different account:
  isolated replacement with proper consent; cannot inherit another user's cache.
- Keep backend-warning retries, popup width, logout-paused sync and language tests
  green. New user text must use the shared EN/DE catalogues.
- Start with `tests/unibe-companion.test.mjs`,
  `tests/test_unibe_companion_browser.py`,
  `tests/test_unibe_companion_integration_browser.py`,
  `tests/test_unibe_login.py`, `tests/test_unisport_ilias.py`, and logout regressions.
  Follow current AGENTS verification/release requirements. Bump runtime/extension
  versions when publishing behaviour changes; do not overwrite the existing
  1.6.0 store ZIPs with different code under the same extension version.

## Supporting documentation

- `docs/UNIBE_LOGIN.md`
- `docs/LEGACY_ILIAS_LOGIN.md`
- `docs/RELEASE_NOTES_1.10.0.md` (SWITCH form warning section)
- `docs/RELEASE_NOTES_1.11.0.md` (logout and cache/sync guarantees)
- `CHROMEWEBSTORE.md`, `PRIVACY.md`

Both Chrome and Firefox copies live under `extensions/`; keep them in parity and
preserve Firefox Xray-safe app storage/events. No provider registration, browser
store submission or production release is authorised by this handoff itself.
