# Shared UniBE login — BetterIlias 1.11.1 / Companion 1.7.0

Chrome and Firefox use one SWITCH/UniBE login for ILIAS and UniSport. Reload the
updated extension and BetterIlias tab when testing source installations. Store
publication is separate; an older store package may still show browser-cookie sync.

## User flow

1. Configure the backend and frontend origins in the Companion if necessary.
   Keep an existing BetterIlias tab open during the first migration so the
   Companion can nominate that account's capability for cache-preserving renewal.
2. Open the Companion. It checks the server-held login and its affiliations.
   Missing, expired or explicitly rejected tokens show **Sign in with SWITCH
   edu-ID**. Temporary server/network failures show **Retry**, without discarding
   credentials or pretending that the user is signed out.
3. Sign-in opens only the official SWITCH login tab. The action popup can close;
   pending state is stored in the background/session store. Passwords and MFA
   stay on SWITCH. Reopen the Companion after completing login.
4. After the native callback, the Companion popup shows the verified display name
   and affiliation choices. Labels show the substring after the last `@`, such as
   `unibe.ch`; option values retain the entire provider-supplied affiliation.
5. Choose an affiliation and submit **Use affiliation and connect**. Selecting an
   option alone sends nothing. The backend validates ownership and exchanges the
   UniBE token for a verified ILIAS session. An unmatched/different ILIAS account
   requires confirmation before the app selection changes.
6. Open BetterIlias. The extension supplies the shared login capability and
   verified ILIAS capability only to configured app origins. Same-account
   renewals preserve the cache owner, request scope and correction-file caches.

The current login's expiry is checked on the server. A fresh popup check also
reads affiliations from UniApp, detecting explicitly rejected credentials. The
visible expiry timer offers sign-in when the verified lifetime ends. It never
automatically logs in or refreshes a provider token. The popup and app logout end both the paired ILIAS and UniBE connections and
pause automatic restoration. The direct UniBE-only disconnect endpoint remains
available for legacy tooling. Global SWITCH SSO remains independent.

UniBE login works independently of the optional UniSport navigation flag.
`UNISPORT_ENABLED` still controls UniSport frontend/navigation and offer APIs.
The shared login is available only for the fixed UniBE ILIAS instance; custom
ILIAS installations can use the documented deprecated browser-cookie fallback.
Safari retains its existing browser-cookie workflow and has no shared UniBE login.

## Implementation and isolation

- `/api/auth/unibe/availability`, `/connection`, `/start`, `/complete`,
  `/affiliation` and `/ilias-connection` reuse the existing PKCE/state/nonce,
  signed ID-token validation, affiliation validation and ILIAS exchange services.
- All private requests use an explicit random `X-Unisport-Session` capability;
  ambient ILIAS cookies never select a UniBE connection. Affiliation changes and
  ILIAS exchange additionally bind the displayed login generation. Revocation
  readback cannot delete a newer login that replaced the checked record.
- The backend stores the verified token, subject, bounded display name, chosen
  affiliation and expiry in the existing private connection database. Lifetime
  remains token expiry or one hour, whichever comes first. No refresh token is
  retained. Provider tokens never enter extension/page storage or URLs.
- Extension connection records are isolated by a SHA-256 key over the configured
  backend and frontend origins. They contain BetterIlias capabilities and display
  metadata, not provider tokens. Conflicting open-tab contexts are rejected
  instead of selecting a default/latest tenant. Privileged controls accept only
  the extension's own popup page; web pages cannot invoke them through the bridge.
- Native callback/tab ownership stays in `storage.session`, including its login
  generation, so service-worker restarts do not depend on a global login variable.
  The shared and older page-first flows reuse the same bounded callback bridge.
- The activation candidate is bound to the verified login scope and affiliation.
  A disconnect, expiry or account change before confirmation prevents activation.
- Firefox writes through `wrappedJSObject.localStorage`, clones event detail into
  the page, and dispatches the existing synchronous session-selection event.
  A pending selection survives document-start before React initializes; the old
  cache owner remains available to clear genuinely different-account data.
- HTTP checks are bounded across headers and body reads. Verification failures
  preserve existing selected ILIAS credentials. No provider response text or
  identity value enters the stage diagnostics.

## Deprecated flow and recovery

