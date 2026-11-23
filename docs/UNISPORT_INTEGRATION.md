# Unisport companion prototype

Version 1.3.0 adds an opt-in companion-assisted SWITCH login, independent
connection/disconnection, explicit affiliation selection and read-only personal
registrations. Default Unisport navigation is available in every semester.
This is an unofficial prototype reusing the inspected native application's
public client, not an approved BetterIlias SWITCH registration. Real-account
acceptance remains a manual check; synthetic tests do not establish it.

## Try it locally

1. Install the updated backend requirements (`python -m pip install -r requirements.txt`
   in the application's virtual environment; `uv pip install` also works).
2. Set `UNISPORT_ENABLED=true` in the repository-root `.env` and restart the
   backend. The default is false, including in production.
3. Reload the unpacked Chrome extension from `extensions/chrome/`, or temporarily
   load `extensions/firefox/manifest.json` in Firefox's `about:debugging`.
   These folders contain Companion 1.1.0; the store releases may still be older.
   Accept the new `login.eduid.ch` host permission. Safari is not supported by
   this prototype.
4. In Companion settings, set the backend and frontend addresses to match the
   instance being tested (normally `http://localhost:8000` and
   `http://localhost:5173`). Reload the BetterIlias tab after loading the extension.
5. Open **Unisport** in the sidebar, or `/?view=unisport`. Click **Connect with
   SWITCH**. Complete login/consent directly on the real provider's page.
6. Return to BetterIlias, choose and confirm an affiliation, then load personal
   registrations. No booking request is made.

If the browser asks to open the UniBE app, do not approve launching another app;
return to BetterIlias and check the connection. The companion observes the
native callback without blocking navigation; suppression of external-app prompts
is not guaranteed. A failed or uncertain exchange requires a new login, not a
retry of the old callback. Cancelling disconnects the backend transaction and
asks the companion to close its login tab. Disconnect does not log the
user out of SWITCH itself.

## Connection ownership and lifetime

The web page holds a separate random 256-bit capability under
`betterilias_unisport_session` in localStorage and sends it only in the
`X-Unisport-Session` header. It never substitutes an ILIAS session or cookie.
Only its hash keys server records. Provider tokens stay on the server and are
never sent through the page message bridge, native callback URLs on BetterIlias,
or extension local storage.

Pending state, nonce and PKCE verifier expire after ten minutes. The companion
keeps its own pending tab/state/capability mapping in `storage.session`, surviving
worker suspension but not a browser restart. It accepts callbacks only from its
own login tab and the pinned provider origin. The backend atomically consumes the
transaction before exchanging the code and validates the signed ID token's issuer,
audience, nonce, timestamps, authorized party and pinned-provider RSA key.
Disconnect or replacement while exchange is pending prevents stale completion.

No refresh token is retained and `offline_access` is not requested. Connections
expire at ID-token expiry or after one hour, whichever comes first. The private
SQLite database lives at `COORDINATION_DIR/unisport/connections.sqlite3` with
owner-only permissions on POSIX. Share the same private local coordination volume
across workers; never expose it through the web root. Expired records are removed
on access or the next login start; disconnect deletes the record immediately.
SQLite secure deletion is enabled. Removing the extension or closing the browser
does not itself revoke an established server connection.

## Source inspected

The user supplied the UniSportPro 0.1.0-test14 Windows distribution under
`Downloads/UniSportPro-0.1.0-test14-Windows-x64/`. Relevant application source is
in `payload/src/account.py`, `payload/src/model.py` and `payload/src/auth/`.
Only application source was inspected; the app was not launched and no account
store, saved credentials or private user data were read.

## Established protocol

- Issuer: `https://login.eduid.ch/`.
- Discovery: `https://login.eduid.ch/.well-known/openid-configuration`.
- Authorization/token/JWKS: `/idp/profile/oidc/authorize`,
  `/idp/profile/oidc/token`, `/idp/profile/oidc/keyset` on that issuer.
- Client ID: `unibe-campusapp` (public protocol identifier).
- Redirect: `ch.unibe.campusapp://campusapp.unibe.ch`.
- Authorization-code flow with S256 PKCE, state and nonce; the source requests
  `openid`, `swissEduIDBase`, `swissEduIDExtended`, `profile`, `email`,
  `https://login.eduid.ch/authz/User.Read` and `offline_access`.
- ID tokens are validated using pinned-provider RSA signing keys, exact issuer
  and client audience, expiry/issued-at, nonce and authorized-party checks.
- Refresh tokens are kept in Windows Credential Manager. Refresh reserves a
  `refresh_pending` record before exchange; uncertain exchanges require login.
- Affiliations: `GET /api/v3/auth/openid/affiliations`, with the ID token as Bearer
  credential and no affiliation header. Response identifiers use `affiliation`.
  Selection must be validated against a fresh account-owned list.
- Protected sports reads send that ID token plus `X-UNICAMPUS-AFFILIATION`.
- Public search: `GET /api/v3/sports/offers/search` with `locale`, `offset`,
  `limit`, `search`, `available=false`. Offer details use
  `/api/v3/sports/offers/getOffer/<id>`.
- Personal bookmarks: `/api/v3/sports/recommendation/myBookmarks`.
- Registrations: `/api/v3/sports/offers/myApplications`; occurrence identity is
  offer ID plus start datetime, not offer ID alone.

The API origin is `https://api.uniapp-backend.unibe.ch`. Keep provider and UniApp
credentials isolated from ILIAS and restrict each credential to its destination.

## Web integration gap

`isolated_browser_login.py` launches a separate Edge process/profile, then uses
Chrome DevTools Protocol events and response interception to capture the native
callback, including redirect and form-post variants. This is a desktop transport,
not a normal website callback or a Switch login form hosted by BetterIlias.

The prototype implements the companion handoff while preserving state, nonce,
PKCE ownership and browser-account isolation. A supported future integration
could use a registered web callback/client whose token is accepted by UniApp.
It does not launch browsers on the VPS or substitute arbitrary redirect URIs.

The prototype explicitly requests `response_mode=form_post`, advertised by the
provider discovery document and observed by both companion implementations in
synthetic tests. Installed Firefox did not expose the tested native-scheme HTTP
redirect through its webRequest events; it depends on the requested form-post
response. Chromium also captures native HTTP redirects as a fallback. Do not
claim Firefox redirect support or silently switch back to the default query mode.

## Read-only live checks

Public provider discovery returned HTTP 200 and confirmed the above endpoints,
authorization-code/refresh-token grants and S256 support. It did not advertise a
device-authorization endpoint or dynamic client-registration endpoint.

A no-session, `prompt=none` authorization preflight returned HTTP 302 for the
native redirect; substituting a BetterIlias HTTPS callback returned HTTP 500.
That failure alone does not identify the provider's internal rejection reason
and does not establish which other redirect URIs the client has registered.

The recovered public search endpoint returned HTTP 200 and a JSON list without
credentials. Earlier guessed catalogue/OpenAPI paths returned 404. No login,
token exchange, personal-data read, registration or other account mutation was
performed during this investigation.

## Remaining feature scope

Future upgrade: remove the companion dependency from UniSport login by obtaining
an approved SWITCH client with a BetterIlias HTTPS callback. Confirm that the
UniApp backend accepts tokens issued to that client; SWITCH login alone does not
establish API compatibility. Keep authorization-code exchange and token storage
on the backend, with PKCE, state, nonce and independent session isolation.
Replace the native-callback bridge once the direct web flow is verified. UniSport
API calls already run through the backend and do not require the companion after
login; the existing ILIAS companion integration is a separate concern.

Public offer search/detail views and bookmarks remain to be implemented.
Follow with verified manual registration and explicitly armed one-occurrence
client-timed registration. Autologin, recurring subscriptions and browser-closed
scheduling remain later features. Mocked authentication is development/test-only
and must not enable production account operations.

## Verification boundaries

- Backend tests use freshly signed synthetic RSA tokens and mocked upstream
  responses: PKCE binding, invalid claims/keys, callback duplicates/state/origin,
  single use, uncertain exchange, expiry, affiliation ownership and concurrent
  disconnect/replacement. HTTP tests verify feature gating and ILIAS isolation.
- Installed Chromium regressions exercise the actual companion scripts with a
  synthetic loopback provider/backend, including redirects, form posts and worker
  restart. The earlier feasibility probe is retained separately.
- Native installed Firefox, with a fresh profile, captures form-post callbacks
  using the actual companion scripts. Page replies are checked for the correct
  source/origin so the React bridge can receive completion. Native HTTP redirect
  capture is unsupported in the tested Firefox environment, as noted above.
- UI regressions emulate Chromium at 320, 390, 430, 768 and 1280 CSS px and short
  landscape in German/English and light/dark. They exercise explicit affiliation
  confirmation, resizing drafts, registration reads, cancellation and retry.
  Screenshots are reviewed for appearance as well as overflow.
- No real SWITCH login/token exchange, live personal UniApp read, booking,
  physical iOS Safari or Android Chrome validation has been performed.
