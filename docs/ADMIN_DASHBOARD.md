# Administrator Dashboard

The BetterIlias administrator dashboard (`/admin/`) is an independent, security-isolated interface for operators to monitor system health, inspect sanitized operational logs, review consented diagnostic error reports, and manage community feature requests without accessing student data.

---

## 1. Capabilities & Feature Matrix

| Capability | What the Admin Dashboard Does | Security & Privacy Guarantee |
| :--- | :--- | :--- |
| **Operational Metrics** | Visualizes distinct active connections (5-min and 24-hour windows) and connection activity bar charts. | Measures connection volume, not personal identities. Multiple devices sharing one session count once. |
| **Sanitized Event Logging** | Real-time operational event logs with request IDs, route templates, and parser failure contexts. | Sensitive URLs, parameters, cookies, student names, and exception messages are strictly redacted. |
| **Request ID Tracing** | Filters all log events by a 32-hex request ID to trace a single request's lifecycle. | Server-side filtered; does not distort aggregate system metrics. |
| **Diagnostic Reports Review** | Reviews and manages user-submitted diagnostic error outlines (`open`, `resolved`, `reopened`). | Outlines are text-free and stripped of all student data. |
| **Feature Request Moderation** | Sets status of community suggestions (`planned`, `in_progress`, `completed`, `declined`), edits titles, and manages images. | Admin actions are audited and require valid administrative credentials. |
| **Zero Student App Footprint** | Built as a standalone entry point (`frontend/dist/admin/index.html`) independent of the student app bundle. | Does not import ILIAS session handoffs; never stores the admin key in localStorage or sessionStorage. |

---

## 2. Authentication and Setup (How-To)

Use this feature's checkout/worktree for **both backend and frontend**. Configure
`ADMIN_API_KEY` in its private `.env` or environment with a separately generated
random secret of at least 43 characters:

```text
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

Start the normal local development launcher, then open
`http://localhost:5173/admin/`. Enter the administrator key in the password field.
`http://localhost:5173/admin` also works: Vite development/preview and the backend
redirect this exact path to `/admin/`. In production, configure the static host
to do the same before applying the app's catch-all rewrite. For nginx:

```nginx
location = /admin { return 308 /admin/; }
```

The key is sent once in a JSON POST and removed from the form immediately;
neither localStorage nor sessionStorage stores it. The UI never uses the
student's `X-Session-Id` or bearer credential. A disabled server displays an
unavailable-access message and exposes no private diagnostics.

Build with `npm --prefix frontend run build`. The result includes the existing
`frontend/dist/index.html` and **`frontend/dist/admin/index.html`**. Configure the
HTTPS proxy/static host to serve `/admin/` from that file rather than rewriting
it to the student/landing app. Keep `/api` on the same origin. Preserve the
independent admin input if the landing page changes Vite's build entry points.
This feature does not add links to or modify the landing page.

## Connection activity graphs and database locations