The previous browser-cookie login is available through the Companion's
advanced **Use browser cookies (deprecated)** checkbox, inside the same popup. Automatic browser-cookie
sync is disabled in the default shared-login mode. Full protocol, historical
page-first flow and rollback instructions are preserved in
[LEGACY_ILIAS_LOGIN.md](LEGACY_ILIAS_LOGIN.md).

## Verification boundaries

Backend tests exercise expiry/rejection versus transient errors, explicit
credentials, account replacement and hidden-UniSport independence. Controller
tests cover both Chrome/Firefox sources, per-instance isolation, full affiliation
values and guarded activation. Browser tests exercise actual popup HTML in both
languages/themes at 320/390/430/768/1280 CSS px and short landscape, selection,
keyboard submission, confirmation, draft preservation and expiry/error recovery.
Installed Chromium and native headless Firefox regressions follow a synthetic
SWITCH callback through affiliation selection into the app. These are synthetic provider/backend
checks and desktop emulation, not live SWITCH acceptance or physical-device tests.

## Verified account usage (1.9.0)

With an administrator key configured, actual authenticated ILIAS/UniSport API use
updates a private account index in `activity.sqlite3`. Login, connection/status,
admin and diagnostic requests do not count. Shared UniBE login supplies the
server-verified issuer/client/subject; an instance-secret HMAC deduplicates browsers
without persisting the raw subject. Names are display values, never identity keys.
Legacy cookie-only sessions are not backfilled or guessed from names.

The dashboard shows distinct-account counts for five minutes, 24 hours and the
retained window. Names are fetched only after explicit expansion through the
admin-only `POST /api/admin/accounts/query`; search stays in the JSON body, not
URLs/logs. Responses use `no-store`. Names remain in component memory and clear
on collapse, search replacement, error, logout and session expiry.

Named rows expire **30 days after last actual app use**. Pruning runs on reads,
writes, startup and every five minutes while running, with SQLite secure deletion.
The index retains at most 10,000 most recently used accounts (32 MiB database cap).
Totals are consequently bounded and exclude anonymous/legacy-only accounts.
Existing per-connection usage keeps its separate 24-hour retention. Disabling the
admin key stops new named collection; existing rows still age out. The Companion
discloses collection and retention before login when enabled. Diagnostic events
continue to omit names, identity hashes and provider tokens.

## Companion 1.5.0 preferences

Online mode sets both origins to `https://betterilias.ch`. Local mode selects
`http://localhost:8000` and `http://localhost:5173`. Presets edit drafts; save to
apply them. Orange means unsaved; a green check briefly confirms persistence.
The legacy-mode checkbox previews the matching card and is persisted on Save.
Names and account scopes are never inferred from a language preference.

First use prefers the configured app's saved language if accessible, otherwise
the browser language. Both directions remain synchronized after first use and
across popup reopenings. Unsupported languages are ignored. This uses the app's
`betterilias_language` localStorage preference, not login cookies. Refresh app
tabs after installing/reloading the extension to activate the page bridge.
The background validates configured origins and shares only language codes.

The native `form_post` callback may trigger a non-HTTPS form warning. See
[1.10.0 release notes](RELEASE_NOTES_1.10.0.md#switch-form-warning) for evidence and
the distinction between that callback and local backend transport.

## 1.11.0 / Companion 1.6.0

Retry retains the warning and card until a validated backend status succeeds.
Rejected operations are distinct from connectivity failures. New affiliation
drafts prefer `unibe.ch`, while existing edits/selections remain. The cookie card
shows automatic-sync status under its action and no duplicate signed-in label.
Named-usage information is in BetterIlias's privacy/data-usage dialog.
Both popup login modes and app logout revoke paired credentials, clear private
content, cancel pending provider logins and prevent automatic re-sync. The app
and Companion must both be updated; refresh app tabs after reloading the add-on.
See [release notes](RELEASE_NOTES_1.11.0.md#logout) for upstream logout and SSO scope.

## 1.11.1 / Companion 1.7.0

Chrome and Firefox intercept the exact native callback POST form (`ch.unibe.campusapp://campusapp.unibe.ch`) before navigation, preventing Chrome's insecure-form interstitial and native protocol launch while delivering the callback once from the isolated content script. When a new SWITCH login completes and a `unibe.ch` affiliation is available, the background controller automatically persists that full affiliation, verifies ILIAS and activates the connection even if the popup was closed; an explicit later organisation selection is preserved. Same-account organisation changes retain the verified ILIAS capability and caches without showing an account-switch warning, while genuinely different or unverifiable accounts still require confirmation.
