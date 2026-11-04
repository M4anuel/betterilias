# Outbound traffic control and hosting limits

The backend now shares outbound admission across workers on **one VPS with one
local data volume**. This protects the university-facing request budget from
being multiplied by API worker count. It does not establish Bern's permitted
traffic levels or make the whole application ready for public hosting.

## Behaviour

Every HTTP hop sent by `SessionManager.get_http_client()` passes through
`BudgetTransport`, including session verification, native form posts, redirects,
calendar fetches, feedback jobs and streamed downloads. Direct browser playback
from Opencast does not go through this transport.

The default shared limits are:

| Setting | Default | Meaning |
| --- | ---: | --- |
| `OUTBOUND_MAX_CONCURRENCY` | 6 | Open native responses across all workers |
| `OUTBOUND_PER_SESSION_CONCURRENCY` | 2 | Open responses per native PHP session |
| `OUTBOUND_REQUESTS_PER_SECOND` | 5 | Spaced admissions; no accumulated burst tokens |
| `OUTBOUND_QUEUE_LIMIT` | 512 | Waiting native requests across all workers |
| `OUTBOUND_PER_SESSION_QUEUE_LIMIT` | 32 | Waiting requests per native PHP session |
| `OUTBOUND_QUEUE_TIMEOUT_SECONDS` | 20 | Maximum admission wait per attempt |
| `OUTBOUND_READ_RETRIES` | 2 | Additional attempts for allowlisted reads only |
| `OUTBOUND_COALESCE_MAX_BYTES` | 2097152 | Maximum raw body shared by simultaneous identical reads; 0 disables sharing |

These are conservative application defaults, **not university-approved limits**.
One busy native session cannot occupy more than its configured capacity, and
queued sessions take turns by their last admission, with FIFO order within each
session. Aliases of the same native PHP session share one identity. The database
stores identity digests, random queue tokens, timestamps and aggregate counters;
it does not store cookies, URLs, student content or response bodies.

Fixed OS-locked slots remain held until response consumption or explicit close,
including downloads with slow consumers. Worker termination releases its locks;
the next scheduler pass reclaims stale slot records. Waiting tickets expire.
SQLite operations run in worker threads. One dispatcher per event loop polls
the shared queue, rather than each waiting HTTP request polling independently.

HTTP 429 and 503 responses set a shared cooldown. `Retry-After` supports both
delta-seconds and HTTP dates, with additive jitter. Missing or invalid values use
bounded exponential delays. Long upstream cooldowns can exceed the queue timeout;
clients receive a localized 503 `ILIAS_BUSY` response with `Retry-After` instead
of waiting indefinitely. A 403 is not interpreted as rate limiting.

ILIAS has GET commands that change state. Only a small explicit allowlist of
dashboard, membership, repository-view, exercise-overview and information-screen
GETs can be retried or coalesced. Unknown query parameters, duplicate parameters,
range requests, downloads, pagination/filter changes, logout and editor commands
are excluded. POST/PUT/PATCH/DELETE are never replayed by this transport. Existing
native redirect handling remains HTTPX's responsibility.

Identical simultaneous eligible reads share one small HTML/JSON response within
the **same worker/event loop**, with exact URL, native identity and request
headers (including cookies, language and validators) in the matching digest.
Each consumer receives an independent stream/decoder and cookie extraction.
Completed reads are not cached. Large bodies and files remain streamed; an
unknown-length body exceeding the sharing limit retains its complete original
stream. Coalescing is intentionally not implemented through persistent storage
or across workers. All workers still share the rate/concurrency budget.

Cancellation releases queued work and granted capacity. Cancellation of one
coalesced waiter does not cancel the leader. A cancelled leader lets remaining
waiters perform their own budgeted safe read. Exhausted rate-limit failures are
shared so identical waiters do not each start a fresh retry sequence.

Rate limiting does not mark credentials expired or count as successful cookie
verification. The existing UI displays the localized error and permits manual
retry without disconnecting the account. For mutation API requests, the error
asks the user to check ILIAS before trying again: earlier steps in a multi-step
write may already have succeeded. Native workflow fallbacks propagate this
condition instead of trying another write route automatically.

## Deployment and operation

All workers must use the same absolute `COORDINATION_DIR`, the same local volume
and identical budget settings. SQLite WAL and advisory locks require local
filesystem semantics. This implementation is not suitable for separate VPSs or
NFS, and must not be duplicated into independent coordination directories while
sharing one egress IP.