Expanded events now show registered route templates, parser names, fixed failure
reasons, application version/backend source build and code-only stack locations
when available. **Show related events** resets category/code filters and applies
the event's request ID. You can also paste a 32-hex request ID into the request
filter, apply it, and clear it independently. Filtering is performed server-side
and works with older event rows; it does not change the overview metrics.
The code-locations region can be scrolled/focused with a keyboard and wraps long
paths on phones. No exception text, actual URL, source line or local variable is
displayed. See [the schema and limitations](OBSERVABILITY_PRIVACY.md#actionable-code-context).

The overview shows distinct authenticated connections active in the last five
minutes and across the rolling last 24 hours. Two interactive bar charts show
five-minute intervals over the last hour and hourly intervals over the last
24 hours. Select an interval using the slider (touch or keyboard) or expand the
data table. Refresh and optional 30-second automatic refresh also update these
graphs. Counts begin when this feature runs; existing logs are not backfilled.

These are connection counts, not a directory of people. The same saved session
on multiple devices counts once; reconnecting with a new credential may count
again. Activity means a request accepted by the local session dependency, not
proof that an ILIAS cookie is still valid remotely. Anonymous requests, auth
status polling, admin requests and diagnostic-report requests do not count.
App data refreshes do count; this is not foreground-tab/online presence.
Each interval deduplicates independently, so adding bars does not give the
24-hour distinct total. One sample per connection/minute means historical
interval boundaries can be approximate by up to one minute.

Private SQLite files are rooted in the **backend's own checkout**, not the
terminal's working directory (unless an absolute configured path overrides it):

| Default file | Contents |
| --- | --- |
| `.observability/events.sqlite3` | Operational/security/audit events |
| `.observability/activity.sqlite3` | 24-hour pseudonymous connection samples |
| `.diagnostic_reports/reports.sqlite3` | Consented error reports and sharing preferences |
| `.coordination/admin-sessions.sqlite3` | Short-lived administrator sessions |

`OBSERVABILITY_DIR`, `DIAGNOSTIC_REPORTS_DIR` and `COORDINATION_DIR` override the
directories. Files are created lazily; student sessions still live in `.sessions/`.
The activity database is private and excluded from Git, with a 32 MiB page ceiling
and at most 100,000 minute samples. Older samples are evicted under pressure;
collection is best effort and storage failures must not fail student actions.
Counts can therefore be lower than actual usage. No identity digest is returned
through the API: administrators receive aggregate counts only.

Samples contain a server-secret HMAC of the session credential, minute and last
seen time. They contain no raw credential, IP, page URL, name or ILIAS identifier.
This is still pseudonymous activity data, distinct from the content-free event
log and optional diagnostic reports. It is not controlled by report-sharing
consent. Include this operational measurement, its purpose and legal basis in
the operator's privacy notice; keep it out of backups and public serving. Samples
expire after 24 hours on reads/writes and the hourly scheduled
`python -m backend.diagnostics prune` job, including while the server is stopped.
No long-term activity history or per-user drill-down is retained. Shared workers
must use the same trusted local volume; independent VPSs/NFS are unsupported.

### Retired browser identifiers

Persistent browser UUID statistics have been removed. The app no longer creates,
reads or sends browser identifiers, and there is no browser-statistics setting
or browser-count selector. On app startup it removes the old
`betterilias_browser_statistics` localStorage entry without reading its contents.
Offline or cached old app versions need a refresh to perform this local cleanup.
The API ignores `X-BetterIlias-Browser-Id` headers from older clients.

Existing activity rows whose legacy `kind` is not `connection` are securely
removed on backend startup, metric reads/writes and the scheduled prune command.
Connection rows are preserved. Stop all older backend workers when deploying
this removal so they cannot continue collecting legacy data. SQLite cleanup
cannot remove backups or snapshots; apply the operator's deletion process there.
The dashboard retains only the documented 24-hour connection statistics.

## Access boundary

The login endpoint issues a separate random capability in an HttpOnly,
SameSite=Strict `betterilias_admin` cookie scoped to `/api/admin`. It is Secure
in production and expires after **30 minutes**, without sliding renewal. Local
HTTP testing requires `APP_ENV=development`; public deployment requires HTTPS.
GET `/api/admin/session` lets the page restore an unexpired session after reload.
Student headers/cookies and this admin cookie cannot authorize each other's APIs.

Only a keyed digest of the random capability and its expiry are stored in
`COORDINATION_DIR/admin-sessions.sqlite3`. All workers must share the same local
volume and configured key. Key rotation invalidates existing cookies immediately;
do not reuse retired keys. Logout deletes the server record and the browser
cookie, so replaying that capability fails. At most 32 active sessions are kept;
further sign-ins evict the oldest. Expired session and one-minute failed-attempt
records are removed during database access and by the existing scheduled
`python -m backend.diagnostics prune` job. No login IP/user identifier is stored.

JSON login/logout requests require `X-Admin-Request: 1`, which ordinary cross-site
forms cannot set. Strict cookies and the existing CORS policy provide the other
browser boundary. Invalid explicit `X-Admin-Key` headers never fall back to a
valid ambient cookie. Direct operator tools can continue using that separate
header for read-only diagnostics; no key is accepted from URL parameters.

Repeated invalid keys receive 429 after ten failures within a minute, with a
bounded shared counter. A valid key continues to work, so an attacker cannot
lock out an operator simply by exhausting this counter. Configure proxy-level
request/body limits as well. Login, rejected access and logout generate fixed
audit/security events without capturing keys or cookies. Responses are no-store.

This is an operator dashboard using one shared secret, not a directory of named
administrators. It provides no per-admin attribution, password recovery, SSO or
MFA. Keep the page/API behind an operator-only network/proxy boundary. Institutional
administrator identity and MFA can be added later without reusing student login.

## Reading the page

Cards distinguish retained API requests/errors/security rejections from current
worker loss counters. Writer health, pending records, storage/console errors,
last successful write and maximum retention apply to the responding worker.
Outbound admission counters are shared aggregates since the budget database was
created. Mean request duration comes from retained API events. These figures do
not prove the service or university is reachable, or represent lifetime totals.
Retained API request figures also include the dashboard's own diagnostic reads.

Events are newest-first with category/code filters and cursor pagination.
Expandable rows show only safe, known fields: request/operation/worker IDs,
method/status/duration, operation/result and component. The UI does not dump
arbitrary server JSON. A reported write return is labelled separately from
verified persistence, and uncertain results warn against blindly retrying.

Refresh is manual by default. Optional 30-second refresh pauses while the tab is
hidden or a request is in progress. Refresh failures keep existing figures and
mark them stale; filter changes clear the previous list. Requests are cancelled
and sequenced so an older filter response cannot replace the current view.
Expired/revoked sessions remove diagnostic data from the rendered page and return
focus to sign-in. A logout failure remains visible until retried or expiry.

The [consented report panel](DIAGNOSTIC_REPORTS.md) adds grouped error reports,
text-free outlines, safe JSON downloads and reversible open/resolved transitions.
There are no raw HTML dumps, student records, credential views or native ILIAS
settings/destructive operations on this dashboard. See
[logging and privacy](OBSERVABILITY_PRIVACY.md) for storage bounds, operator
retention/legal-basis responsibilities and limitations. Diagnostic identifiers
remain potentially personal when linked to a user's support report.

## Verification

Backend tests cover secure cookie flags/path, expiry, key rotation, logout replay,
CSRF headers, student/admin separation, storage bounds, malformed/failed logins,
storage failure and exclusion of secrets from responses/events/disk records.
Opt-in Chromium regressions exercise real rendered sign-in, filters, pagination,
refresh failures, logout, expiry, delayed-filter ordering and optional automatic
refresh with mocked diagnostics across 320, 390, 430,
768 and 1280 px plus short landscape, in English/light and German/dark. Screenshots
are saved under `scratch/admin-dashboard-review` for visual inspection. These are
emulated browser checks, not live ILIAS or physical iOS/Android validation.

Verification on 5 November 2026, combined with the landing-page integration:
**571 backend tests passed, 349 skipped**;
**20 admin browser regressions passed**; production multi-page build and locale
validation (**1,876 keys**) passed. Screenshots were visually reviewed for phone,
tablet and desktop density, wrapping, alignment and dark/light contrast; this
caught and corrected a German tablet refresh-button wrap. Existing dependency
deprecation and bundle-size warnings remain.
