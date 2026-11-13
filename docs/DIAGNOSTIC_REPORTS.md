# Consented Diagnostic Reports

BetterIlias provides an opt-in, privacy-preserving error reporting system for unexpected ILIAS connectivity and HTML parser failures. It allows students to submit sanitized technical reports without exposing course materials, grades, or personal student data.

---

## 1. Capabilities & Feature Matrix

| Capability | What BetterIlias Does | Privacy & Security Guarantee |
| :--- | :--- | :--- |
| **User Consent Controls** | Tri-state consent model: **No** (default), **Yes, once**, or **Yes, always** (configurable in Settings). | No diagnostic report is ever transmitted without explicit student consent. Close/Escape defaults to No. |
| **Text-Free HTML Outlines** | Captures parser error structures as stripped structural skeletons. | Text nodes, user inputs, URLs, student names, lecturer files, scripts, and sensitive attributes are completely discarded. |
| **Strict Data Sanitization** | Capped at 1,000 DOM elements / 20,000 characters from max 262,144 raw source characters. | Retains only an allowlist of standard HTML tags, form field names, and structural layout classes. |
| **Private SQLite Storage** | Reports are stored in an isolated, encrypted-at-rest SQLite database (`reports.sqlite3`). | Never exposed publicly. Excluded from static assets and routine exports. Staged captures expire after 10 minutes. |
| **Admin Review Dashboard** | Accessible via `/admin/` for authenticated maintainers to inspect, group, and resolve errors. | Error reports are aggregated by error code and parser context, supporting status tracking (`open`, `resolved`, `reopened`). |

---

## 2. Consent and Evidence Lifecycle (How-To)

## Where reports live

The application already uses SQLite for private log events, admin sessions,
outbound coordination and handoffs. This feature adds a separate private database:

```text
DIAGNOSTIC_REPORTS_DIR/reports.sqlite3
```

The default directory is `.diagnostic_reports/`, excluded from Git. It is not a
temporary JSON workaround. SQLite transactions support multiple workers sharing
one trusted local VPS volume, as with existing coordination. Independent VPSs
and NFS remain unsupported. Student sessions still use their isolated
`.sessions/<session_id>.json` files; admin capabilities remain separate. This
feature does not replace either authentication system or create stable accounts.

Logical tables are `reports`, `captures`, `preferences`, and `meta` (a private
random HMAC key). They are not publicly served. POSIX permissions are 0700 for
the directory and 0600 for the database; configure equivalent Windows ACLs.
Keep the volume private/encrypted and exclude it from routine backups, exports,
static serving and automatic agent context ingestion.

## Consent and evidence flow

1. A validated tenant's eligible failure creates a request-scoped evidence bag.
   Parser failures can contribute a **text-free structural outline**, capped at
   1,000 elements/20,000 characters from at most 262,144 source characters.
2. The outline consists only of known tag names, bounded indentation, allowlisted
   input types/roles/field names and a small exact CSS-class allowlist. Unknown
   names/classes/IDs, every text node, values, URLs and script/style/template/
   SVG/math content are discarded. Exception messages and stack/local variables
   are never captured. Parser contexts must come from registered code-defined
   `@safe_parser` names; arbitrary dump contexts become `unspecified`.
3. In **ask** mode, a private candidate is staged for at most **10 minutes**. It
   is not exposed through admin reports or the maintainer CLI. The response
   carries a random capture token in headers; only its digest is stored. Claiming
   or declining it also requires the owning tenant's explicit credential.
4. The UI retrieves the current operator notice before offering the choice. No
   choice is preselected as acceptance. Close/Escape means No. The consent
   buttons and close control remain visible while the notice scrolls, including
   short phone viewports. Prompts are deduplicated per error code for one minute
   and the in-memory queue holds at most three captures. Original actions are
   never retried by reporting.
