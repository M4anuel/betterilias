# Unisport companion prototype

Version 1.3.0 adds an opt-in companion-assisted SWITCH login, independent
connection/disconnection, explicit affiliation selection and read-only personal
registrations. Default Unisport navigation is available in every semester.
This is an unofficial prototype reusing the inspected native application's
public client, not an approved BetterIlias SWITCH registration. Real-account
acceptance remains a manual check; synthetic tests do not establish it.

Version 1.4.0 adds public offer browsing, local search/sport filters, cached
details and viewing existing bookmarks. Public browsing does not require SWITCH
login. Version 1.5.0 adds manual registration, dynamic additional questions and
cancellation through the native API. Bookmark editing remains a future step.
Version 1.6.0 adds direct official participant-list links from existing
registrations and verified signup results.
Version 1.7.0 reads those lists through Companion 1.2.0 into a cached dialog with
live search, and caches native registration reads on both server and client.
Version 1.7.1 makes the separate website identity login an explicit connection
step, with Companion 1.2.1 resuming participant reads after the official return.
Version 1.8.0 adds an explicit server-side UniBE-token-to-ILIAS-session prototype.

## Try it locally

1. Install the updated backend requirements (`python -m pip install -r requirements.txt`
   in the application's virtual environment; `uv pip install` also works).
2. Set `UNISPORT_ENABLED=true` in the repository-root `.env` and restart the
   backend. The default is false, including in production.
   From 1.7.2 the frontend hides UniSport navigation/customisation and its direct
   view unless `/api/unisport/availability` explicitly reports `enabled: true`.
   Reload the page after changing the server flag; no frontend build flag is needed.
3. Reload the unpacked Chrome extension from `extensions/chrome/`, or temporarily
   load `extensions/firefox/manifest.json` in Firefox's `about:debugging`.
   These folders contain Companion 1.3.0; the store releases may still be older.
   Accept `login.eduid.ch` and `www.zssw.unibe.ch` access. Safari is not supported by
   this prototype.
4. In Companion settings, set the backend and frontend addresses to match the
   instance being tested (normally `http://localhost:8000` and
   `http://localhost:5173`). Reload the BetterIlias tab after loading the extension.
5. Open **Unisport** in the sidebar, or `/?view=unisport`. Click **Connect with
   SWITCH**. Complete login/consent directly on the real provider's page.
6. Return to BetterIlias, choose and confirm an affiliation, then load personal
   registrations. No booking request is made.
   To connect ILIAS without separately syncing browser cookies, choose
   **Connect ILIAS with this login**. If an ILIAS connection is already active,
   confirm the account switch. Only a positively verified exchange activates a
   new ILIAS capability; initial SWITCH login still uses the Companion.
   For participant lists, use **Complete website login** below the affiliation
   selector. Select the matching organisation/identity on SWITCH for the
   university sport website. Saving a native API affiliation cannot select that
   SAML identity: SWITCH releases the selected identity separately to each service.
7. Browse the public offers, filter by search text/sport type and open details.
   Use the saved-offers filter after choosing an affiliation to view bookmarks
   already present in the UniSport account. The official offer link opens the
   university's page separately.
8. After connecting and confirming affiliation, choose **Manage registration**
   in offer details. Review the freshly fetched conditions/costs and explicitly
   confirm registration, then complete any returned additional questions.
9. Cancel through **Manage registration** for an already registered offer, or
   **Cancel registration** in the personal list. Read and confirm any returned
   cancellation conditions. Use **Check request status** after an uncertain
   result; this never resubmits a provider mutation.
10. Use **Participant list** next to an existing registration or after a verified
    signup. The dialog filters names and offers locally as you type. An updated
    Companion reads the fixed ZSSW page with the browser's existing website
    session. If login is required, choose **Complete website login** in the
    dialog. The Companion opens that list's protected route in a normal tab and
    resumes the list read on the exact ZSSW return. Closing the login reports
    cancellation. The site enforces registration/access rights. Native
    UniApp login does not itself create a ZSSW web session.

Website login tracking contains only the owner/login tab IDs, configured frontend
origin, native scope/affiliation, fixed target path and ten-minute expiry in
extension session storage. It survives service-worker restarts and is removed
on completion, cancellation or native disconnect. No provider form fields,
identity chooser contents, passwords or SAML assertions are read. A return to
another site/path cannot complete it. Returning to the target is navigation
completion, not proof of list entitlement; the normal bounded HTML read still
validates the participant table before displaying rows.

See SWITCH's [identity chooser documentation](https://help.switch.ch/de/eduid/federation/login/chooser/):
the chosen organisational identity is released to the requesting service.

## Explicit ILIAS connection from the UniBE token (1.8.0)

Static inspection of UniBE Mobile 3.4.0 recovered `IliasLinkWidget`, the ILIAS
bottom-navigation route and `WebViewScreenState._resolveHeaders`. They use the
shared stored ID token and selected affiliation with:

```http
GET https://ilias.unibe.ch/mobile-auth?redirect=<personal-dashboard>
Authorization: <raw ID token>
X-UNICAMPUS-AFFILIATION: <selected affiliation>
```

Unlike the UniApp API's Bearer header, the inspected WebView assigns the raw ID
token directly. Anonymous live probes on 2026-11-25 confirmed the exact redirect
to `/Customizing/global/plugins/Origins2/mobileauth.php`; the alias returns 401
without authentication and routes an invalid synthetic token to an error page.
A PHP session cookie issued on rejection is not evidence of authentication.

`POST /api/unisport/ilias-connection` requires explicit UniSport capability,
connection scope and affiliation headers. It accepts no client token/target.
The server uses a fresh jar, pins the exact HTTPS UniBE ILIAS origin and confines
token headers to the two fixed entry/alias URLs. Subsequent verification requests
carry cookies only. Responses are bounded to 4 MB and the exchange to 60 seconds,
without automatic login retries or sharing verification requests.

Since 1.8.1, verification reads the fixed dashboard `jumpToProfile` command and
follows only bounded, same-origin own-profile redirects. The server-selected
`form_pd` editor must contain its unique, hidden `ne_un` login and the expected
personal-profile action. Generic containers, public avatars and HTTP 200 alone
are insufficient. A SHA-256 account key binds the native origin and unique login;
names/initials are never used to match accounts. Archived-course access notices
do not override positive identity. Before saving,
a database transaction rechecks the original UniSport generation, affiliation,
token/account data and expiry against disconnect/replacement. An explicit
`X-Session-Id` may nominate an existing capability for renewal. If its stored
verified account key matches, the same capability is retained, including when
the old upstream cookies have expired. Legacy sessions without that key require
a separate cookie-only own-profile proof. Unknown/different accounts get a new
random capability; ambient cookies and default tenants never nominate a renewal.
An atomic snapshot comparison prevents concurrent logout/account replacement
from resurrecting or overwriting the nominated session. Only the verified ILIAS
cookies, account-key digest, source and display name are saved. The UniBE
token never enters an ILIAS session file, the page, URL or diagnostic response.

Same-account renewal preserves the cache owner, all SID-scoped caches and server
state, including the request scope and correction-file caches. Authentication
refreshes without reloading the application. A different/unmatched account requires confirmation
after verification, then uses the existing cache-clearing account-switch path.
Cancelling keeps the current selection and caches. Native
download cookies are bound by normal authenticated API/status responses. A late
result after a frontend account/affiliation change is ignored. Failed exchange
does not replace existing ILIAS credentials. The new ILIAS connection is
independent: disconnect UniSport and log out ILIAS separately; existing ILIAS
session expiry/cleanup and tenant isolation rules still apply.

The first SWITCH authorization-code callback remains native-app-only, so this
does not eliminate the Companion entirely. A read-only live local-account probe
on 2026-11-26 confirmed valid-token exchange and cookie-only own-profile proof;
it persisted no resulting credentials. This fixes the initial 502: the dashboard
redirects through UniBE's semester plugin and no longer has the expected avatar.
Verification now uses the own-profile route independently of those dashboard
changes. Automated tests use synthetic tokens/cookies, isolated session files
and mocked upstream HTTP. Browser tests
cover both languages/themes and phone/tablet/desktop/short-landscape emulation.

Companion 1.3.0 is required to retain this explicit source selection. The page
stores `betterilias_ilias_source=unisport` only after verified exchange. Both
Chrome and Firefox then ignore automatic/cached browser-cookie selections for
that frontend origin, including content-script startup after reload. Manual
Companion sync clears the preference, as does a successfully claimed handoff.
This is a source preference, not an additional credential; no token is sent to
extension storage. Other BetterIlias origins retain independent preferences.
The frontend also pins that explicit selection to its cache owner before cache
initialization and ignores unsolicited Companion sync events while UniBE is
selected. This protects reloads with older installed Companion content scripts
that still write the obsolete browser capability into localStorage. Only a
verified UniBE activation carries the explicit UniBE source marker. A current
Companion's manual sync removes the preference and retains normal account-switch
behavior. Browser regressions cover both early storage writes and later DOM/
window messages, including correction-cache preservation.
The owner reported successful ILIAS connection after this selection fix on
2026-11-26; this does not establish extension-free initial SWITCH login.
Browser-cookie sync targeting a UniBE-renewed capability creates a separate
capability instead of overwriting it, including when the old Companion still
remembers that session ID. The existing manual-sync selection works in both
Chrome and Firefox. Expected verification rejection returns 422 with a fixed
`X-ILIAS-Verification-Stage`; transport failures remain 502. No provider body,
identity value or token appears in the stage diagnostic.
Token-created cookies always retain the exchange's User-Agent, including when
renewing a capability previously populated by a different browser. Native page
checks and authentication status share positive account-menu detection for the
current ILIAS UI; the same-origin own-profile menu command takes precedence over
login/help links embedded elsewhere. Public-profile/content links do not qualify.

## Catalogue and personal cache policy

The complete public catalogue is fetched in bounded 100-item pages, with duplicate
page and malformed-response detection. Only a complete successful snapshot is
published. Sport types are derived from all its offers, so filtering does not
depend on the first visible page. Search and filters run locally; showing more
cards does not fetch more upstream pages.

| Data | Fresh for | Storage and scope |
| --- | --- | --- |
| Complete catalogue and sport types | 15 minutes | Shared server SQLite and browser IndexedDB, separately per language |
| Offer details | 5 minutes | Shared server SQLite and browser IndexedDB, per offer ID/language; bounded to 128 details |
| Existing bookmarks | 1 minute | Browser sessionStorage, scoped to login generation, affiliation, list kind and language |
| Native registrations (1.7.0) | 1 minute | Private server SQLite and browser sessionStorage, scoped to capability hash/login generation/affiliation/language |
| Scraped participant rows (1.7.0) | 5 minutes | Browser tab storage only, scoped to native generation/affiliation/course and opaque website-cookie identity; at most 20 lists |

Public server data lives in `COORDINATION_DIR/unisport-public/cache.sqlite3` and
contains no credentials, personal bookmark flags or private lists. Shared locks
coalesce concurrent refreshes across workers. A failed refresh retains the last
complete snapshot; the server can serve it for up to seven days marked stale.
The browser retains its last public snapshot for offline/error recovery and
shows its timestamp, with an older-data warning after freshness expires. Explicit
refresh bypasses normal TTLs. Browser storage failures do not prevent browsing.

Public calls send neither bearer/affiliation credentials nor cookies. Bookmarks
provide membership and fallback titles only; current occurrences and status come
from the cached public catalogue/details, not the potentially old personalized
DTO. Private responses check account generation and affiliation again before
returning, and the UI rejects responses belonging to a previous scope. Disconnect
clears the tab's personal caches. A reconnect gets a new opaque cache scope;
provider subject IDs and tokens are not exposed for cache naming.

Availability remains a snapshot, not a booking guarantee. Dates with explicit
offsets are displayed in Europe/Zurich time. Detail text is converted to plain
text, and official links are restricted to HTTPS university hosts. No booking or
bookmark mutation is performed by the new browsing workflows.

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
session storage isolated from ILIAS and restrict each credential to its
destination; the explicit 1.8.0 exchange adds only UniBE ILIAS's fixed
mobile-auth entry/alias as a permitted destination for that ID token.

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

Bookmark editing remains to be implemented. Manual registration/cancellation
uses the native API in 1.5.0 (see below). Follow with explicitly armed one-occurrence
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
- Version 1.4.0 public-only live acceptance loaded a complete snapshot containing
  923 offers and 133 derived sport types on 2026-11-23. No account credentials
  were used. The project owner separately reported that the login prototype
  appears to work; this does not extend the agent's live private-account checks.
- Catalogue tests cover persistent/reused caches, complete pagination, language
  separation, bounded detail storage, stale fallback, local filters and focus
  restoration, IndexedDB reload, private-cache scope changes and rejection of
  in-flight private responses after disconnect. UI checks use Chromium emulation
  at the same phone/tablet/desktop widths and language/theme combinations above.

## Native registration and cancellation (1.5.0)

The Android package `ch.unibe.campusapp`, UniBE Mobile **3.4.0 (10193)**, was
downloaded from the public APKPure mirror on 2026-11-23 and inspected statically.
Android `apksigner verify --print-certs` passed. The certificate SHA-256 was
`7e6dcdeda83c3857ecfd5f91ded74d1067499682e1373c6546a060ddf831b835`;
the base APK SHA-256 was
`4d60a8108e9340dde3aa66a371795a7e774e00e0d0157bb693acfcb07bfb86b4`.
This is mirror-sourced artifact evidence, not a Play Store installation or live
account acceptance. The APK, proprietary assets/disassembly and supplied personal
ZSSW HTML are excluded from the repository. Tests contain synthetic data only.

Flutter/Dart AOT inspection recovered these POST calls in
`data/sport/remote/sport_auth_remote_data_source_impl.dart`. All use the existing
UniApp `/api/v3` origin, bearer ID token, selected affiliation and `locale`:

| Operation | Path suffix | Body / result |
| --- | --- | --- |
| Initial registration (`0xa100d4`) | `/sports/offers/apply/{offerId}` | No body; dynamic response containing `id`, `formComponents`, `result`, `offer` |
| Extra answers (`0x941254`) | `/sports/offers/submitAdditionalInfos/{offerId}` | `{"items":[{"id":"component-id","answers":["answer"]}]}`; registration result |
| Initial cancellation (`0x9233c0`) | `/sports/offers/cancelApplication/{offerId}` | No body; `confirmationText` and optional updated `offer` |
| Confirm cancellation (`0x916c8c`) | `/sports/offers/confirmCancellation/{offerId}` | No body; same cancellation result |

The app's registration action (`0x94ba74`) builds the form route using its
original offer ID (`0x94bb48`, `0x94c540`); the router forwards this path parameter
to the form screen (`0x92b078`). The form submits that same ID, not the dynamic
response's `id` field. The native repository (`0xa10298`) parses the registration
result from the response root; the dynamic DTO also declares an optional `result`
field. BetterIlias accepts both result shapes. Answers are arrays of strings.
Choice IDs and component IDs are strings. Native file handling base64-encodes raw file bytes
as the single answer (repository method `0x940edc`); date handling formats
`yyyy-MM-dd` (`FormatDate.backendSportFormComponent`, `0x93f8f4`). Components use
`textField`, `textArea`, `checkBox`, `radioType`, `dropDown`, `dateType`, `fileType`,
integer `required`, `dependantComponentId`/`dependantComponentValue`, nested
`additionalComponents` and choice-specific additional components. BetterIlias
supports those bounded controls and dependencies; unknown/malformed controls
block further submission instead of dropping required questions.

`SportOfferStatus` maps 1=open, 2=future, 3=closed, 4=cancelled by the user,
5=undefined, 6=fully booked, 7=no registration needed, 8=user cancellation possible,
9=user cancellation impossible, 10=already registered. Status 4 does not mean the
organiser cancelled the offer. Provider registration results distinguish
`success`/`failed`; HTTP 200 alone is insufficient. No CAPTCHA references or
parameters were found in the native UniSport call paths. This does not establish
that the upstream server can never demand additional checks. The downloaded ZSSW
web registration form independently uses invisible reCAPTCHA; its cancellation
form does not. BetterIlias does not recreate or bypass that website challenge.

### State, isolation and verification

The backend first fetches fresh private offer details and the complete private
application list. It binds a ten-minute intent to the owner, login generation,
affiliation, offer ID and exact occurrence start. Initial registration requires
status 1 and a current registration window when supplied; cancellation requires
an owned matching occurrence and status 8. Ambiguous occurrence/membership data
blocks the write. Offer conditions are rechecked before the initial POST. Form
submissions use the bound offer ID and stored provider-issued schema, never a client-supplied URL
or replacement form definition. Headers are checked again after budget acquisition
and before provider dispatch.

Private SQLite receipts and shared local-volume locks serialize the same account,
affiliation and occurrence across workers/browser capabilities. A durable
`dispatched` state is written before every possible provider POST. Separate
`start`, `answers` and `confirm` steps prevent a repeated earlier click from
advancing the next step. Status GETs never POST. Timeouts, malformed responses,
lost form responses and process crashes remain uncertain until fresh private
state establishes the outcome; they never trigger blind retries. A clearly
resolved prior operation can be recognized after reconnection without disclosing
its form to the new login generation. Outstanding unresolved operations cannot
be restarted from another connection; use the official account UI to resolve them.

Completion requires complete private membership readback and matching private
offer state for the same occurrence. Registration preserves the provider's
status text; waiting-list membership must not be labelled a confirmed place.
Cancellation requires disappearance of the owned occurrence and an appropriate
updated offer state. Offers that advance to another occurrence during verification
stay uncertain rather than claiming success for the wrong date.

Only an opaque receipt ID is retained in account/affiliation/occurrence-scoped
tab storage. It conveys no authentication authority without the separate browser
capability and current scope header. Answers, file bytes and tokens are not stored
in receipts or browser caches. Booking requests also require the displayed
affiliation in `X-Unisport-Affiliation`, so an affiliation change in another tab
cannot silently book under a different affiliation. Full offer conditions are
removed from receipts after dispatch; abandoned expired preparations are pruned,
and protected receipts are pruned seven days after their occurrence on subsequent
preparations. Unresolved future occurrences remain protected against replay.
Text/file drafts stay in mounted component memory
across resizing and closing/reopening the dialog; reloading loses unsent drafts.
Provider steps that expire after a dispatch require status checking or completion
in the official UI. Public catalogue/sport caches remain independent; reads used
for mutations bypass them, and private tab caches are invalidated after dispatch.

### Participant lists and test limits

No participant-list/Anmeldeliste endpoint was found in the inspected native
UniSport transport. This is an investigation result, not proof that the backend
has no such API. Version 1.6.0 uses the known official website route directly:
`https://www.zssw.unibe.ch/usp/zms/aii/anmeldeliste/{websiteCourseId}/index_ger.html`.
The supplied archery list confirms headings Nachname, Vorname and Angebot. Its
website course ID is 3003; the corresponding native offer ID is 28028. The IDs
must not be interchanged. Anonymous GET of that list on 2026-11-24 returned 302
to SWITCH's SAML endpoint; authenticated participant access remains a manual check.

Derive links only from recognized HTTPS ZSSW offer paths (`angebot`, `program`,
`offre`) in normalized offer URLs; keep the observed German participant-list path
for every interface language. Do not infer website course IDs from native IDs or
accept arbitrary origins. Personal-list cards reuse the complete public catalogue
already loaded/cached by the browsing component; no per-card detail requests or
extra catalogue reads are introduced. Participant-row caching is added only in
the private browser cache described below for 1.7.0. Cancelled rows
and offers without a known website mapping have no participant link. Booking
dialogs show it for verified signup results and still-owned pre-cancellation
states, then hide it after confirmed cancellation.

Version 1.6.0 links use native anchors and announce their new tab. Version 1.7.0
uses a dialog action, retaining the official anchor as a login/fallback path.
The native API token and BetterIlias credentials never appear in the participant
URL or get forwarded to ZSSW. Do not
reuse personal cancellation IDs from saved HTML or assume the UniApp token also
establishes a ZSSW browser session. Supplied personal HTML remains outside git;
participant navigation tests use synthetic accounts and names only.

`tests/test_unisport_booking.py` exercises synthetic native payloads, dynamic
forms, dependencies, dates/files, separate cancellation confirmation, readback,
expiry/occurrence/condition changes, ownership/scope and duplicate/concurrent
requests. `tests/test_unisport_booking_browser.py` covers German/English and
light/dark at 320/390/430/768/1280 CSS px plus short landscape, actual choices,
file selection, draft resizing/reopening, pending buttons, focus restoration,
lost responses and read-only recovery. Screenshots are inspected. These are
Chromium emulation checks, not physical-device or live provider mutation tests.
`tests/test_unisport_participants_browser.py` checks safe website-ID mapping,
cached catalogue reuse, live dialog filtering, source timestamp/cache reuse,
resize/focus restoration, session invalidation and official-page fallback at the
same screen widths/languages/themes. Tests use synthetic names and HTML only.

## Scraped participant dialog and registration cache (1.7.0)

Companion 1.2.0 adds narrowly scoped `https://www.zssw.unibe.ch/*` host access in
both Chrome and Firefox. Only configured top-level BetterIlias pages may request
the fixed German Anmeldeliste path, with a bounded numeric website course ID.
No arbitrary URL supplied by a page is fetched. The background request uses
the browser's current normal cookie store, bounded HTML, a 20-second deadline,
no referrer and manual redirect handling; redirects/auth failures require the
official website login rather than proxying or reading login forms. Private
windows and Firefox containers are rejected instead of silently selecting another
cookie store. Cookie restrictions may still require using the official page.
See the [Chrome cookie guidance](https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies).

Before reading a cached list, the browser hashes applicable ZSSW cookies together
with the configured instance origin, native scope and affiliation. Only this
opaque identity reaches the page; cookie values are not exported. Reads compare
the identity again after receiving HTML. Cookie-change notifications recheck it
before hiding visible data, so harmless unchanged cookie rewrites do not clear
a valid cache. Native disconnect/cache invalidation prevents late reads from
repopulating private storage. Participant HTML and names are never sent to the
BetterIlias backend, put in public IndexedDB or logged. The frontend parses an
inert template, requires the positive Nachname/Vorname/Angebot table structure,
and renders only bounded text cells; scripts, images and other page HTML are not
injected or executed. Missing access/table structure is not cached as an empty
list. Search filters the entire cached list without further network requests.
The Firefox content/identifying-information declarations and privacy/store docs
are updated for this local delivery; source publication is not a store release.

Native registration snapshots live in the private UniSport coordination database
for one minute of validity. Keys contain owner capability hash, login generation,
verified account/affiliation and language; no token is copied into a cache row.
Shared locks coalesce reads/refreshes and serialize cache loading against native
mutations for that account. Booking dispatch and outcome reconciliation invalidate
the account's cached snapshots. Booking eligibility/readback still uses the raw
client and never this cache. Disconnect drops owned cache rows; expiry pruning
and a 2000-entry bound prevent unlimited growth. Failed/incomplete loads and
responses from replaced connections are not cached.

`GET /api/unisport/applications` preserves its legacy array response. Optional
`metadata=true` returns `{items,fetched_at}` and `refresh=true` bypasses older
snapshots. The frontend preserves this original timestamp in tab storage rather
than restarting freshness on every cache hit. **Load registrations** reuses fresh
data; the adjacent refresh action forces an update. `tests/test_unisport_applications.py`
checks isolation, coalescing, expiry, refresh and concurrent write invalidation.
Actual installed Chromium and Firefox regressions use isolated profiles with
synthetic website cookies and fixed local endpoints, validating the real bridge
without any real SWITCH login or participant account read.
