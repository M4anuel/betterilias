> Companion 1.5.0 update: enable **Use browser cookies (deprecated)** in advanced
> settings and Save. It swaps the popup's login card in place. Sign in opens the
> official ILIAS site; manual sync appears only after a verified browser session.
> The historical standalone popup/protocol below is retained for reference.

# Deprecated ILIAS login workflows

These workflows are retained for compatibility and recovery. The primary Chrome/
Firefox workflow since BetterIlias 1.9.0 / Companion 1.4.0 is
[shared UniBE login](UNIBE_LOGIN.md). Safari continues using its browser-cookie
workflow because it does not implement the UniBE native-callback bridge.

## Browser-cookie sync: how it worked

1. The user signed into `https://ilias.unibe.ch` in a normal browser tab, including
   SWITCH and MFA where required.
2. `background.js` watched ILIAS authentication-cookie changes, debounced checks
   and periodically checked every five minutes when automatic sync was enabled.
   The popup could explicitly perform the same operation.
3. Cookie collection retained `PHPSESSID`, `ilClientId`, `_shibsession_*` and
   `il_*`, filtering malformed names. It supplied `ilClientId=ilias3_unibe` if
   missing. A PHP session alone was never sufficient proof of authentication.
4. The extension POSTed `/api/auth/sync` to its configured BetterIlias backend,
   with `{cookies,session_id,source,user_agent}`. The existing capability was
   optional; unknown/default identifiers could not select another tenant.
5. The backend verified incoming cookies in an isolated client before replacing
   saved credentials. Network failures did not replace working credentials.
   Different/unknown accounts received isolated capabilities under the existing
   sync rules. It stored verified cookies and matching User-Agent server-side.
6. The extension kept the resulting BetterIlias capability, display name and
   last-success/cookie-signature metadata in extension storage. It notified only
   configured BetterIlias origins. Firefox used page-readable storage and cloned
   DOM-event detail across its Xray boundary.
7. The app selected the capability via `BETTERILIAS_SESSION_SYNCED`. API mutations
   sent an explicit header; ordinary API responses bound the HttpOnly native
   resource cookie. Switching cache owners cleared previous-account content.
8. If a tab lacked a content script, manual sync used `/api/auth/mobile-session`
   and `/api/auth/claim` to deliver a separate, single-use, 60-second handoff code.
   Long-lived session IDs never entered navigation URLs.

Relevant code remains in both browser folders: `legacy-popup.html`, `popup.js`,
the legacy portions of `background.js` and `content.js`, plus
`backend/api/routes/auth.py`. Signature/credential values are private; protocol
documentation does not need actual account cookies or session identifiers.

## Use the fallback in the current release

1. Open the Companion's advanced settings and select **Browser-cookie login
   (deprecated)**. This opens the legacy popup as a tab and explicitly selects
   extension setting `authMethod=legacy`.
2. Sign into ILIAS in the browser and click **Sync session with BetterIlias**.
   A successful manual sync clears the page's UniBE source preference and selects
   the verified browser-cookie connection. Account isolation still applies.
3. To return to shared login, open the normal Companion popup, complete/select
   the UniBE login and explicitly connect. Activation selects `authMethod=unibe`.

In shared mode, browser-cookie alarms/startup do not export ILIAS cookies. Old
installed content scripts cannot silently replace a page's explicit UniBE
selection. The backend also protects a UniBE-renewed capability from a browser
sync that still remembers its old ID by creating a separate browser capability.

## Earlier page-first UniSport/ILIAS exchange

The earlier prototype started on BetterIlias's UniSport page:

1. The page generated its separate random `betterilias_unisport_session`
   capability and POSTed `/api/unisport/auth/start`.
2. The backend created PKCE verifier/challenge, state and nonce, using client
   `unibe-campusapp`, callback `ch.unibe.campusapp://campusapp.unibe.ch`,
   authorization-code response and explicit `form_post`.
3. `UNISPORT_START` asked the Companion to open the fixed SWITCH authorization
   URL. The Companion associated state with the login tab and originating app tab
   in session storage, observed the exact native callback and POSTed it to
   `/api/unisport/auth/complete`.
4. The backend consumed the pending transaction before exchanging the code,
   verified RS256/JWKS, issuer, audience/authorized party, expiry, state and nonce,
   and stored the short-lived ID token. Uncertain exchanges were never retried.
5. The page fetched `/affiliations` and explicitly PUT the full affiliation to
   `/api/unisport/affiliation`.
6. **Connect ILIAS with this login** POSTed `/api/unisport/ilias-connection` with
   the UniSport capability, displayed scope/affiliation and optional explicit old
   ILIAS capability. The backend sent raw Authorization and affiliation only to
   the fixed ILIAS mobile-auth entry/exact alias, then verified cookies through
   the server-selected own-profile editor.
7. Since 1.8.1, a verified unique-login match retained the same capability and
   caches. An unmatched account required confirmation before selecting a new
   capability. A source preference prevented automatic Companion cookie sync
   from undoing that explicit selection.

The existing page-first API remains available under the UniSport feature flag.
To expose its archived page controls explicitly, open
`?view=unisport&legacy-unisport-login=1` on the configured BetterIlias origin.
Normal UniSport login/management buttons open the Companion instead.
Its protocol evidence is recorded in [UNISPORT_INTEGRATION.md](UNISPORT_INTEGRATION.md).
The new Companion reuses these services through `/api/auth/unibe/*`, so it does
not need UniSport navigation enabled simply to authenticate ILIAS.

## Code rollback reference

The final release before the shared-login popup is immutable tag `v1.8.1`, commit
`510b87401e3677fea576180b64ffe2cd145c106e`. Inspect it with
`git show v1.8.1:extensions/chrome/popup.js` or create a separate recovery branch
with `git switch -c recovery/legacy-login v1.8.1`. Test that branch before
deployment; never move an existing tag or force-push a shared branch. The current
release's explicit fallback normally avoids needing a code rollback at all.
