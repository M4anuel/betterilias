# Connection Feedback & Network Error Recovery

BetterIlias provides non-intrusive, persistent connection feedback and localized recovery actions for network dropouts, expired sessions, and upstream ILIAS unavailability. It preserves cached data and user form drafts while preventing accidental replay of destructive mutations.

---

## 1. Capabilities & Error Classification

| Error Type | Visual Indicator | Recovery Action | State & Data Guarantees |
| :--- | :--- | :--- | :--- |
| **Unconnected / Signed Out** | Quiet connection card with **Connect ILIAS** action. | Directs to browser companion pairing or sign-in on landing page. | Cached courses and read-only views remain accessible. |
| **Session Expired** | Session warning card in reserved banner area. | Reconnect ILIAS action prompts companion cookie sync. | Unsaved drafts in active editors are preserved; never destroyed. |
| **Offline / Network Drop** | Non-intrusive offline notice. | **Retry Connection** probes reachability. | Cached pages remain viewable; failed writes are never blindly re-executed. |
| **Upstream 5xx / Maintenance** | Service unavailable notice with status badge. | Retry checks reachability without reloading the browser document. | Distinguishes ILIAS server crashes from session expiration (prevents false logout). |
| **Permission Denied (403)** | Contextual error banner inside current view. | Advises user of missing ILIAS role or closed course. | Does not invalidate the user's overall authenticated session. |
| **Rate Limited (429)** | Rate-limiting cooldown notice. | Shows remaining backoff time before auto-retrying. | Suspends background polling to prevent exacerbating rate limits. |

---

## 2. Recovery Workflows (How-To)

### 2.1 The Global `ConnectionNotice` Component
- Positioned in a reserved layout space outside the scrollable content area, ensuring it never obscures primary actions or input fields on mobile or desktop viewports.
- Uses a polite ARIA live region (`aria-live="polite"`) adhering to [WCAG 2.1 Status Message Guidelines](https://www.w3.org/WAI/WCAG21/Understanding/status-messages) so screen readers announce changes without stealing focus.
- When connection drops, clicking **Retry**:
  1. Issues a lightweight probe to the health/reachability endpoint.
  2. If reachable, prompts mounted view components to softly re-fetch their data.
  3. Avoids hard browser reloads (`window.location.reload()`), preserving in-memory component state.

### 2.2 In-Dialog `ErrorNotice` Component
- Handles local failures within modals and overlay dialogs (e.g. feedback return, work distribution, folder creation) where the global workspace banner sits behind the modal backdrop.
- Provides immediate retry or clear error messaging scoped to the active dialog without dismissing the modal or discarding user inputs.

---

## 3. Architecture & Technical Constraints (Explanation)

### 3.1 Network Failure vs. Request Cancellation
In `frontend/src/lib/api.ts` (`sessionFetch`):
- Read operations enforce a 25-second timeout for initial response headers.
- Streamed downloads (e.g. video streams, submission export ZIPs) are not cut off by the header timeout.
- User-initiated aborts (`AbortController`) are strictly differentiated from network failures; cancelling a download or closing a preview does not trigger an "Offline" notice.

### 3.2 URL-Scoped Outage Tracking
- Failed requests are indexed by URL and operation. A successful background request (e.g. checking notifications) cannot prematurely clear an outage banner for an endpoint that is still failing.
- Failed mutating writes (POST/PUT/DELETE) are never automatically replayed; only read probes are issued to verify server health before asking the user to re-confirm.

### 3.3 Upstream Error Isolation (Rule F09)
When ILIAS returns an HTTP 500, 502, or 504 error, BetterIlias treats it as upstream service unavailability. It does **not** interpret 5xx responses as a lost session, preventing users from being erroneously kicked to the login screen during transient ILIAS hiccups.

---

## 4. Source Code & References

- **Global Banner**: [`frontend/src/components/ConnectionNotice.tsx`](../frontend/src/components/ConnectionNotice.tsx)
- **Dialog Error Notice**: [`frontend/src/components/ErrorNotice.tsx`](../frontend/src/components/ErrorNotice.tsx)
- **Network Client**: [`frontend/src/lib/api.ts`](../frontend/src/lib/api.ts) (`sessionFetch`)
- **Automated Tests**: [`tests/test_connection_feedback_browser.py`](../tests/test_connection_feedback_browser.py) (Chromium browser test suite verifying 401s, 5xx handling, network timeouts, screen-reader polite announcements, and responsive layouts across 320–1280 px).

---

## Appendix: Retained Historical Notes

*(Preserves initial prompt and review findings from early development.)*
- Original goal: Replace the intrusive yellow session banner with quiet, reserved-space feedback that does not obscure mobile controls or steal keyboard focus.
