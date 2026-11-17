# Community Feature Requests

BetterIlias features a public, lightweight community feature request board where students and developers can suggest enhancements, vote on ideas, discuss improvements, and track implementation statuses.

---

## 1. Capabilities & Feature Matrix

| Capability | What BetterIlias Does | Privacy & Abuse Guarantee |
| :--- | :--- | :--- |
| **Public Board Access** | Available at `/?view=feature-requests` without requiring an ILIAS session or account creation. | Anyone can view suggestions and participate freely. |
| **Voting & Feedback** | Upvote and downvote requests; post plain-text chronological comments. | Browser-bound HttpOnly cookies ensure votes are idempotent without tracking personal user identities. |
| **Image Attachments** | Attach up to 5 screenshots/images per request (JPEG, PNG, WebP $\le$ 8 MB). | Images are converted to optimized WebP variants (max 640/1280/2560px) and stripped of all EXIF metadata. |
| **Author Ownership** | Authors can edit or delete their own posts from the browser that created them. | Secured via random cryptographic cookie hashes stored in SQLite. |
| **Lifecycle Management** | Requests track statuses: `open`, `planned`, `in_progress`, `completed`, `declined`. | Maintainers moderate and update statuses via the `/admin/` dashboard. |
| **Storage & Eviction Cap** | 10 GB total media storage cap with automatic LRU image pruning for completed requests. | Evicts images of requests completed $\ge$ 30 days ago first; text, comments, and votes are never deleted. |

---

## 2. Browser Ownership and Identity (How-To)

Requests have plain-text titles/descriptions, one of three categories, optional
images, up/down votes and flat chronological plain-text comments. Browser owners
can edit/delete their posts. The existing `/admin/` dashboard provides editing,
deletion and the open/planned/in-progress/completed/declined status workflow.
Admin authentication remains separate from student and community identities.

## Managing requests

Sign in at `/admin/` with the existing `ADMIN_API_KEY` (at least 43 characters),
then select **Manage requests** to jump to the board. The public board's info
disclosure also links to `/admin/#feature-requests`; this link grants no access.
Open a request and use its **Status** dropdown. Each selection saves immediately,
with success/error feedback; failed writes keep the previous status. Available
statuses are open, planned, in progress, completed and declined. Requests can be
reopened by selecting open. The same admin session permits editing/deletion and
comment moderation; public visitors cannot change status.

Public and administrator views show status as a prominent badge above each card
title and in the request detail header. Each status has visible translated text,
a distinct icon and matching light/dark colours; colour is not the only indicator.

This is a temporary shared-key model, not an individual account or role system.
It grants full dashboard access, without separate moderator permissions or
per-person attribution. Individual sign-in, recovery/revocation and server-enforced
administrator/moderator roles are tracked in `TODO.md`. Never put the key in the
public board, frontend configuration or URLs; the existing dashboard exchanges
it for a short-lived HttpOnly session cookie.

The public-content/cookie notice is available from the info control beside the
board title, including by touch and keyboard. Search and filters share one row
when the board has enough width. Narrow layouts keep search and a Filters button
in one row and reveal full-width selectors on demand, retaining selections when
resizing or rotating.

## Browser ownership

The server issues a random, HttpOnly, SameSite Strict cookie, Secure in
production, scoped to `/api/feature-requests` and lasting up to a year. Only its
hash is stored with content and votes. One database row per identity/request
prevents repeated vote requests inflating totals; setting a vote is idempotent.
Removing the cookie loses editing access and enables another vote. This is
deliberately modest abuse protection; follow-up work is recorded in TODO.md.

Nicknames are optional, stored locally for subsequent posts, and are not verified.
Content and attached images are public. Upload guidance asks authors to remove
personal information from screenshots. Community writes require a custom header
and never attach an ILIAS session header or depend on an ILIAS login.

## Persistent storage and deployment

`FEATURE_REQUESTS_DIR` defaults to `.feature_requests` below the project root.
Docker Compose sets it to `/data/.feature_requests` on the existing `app_data`
volume. It contains `board.sqlite3` (plus SQLite WAL files) and `media/`.
Back up the database and media together with the services stopped, or use a
consistent volume snapshot. Do not copy only the main SQLite file while running.
Existing installations gain the empty board automatically on first use.

`FEATURE_IMAGES_MAX_BYTES` defaults to **10,000,000,000 bytes (10 GB)** and counts
every stored WebP variant, including unpublished draft uploads. The database,
coordination locks and database backups are separate from this image cap.
No external object-storage service is needed. All replicas must share one local
VPS volume and coordination directory; independent VPSs/NFS are unsupported.

Images accept static JPEG/PNG/WebP, at most 8 MB and 25 megapixels per image,
with at most five images attached to a request. They are re-decoded, oriented,
stripped of metadata and encoded as WebP at quality 85. Responsive variants have
long edges up to 640, 1280 and 2560 pixels, without upscaling. Originals are not
retained. One shared intake/processing lock bounds concurrent image buffers and
encoding work; image mutations use a shared lock plus SQLite transactions.

When an upload needs space, attachments of requests completed at least 30 days
ago are removed first, oldest completion first. Text, votes and comments remain,
with a visible image-removal notice. Active/declined request images are never
automatically evicted. If space remains insufficient, the upload returns 507;
the author can remove selected images and submit text only. Completed requests
must be reopened by an administrator before adding new images.

Draft uploads expire after 24 hours. The existing hourly maintenance service
removes expired draft files and reconciles orphan files left by interrupted
writes. Reconciliation also runs before admitting new images. Media bytes are
accounted before publication under the shared lock, so concurrent uploads cannot
exceed the cap. Failed/deleted media is removed without retaining originals.

Public media supports GET/HEAD and ETag conditional requests with a one-hour
cache lifetime. Caddy's media handler preserves these cache headers; all other
API responses retain `no-store`. Deleted images may remain in an existing
browser cache until its lifetime ends. No credentials are included in media URLs.

## Validation

Backend tests cover cookie ownership, independent voters, concurrent vote writes,
comment moderation, upload decoding, variants/cache responses, image ownership,
quota concurrency, the 30-day boundary and maintenance/persistence. Browser
regressions exercise request/reply drafts, resizing, votes, editing and upload
failure/retry in Chrome emulation at phone, tablet, desktop and short landscape
sizes, in German/English and light/dark mode. These checks do not establish
physical iOS/Android or live production validation.

The compact-controls regressions also check info disclosure with Enter/Escape,
close-button focus restoration and outside dismissal; single-row controls before
and after resizing; filter query values and retained selections. Administrator
checks cover every status, failed-save recovery and the built dashboard's
key-login → Manage requests → status-save path. Backend tests verify public
denial and status persistence using the existing admin login cookie.
Status-badge checks cover all five labels, list/detail placement and updates after
moderation, with at least 4.5:1 text contrast in each language/theme combination
at the same phone, tablet, desktop and short-landscape emulation sizes.