5. **Yes, once** transactionally creates one report. Repeating a request after a
   lost acknowledgement returns the same report ID, not a duplicate. The saved
   candidate is reduced to an idempotency receipt; its evidence is not duplicated.
   Declining removes the candidate. If a report was already saved before a lost
   acknowledgement, declining the same candidate also removes that report.
   It also cancels an Always grant from that prompt, preserving newer settings.
6. **Yes, always** also saves the connection-scoped preference. Future eligible
   failures are saved automatically with no modal. The user gets a dismissible
   confirmation. Settings can choose **Ask each time**, **Automatically share**,
   or **Do not share or ask**. Preferences last at most **90 days**, do not renew
   merely through reads/reporting, and require new consent if the report policy
   version changes. Switching connections clears the browser's pending queue.
7. Settings also offers a confirmed **Delete my shared reports** action, covering
   open/resolved reports and temporary captures for that connection. Preference
   changes affect future collection; deletion is separate and available even
   when new collection is disabled. Only the owning tenant's rows are removed.

The owner is an HMAC of the active capability, not the capability itself, a name,
an email or an ILIAS user ID. It exists to enforce ownership and withdrawal.
It is still pseudonymous personal data. This scope follows the existing tenant
connection, not a stable profile: replacing/revoking that credential loses its
preference and self-service report association. Operators must handle deletion
requests for lost connections through their documented support process. Do not
introduce a student-identity index just to make diagnostic data searchable.

## What a maintainer receives

The report includes a fixed error code/type, capture time, HTTP status, optional
random request ID and known parser context. Audited operations also provide a
fixed operation code and outcome; this helps distinguish a failed read from an
uncertain write. A reported partial write can be offered even when its API
returns HTTP 200. Consent policy version, sharing choice (`once`, `always` or
`automatic`) and save time form a minimal receipt. Older development-format rows
are labelled `legacy` by an additive schema migration rather than inventing
consent provenance.

No raw page, lecturer text, names, usernames, grades, submissions, comments,
filenames, URLs, authentication headers, cookie values, handoff codes, IPs or
browser error strings are copied. A structural outline is a debugging clue, not
a reproduction of the original page. It deliberately cannot reveal changed,
unapproved class/attribute values; a parser fix may still require a reviewed,
de-identified fixture or independent reproduction. Operation outcomes retain the
existing audit meaning: a service return is not proof of native persistence,
and uncertain writes must not be blindly retried.

Eligible server responses are HTTP 400/408/409 and 5xx with an established tenant,
plus explicitly reported incomplete audited operations. Expected validation,
login/permission/not-found responses (401/403/404/422), successes, cancellations,
admin APIs and the reporting service itself do not trigger generic prompts.
An unknown server exception produces a generic error with safe metadata, never
the raw exception. Request headers/bodies and URL values are never copied.

The shared frontend fetch helper and course-upload XHR consume the capture
headers. Render failures and failed browser/server connections can offer fixed
client-error metadata without a browser message/stack. Fully offline clients
cannot submit a candidate until connectivity is restored; there is no durable
browser retry queue. Native new-tab downloads/streams failing after headers and
errors outside these shared paths may have only the existing operational event.
This is not a guarantee of collecting every visible error.

## Retention and resource limits

Defaults are **30 days** and **1,000 reports**, including resolved reports, with a
**32 MiB database ceiling** and bounded rollback-journal space. Under storage
pressure older records are evicted, preferring resolved reports. Resolving or
reopening never extends the original expiry. There are at most 256 staged
captures/receipts and at most five recent capture/report entries per owner per
minute; saving a capture can count in both limits. These are best-effort bounds,
not a promise that every error gets a report. Storage failure must not replace
or replay the original user operation.

Expiry is applied on database access and by the existing retention command:

```text
python -m backend.diagnostics prune
```

Schedule it at least hourly under the backend OS account with the same paths,
including when the server is stopped. Physical deletion can lag expiry until
the next maintenance run; expired records are excluded by access-time pruning.
SQLite secure deletion is enabled, but it cannot erase filesystem snapshots,
SSD remnants, backups or downloaded copies. Apply separate deletion/access rules
to those copies. Opting out of reports does not disable the separately documented
routine operational logs or explicitly enabled **local development** raw captures.
Raw captures remain prohibited in production.

