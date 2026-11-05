# Private diagnostics and logging foundation

This is operational groundwork for a future admin dashboard, not a declaration
of GDPR/DSGVO compliance. The operator must establish and document the purpose,
legal basis, access policy and necessary retention before hosting for others.
Pseudonymous request/operation identifiers can still be personal data when
combined with a user's support report; handle the store accordingly.

## What is recorded

`backend/observability.py` accepts only registered event codes and constrained
metadata. Schema version 1 contains UTC Unix timestamps, category, random worker,
request and operation IDs, optional HTTP method/status/duration, fixed operation
name and outcome. An incoming `X-Request-Id` is ignored; the response receives a
fresh ID that a user can voluntarily include in a support report. IDs do not
identify or persistently track a user. No actor identifier is stored.

The schema has no fields for names, usernames, email addresses, IP addresses,
student/course/assignment IDs, grades, notes, file names, submission contents,
cookies, authentication headers, handoff codes, URLs, query strings, user agents,
exception text or stack traces. Unknown routes are not recorded as raw paths.
Request timing includes streaming; a disconnected/failed stream is a failed
request even if headers were already sent.

| Category | Events |
| --- | --- |
| Security rejection | Malformed URLs, unconfigured origins, ambiguous/unsafe commands, external writes, private DNS answers, rejected credentials/admin access, invalid numeric identifiers |
| Compatibility | Unsupported resource URL formats on the configured native origin; parser failures |
| Operational | Native throttling/unavailability, timeout/network failures, coordination contention, sanitized legacy warnings/errors, worker start/stop |
| Audit | Native/local write attempt and outcome; admin reads |
| Requests | Method, status and duration; validation failures |

A rejection is evidence that a guard fired, **not proof of an attack**. A genuine
new media proxy also produces `outbound.origin_not_allowed`. Its hostname and
signed URL are deliberately omitted; investigate a reproducible example through
a controlled support process before changing the allowlist. Compatibility events
do not automatically relax any outbound restriction.

Legacy console messages and tracebacks are replaced with fixed JSON level/source
codes. Legacy warnings/errors also enter the event store. HTTPX INFO logging and
Uvicorn's raw URL access logger are suppressed; the request middleware replaces
the latter. This intentionally sacrifices free-text debugging detail. Do not add
another raw logging handler or run with a logging configuration that overrides
these controls. Reverse proxies, hosting platforms and extension/browser logs
are outside this application's filter: configure their URL/header logging and
retention separately. Never log admin keys or signed calendar feed URLs there.

## Write audit semantics

Audits cover grades, TA allocation, feedback upload/delete/import, student
submissions, team membership, assignment editing/order/deletion, instruction
files, repository authoring/delete/order, course membership, persisted calendar
edits and subscription-token changes, and authentication sync/claim/logout/
handoff. Nested operations retain the same request ID and separate operation IDs.
No inputs, recipient identities, response contents or error messages are copied.

`started` means the operation entered its audited service. `returned` means the
service returned without a reported failure, **not independently verified native
persistence**. `partial` records reported per-item failures, including operations
where all items may have failed. `failed` records an explicit unsuccessful result.
Neither implies that no side effects occurred. An exception after an observed
native dispatch or local atomic replace is `uncertain`; before observed dispatch
it is `rejected`. Unknown native GET commands are conservatively treated as
potential writes, so an uncertain result can also be a failed preparation read.
Auth sync with `authenticated=false` is rejected. Validation/dependency failures
before service entry appear as request/security events, not successful writes.

The store is best effort, bounded and mutable by its OS owner. Queue overflow,
disk failure, a process crash or forced shutdown can lose events, including an
attempt or its finish. It is not a tamper-proof compliance ledger, evidence of
exactly-once execution, or a reason to retry a mutation.

## Storage and retention

Events reside in `.observability/events.sqlite3`, ignored by Git. Defaults:
seven days, at most 50,000 events, 32 MiB database, and a 2,048-item per-worker
memory queue. Old records are deleted before/after batches and during idle
maintenance (roughly every 30 seconds). Under size pressure older records are
evicted sooner. SQLite uses secure deletion, a page ceiling, reusable free pages
and a rollback journal bounded by database size; allow temporary journal space
as well as the configured database size. No event file rotation/export occurs.
Readers also exclude expired events. Secure deletion is not a guarantee of
physical erasure from SSDs, filesystem snapshots or backups.