Settings are recorded in `outbound.sqlite3`. A worker with different settings
fails closed and logs a configuration mismatch. To change limits, stop **all**
workers, remove only the outbound database and its `-wal`/`-shm` sidecars from the
coordination directory, update every worker's environment, and restart. This also
resets traffic counters and cooldowns; preserve any upstream cooldown before
restarting. Never delete the advisory `.lock` files while workers are running.
Session files and `handoffs.sqlite3` are unrelated and must be preserved.

Local operators can inspect aggregate counters without a public diagnostics
endpoint:

```powershell
python -c "from backend.outbound_budget import OutboundBudget; print(OutboundBudget().snapshot())"
```

`requests` counts admitted native hops, including failed/throttled responses;
`queue_wait_seconds` is cumulative admitted-request wait. `queued` excludes
expired tickets. Counters are not a full metrics system or admin dashboard.

The custom HTTPX transport currently creates direct connections; environment
HTTP proxy routing is not provided by this transport. A hosting setup requiring
an upstream proxy needs an explicitly budgeted proxy transport adapter.

## Offline evidence

Run without any ILIAS credentials or external traffic:

```powershell
python -m pytest tests/test_outbound.py -q
python scripts/load_outbound.py --users 10 25 50 100 --workers 2 --rate 50
python scripts/load_outbound.py --users 10 100 --workers 2 --rate 5
```

The harness uses HTTPX MockTransport in separate processes and temporary local
coordination storage. Each user reads a dashboard, a course twice concurrently,
an exercise overview, and downloads a file. One TA additionally downloads eight
files. This is a representative scheduler scenario, not an end-to-end capacity
measurement of every BetterIlias workflow, a real VPS benchmark or live ILIAS
acceptance. Native TA jobs may perform many more requests.

Observed on the development Windows machine on 4 November 2026, with two workers,
6 shared slots, 2 slots per session and a 20-second queue deadline:

| Simultaneous users | Configured admissions/s | Completed | Busy | Native requests | Without coalescing | Wall time |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 10 | 50 | 10 | 0 | 48 | 58 | 2.68 s |
| 25 | 50 | 25 | 0 | 108 | 133 | 5.79 s |
| 50 | 50 | 50 | 0 | 208 | 258 | 10.14 s |
| 100 | 50 | 100 | 0 | 408 | 508 | 19.44 s |
| 10 | 5 | 10 | 0 | 48 | 58 | 10.70 s |
| 100 | 5 | 90 | 10 | 365 | 508 | 79.69 s |

Observed peak concurrency was 2 in the accelerated scenarios and 1 at the
default rate because the synthetic response latency is short. Separate focused
tests saturate the configured slots, verify per-session fairness, keep streamed
responses open, and test separate-process exclusion and abrupt process death.
The 100-user default-rate burst intentionally demonstrates bounded rejection;
it is not evidence of acceptable latency for a 100-user launch. Increasing the
queue deadline alone would conceal overload through longer waits.

Browser regressions use the production frontend with mocked 503/recovery API
responses and installed Chrome through Playwright. They cover German/dark and
English/light at 320, 390, 430, 768 and 1280 px plus a short landscape viewport,
checking keyboard retry, retained credentials, no session-expiry event and no
horizontal overflow. Screenshots under `scratch/outbound-browser/` include the
long German error on a 320 px phone. These are emulated viewports, not physical
iOS Safari/Android Chrome or authenticated ILIAS validation.

Transport and retry semantics follow the official
[HTTPX transport interface](https://www.python-httpx.org/advanced/transports/),
[HTTPX async streaming lifecycle](https://www.python-httpx.org/async/), and
[HTTP Retry-After specification](https://www.rfc-editor.org/rfc/rfc9110.html#name-retry-after).

## Remaining public-hosting work

Before a broad rollout, agree an aggregate traffic budget with university ILIAS
support and validate it on the intended VPS. Add production domain/extension
permissions, same-origin HTTPS, persistent data mounts, tested backup/restore,
deployment smoke checks and separate administrator authentication/monitoring.
Also audit every user-controlled fetch target and redirect for SSRF and cookie
forwarding: the general material download/PDF routes accept URLs, while some
newer membership/player flows already perform origin checks. Traffic budgets
bound request volume; they do not authorize arbitrary egress targets.

For the missing course-management write adapters, capture sanitized native forms
and confirmation/results for exercise-container creation, weblink/item-group
creation, title/description edits and destination-picker/move/copy/reference
operations. Existing folder/file creation and management fixtures do not prove
those additional protocols. Keep those TODOs open until their native forms and
read-back behaviour can be tested.