## Production notice setup

New collection is disabled in production unless both values are configured:

```text
DIAGNOSTIC_REPORT_OPERATOR_NAME=Your responsible operator/controller
DIAGNOSTIC_REPORT_PRIVACY_URL=https://your-host.example/privacy
```

The URL must be HTTPS without embedded credentials. It is intentionally public.
The prompt identifies the recipient and links to that notice; local development
may use a clearly labelled local operator. Configure retention using
`DIAGNOSTIC_REPORTS_RETENTION_DAYS` (1–30), `DIAGNOSTIC_REPORTS_MAX_COUNT` and
`DIAGNOSTIC_REPORTS_MAX_MB`. Material changes to the report format/purpose require
a new `POLICY` version and renewed consent, not reuse of older automatic consent.

The operator still needs the appropriate legal basis for transient technical
processing, a complete notice, controller/processor arrangements, rights handling
and an export/backup/incident policy. A user's consent cannot authorise disclosure
of other students' data. This design follows minimisation and makes withdrawal
accessible; it is not a whole-product GDPR/DSGVO compliance certification. See
[EDPB consent guidance](https://www.edpb.europa.eu/system/files/2026-04/edpb-summary-consent_en.pdf)
and [European Commission data-protection principles](https://commission.europa.eu/law/law-topic/data-protection/information-business-and-organisations/principles-gdpr_en).

## Maintainer navigation and archive

The `/admin/` dashboard includes **User-shared error reports**, with folder-like
groups for page parsing, ILIAS connection, blocked targets, concurrency,
application and browser failures. These are database views, not raw directories
or duplicate files. Filters distinguish open, resolved and all reports. Opening
a report shows its safe metadata/outline. **Mark resolved** moves it to the
temporary resolved archive; **Reopen report** reverses this. Revision checks stop
concurrent administrators from silently overwriting each other's state. User
deletion/expiry of an already-open report is reported as gone, without logging
the administrator out.

All reads require the existing separate administrator capability. Mutations
also require `X-Admin-Request: 1`; student credentials never grant admin access.
Generic report-created/deleted/preference/state-change events contain no owner,
capture token, evidence or other report contents. Admin downloads are explicit
JSON exports, not raw HTML viewing or automatic public publication.

For an authorised maintainer/agent working under the backend OS account:

```text
python -m backend.diagnostics reports --state open --kind parsing --limit 25
python -m backend.diagnostics reports --id <32-character-report-id>
python -m backend.diagnostics reports --state resolved
```

Inspection also applies expiry. Do not paste arbitrary production evidence into
issues, chat or AI services. Review the minimised outline, correlate a request ID
with retained operational events, locate the named parser, reproduce with a
de-identified fixture and add the relevant regression. Marking resolved is a
maintainer judgement, not an automatic claim that a code fix was verified. This
feature does not add indefinite bug-history retention or a free-text notes field.

## Verification

Backend regressions cover minimisation, owned capture claims, idempotency,
once/always/never, deletion, expiry/policy renewal, production disclosure, partial
writes, storage failure, concurrent consent and administrator state conflicts.
Browser regressions exercise actual rendered consent/settings/archive/download
actions with mocked failures across phone, tablet, desktop and short landscape,
both languages and both themes. Screenshots are reviewed for readability and
visible consent/close controls. These are Chromium emulation and offline tests,
not live ILIAS or physical iOS/Android validation.

Release checks on 5 November 2026: **585 backend tests passed, 373 skipped**;
**44 report/admin browser workflows passed**; production frontend build,
**1,974-key** locale validation and launcher syntax checks passed. Existing
dependency deprecations and the frontend bundle-size warning remain. The
screenshots under `scratch/diagnostic-report-review` include visible phone consent
actions, scrollable notice text, settings withdrawal and admin report navigation.