The queue never waits for disk on a normal request. It does not replay failed
native writes. `dropped`, `storage_errors`, queue depth, writer liveness and last
write time expose losses **for the worker answering the admin request**; they
reset on restart. Event counts/timing summaries cover only retained records
across the shared volume, not lifetime totals or a complete monitoring system.
Outbound-budget counters/queue/cooldown are shared aggregates since that budget
database was created. Worker IDs on lifecycle events help correlate restarts;
there is no durable all-worker heartbeat or external availability alert yet.

All replicas must share one trusted local VPS volume and use identical limits;
this does not support independent VPSs/NFS. POSIX directories/files are restricted
to 0700/0600. On Windows restrict the inherited directory ACL to the backend OS
account. Mount privately, encrypt the volume, and never serve diagnostics as
static files. Exclude diagnostics and raw captures from routine backups; apply
equivalent expiry/access rules to any deliberate export. Keep production `.env`
and admin secrets outside source control and rotate keys when access changes.

While the server is stopped its timers cannot enforce retention. Schedule this
command at least hourly under the backend OS account, with the same environment
and data paths, and monitor its exit code:

```text
python -m backend.diagnostics prune
```

The job returns a generic failure without printing paths or exception details.
Operators must also manage expiry for sessions, staged imports, calendar state,
backups and reverse-proxy logs; this feature does not establish a whole-product
data retention policy.

## Parser captures

`@safe_parser` still creates a diagnostic artifact on failure, but by default it
contains only a fixed metadata marker. Its name contains a hash of the parser
context, timestamp and random suffix. Neither exception text nor `extra_info`
is written. Raw HTML is allowed only when **both** `APP_ENV=development` and
`CAPTURE_FAILED_HTML=true`. Production ignores that opt-in.

Defaults are 24 hours, 20 captures, and 1 MiB per capture. Captures are pruned on
creation, listing/access, server maintenance and the scheduled job. Applying
private defaults also deletes legacy raw `logs/failed_html_dump_*.html` captures,
even if they are younger than the age limit. Keep necessary debugging fixtures
separately, reviewed and de-identified. The development dump viewer remains
development-only; the new admin endpoints never expose raw pages. A server in
development mode must not be publicly hosted.

## Read-only admin API

The API is disabled (404) unless `ADMIN_API_KEY` has at least 43 characters.
Generate a **separate random secret**, for example:

```text
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

Only `X-Admin-Key` authenticates `/api/admin/events` and `/api/admin/summary`.
Student headers/cookies, bearer tokens and URL parameters do not grant admin
access. Every response is `no-store`; access/rejections are audited without the
supplied key. Events support `limit=1..200` and a monotonic `before` cursor.
Summary includes retained event counts, request timing/error aggregates, current
worker writer status, and aggregate outbound admission metrics.

Keep the API behind HTTPS and an operator-only network/proxy boundary; configure
rate limits there. Do not place the key in the public React bundle, extension
storage, URLs, browser localStorage or screenshots. There is no admin login/UI,
role management, per-admin attribution, key revocation history or MFA yet. A
future browser dashboard needs its own server-mediated administrator sessions.

## Operator decisions before public hosting

Document controller/processor responsibilities, privacy notice, processing
purposes/legal bases, necessary retention, permitted administrators and incident
handling. Review host agreements, backup locations and any international
transfers; determine applicable Swiss requirements as well as GDPR. Establish
data-subject request/deletion handling for actual application data. Do not build
a new user-identification index merely to search minimal diagnostics. Update
policies and implementation together if identifiable audit attribution becomes
necessary. Obtain the appropriate institutional/legal review before rollout.

The relevant design principles are purpose limitation, minimisation, storage
limitation and security (GDPR Article 5), privacy by design/default (Article 25)
and appropriate security measures (Article 32). These are design inputs, not
proof that the service as a whole meets every obligation:
[official GDPR text](https://eur-lex.europa.eu/eli/reg/2016/679/oj),
[OWASP logging guidance](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html).

## Verification

`tests/test_observability.py` exercises input exclusion (including token-bearing
URLs and unknown paths), generated correlation IDs, distinct rejection reasons,
nested/uncertain/partial write outcomes, independent disabled-by-default admin
access, legacy log sanitization, raw-capture opt-in/expiry/limits, shared-process
SQLite writes, queue overload and storage failure. These are offline tests, not
live ILIAS or physical-device validation. No frontend workflow is introduced.

Verified on 5 November 2026: full backend suite **556 passed, 329 skipped**;
Chrome browser allocation/outbound regressions **32 passed**; frontend production
build and locale validation (**1,660 keys**) passed; launcher syntax and isolated
`python -m backend.diagnostics prune` smoke check passed. Existing dependency
deprecation and frontend bundle-size warnings remain.
