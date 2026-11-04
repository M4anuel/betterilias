# Session isolation and first-VPS coordination

## Runtime modes

`APP_ENV` accepts `production`, `development`, or `test`. It defaults to
production. `start.py` explicitly launches a development backend; `run.py`
enables Uvicorn reload only in development. Set `APP_ENV=development` explicitly
when starting a backend manually for local development.

Production and test return 404 for every `/api/system/logs` route. Production
also disables generated API documentation and omits dump paths in parser error
responses. Development raw dump responses are sandboxed with CSP and not cached.
Keep the development server on loopback: these diagnostics contain private page
contents and are not an authenticated administration dashboard. There is no
maintenance UI entry in the frontend to gate; Vite's production build alone must
never grant access to backend diagnostics. The server's runtime mode is authoritative.

## Authentication

Login is through the Chrome/Firefox companion only; the headed browser helper,
`login.py`, `/api/auth/login-browser`, manual cookie UI, and `/api/auth/cookies`
are removed. Existing extensions keep refreshing their explicitly selected tenant.
Incoming cookies are checked against ILIAS before replacing saved credentials.
An unknown or malformed requested ID receives a new server-generated capability;
it cannot establish a chosen filename. A detected change in verified display name
creates a new tenant rather than relabelling the old one. Display names are not
stable subject identifiers: equally named accounts cannot be distinguished by
this check; extension account linking remains capability based.

Private API requests require an existing explicit tenant capability. There is no
default-session or most-recent-user fallback, including during development. The
internal legacy SessionManager remains for isolated tooling/tests, not HTTP login.
Logout deletes only the selected tenant. Frontend content caches are cleared on
identity changes, and extension account changes reload the current application.

JSON requests normally send `X-Session-Id` from localStorage. Successful status
checks and connection claims establish a `betterilias_session` HttpOnly,
SameSite=Strict cookie scoped to `/api`; it is Secure in production. Native GET
downloads/previews use this cookie. Mutations require an explicit header/bearer
credential; an ambient cookie cannot authorize a form submission. Explicit
credentials take precedence and invalid credentials never fall back to a cookie.
Serve frontend and `/api` at the same HTTPS origin in production. During local
development use Vite's `/api` proxy. The companion still needs the eventual
production hostname added to its host permissions before public release.

Long-lived capabilities remain in extension storage, frontend localStorage,
headers, and private server persistence; this is not a complete migration to
HttpOnly-only authentication. Protect these stores and do not log headers or
auth request/response bodies. Database-backed stable user identity, device
revocation, and administrator authentication remain separate follow-up work.

## URL changes

Previously session IDs appeared in native material download/PDF URLs, TA ZIP
exports, calendar exports, extension open-app query strings, and phone QR links.
These usages are removed. The backend no longer accepts `?session_id=...` for
authentication. Old URL credentials are stripped by the frontend and not adopted.
Course-session object IDs in course paths are content identifiers, not credentials.

Phone QR codes and extension open-app links now contain `#connect=<random code>`.
The fragment is removed before requests start; `/api/auth/claim` exchanges it for
the capability and browser cookie. Codes expire after 60 seconds, are stored only
as SHA-256 digests, and are consumed atomically across workers. Replay and use
after logout fail. The QR panel expires its displayed code and lets the user
generate another. Calendar subscription tokens remain separate, revocable,
read-only feed credentials: calendar clients need a stable feed URL.

The former URL approach came from the local single-user prototype and convenient
native anchor/iframe downloads. It should have been revisited when multi-user
hosting was introduced; it was not a requirement of ILIAS or the extensions.

## Shared coordination and persistence

The implementation supports several API workers/containers **on one VPS**,
sharing a local Docker data volume. Every replica must use the same absolute
`COORDINATION_DIR`, `SESSIONS_DIR`, calendar storage (`.calendar`, currently
relative to working directory), feedback staging (`.staged_imports`), and working
directory/data mounts. Merely sharing coordination while keeping private session
or calendar directories is not sufficient.

- OS advisory locks replace in-memory native submission-view locks. They are
  keyed by a hash of the native PHP session so aliases of that session coordinate.
- TA allocation checking and batch saving hold a per-assignment lock, with a
  native-session lock across the read/check/write sequence. Feedback commits hold
  assignment and staging-import locks, preventing duplicate concurrent publication.
  Grading, allocations and bulk feedback publication additionally share an
  exercise write lock so batch operations cannot overwrite a concurrent grade.
  Preview IDs are random and commit IDs cannot traverse tenant directories.
- Calendar read/modify/write operations lock the tenant; subscription-token
  rotation/revocation additionally locks the shared token index. Session and
  calendar files use atomic replacement. Separate user keys permit concurrency.
- Single-use handoffs use SQLite transactions in the shared coordination volume.
- Contention times out with 503/Retry-After. Synchronous operations inside the
  event loop fail promptly when busy rather than blocking that loop. OS locks
  release on crashes; persistent lock files must not be deleted while servers run.

These locks coordinate BetterIlias processes, not native browser actions by
tutors or university-side transactions. They cannot provide compare-and-swap
against ILIAS. Existing read-back checks/fingerprints still matter. A crashed
native write can have an uncertain outcome and must not be blindly retried.

Do not use the SQLite/file-lock deployment across different VPSs or NFS mounts.
Before multi-host scaling, move persistent tenant/calendar/import data into shared
database/object storage and replace locks/handoffs with a networked coordinator
(for example Redis with safe lease renewal/ownership checks). No Redis dependency
or claim of multi-host readiness is hidden in this implementation.

## University-side request limits

A single public egress IP aggregates all backend scraping traffic. Per-IP limits
at a reverse proxy/WAF/firewall can therefore affect all tenants even though each
has separate ILIAS cookies. There is no verified Bern threshold or evidence here
that a particular student count will trigger a limit. ILIAS's upstream
[secure deployment guidance](https://github.com/ILIAS-eLearning/ILIAS/blob/release_11/docs/configuration/secure.md)
describes administrator-controlled web-server/firewall deployment; it is not a
published universal requests/minute allowance and does not reveal Bern's settings.
Ask Bern's [ILIAS support](https://teachinghub.unibe.ch/journey_der_lehre/tools/ilias/index_ger.html)
about expected aggregated traffic and supported integration before a broad rollout.

Shared outbound concurrency/rate budgets, native-session fairness, allowlisted
in-worker GET coalescing and 429/503 Retry-After handling are implemented. See
[configuration, offline load measurements and limitations](OUTBOUND_TRAFFIC.md).
The defaults are conservative application settings, not a verified university
allowance or proof of 100-user production capacity. Writes are not replayed and
403 is not treated as rate limiting. Measure native requests per user workflow
(especially bulk TA jobs), not only inbound API requests. Existing view locks
still serve a separate purpose from the outbound budget. Additional backends
behind the same egress IP do not increase an upstream per-IP allowance. Video
media commonly streams directly from Opencast; not all bytes pass through this
VPS. Public hosting also requires an audit/restriction of URL fetch targets and
redirects, including the general download/PDF routes; traffic volume control
does not provide SSRF or cross-origin cookie-forwarding protection.
