# Connection feedback

## Refined implementation prompt

Audit the repository, memberships, calendar, semester, course, exercise and related
dialogs for authentication, connectivity and general loading errors. Classify
shared failures at the API boundary and give them consistent, localised recovery
actions. Distinguish an unconnected session, an expired session, offline access,
an unavailable service, insufficient permission, missing content and rate limits.
Keep cached content and unsaved inputs available; never replay a failed write.

Replace the yellow session banner with quiet, persistent feedback. Reserve space
for it so it cannot obscure actions, including on short phone screens. Use a
normal onboarding action on the signed-out landing page and collapse its sidebar
by default while allowing users to expand it. Install the Chrome companion from
the supplied Web Store listing; retain Firefox instructions and explain phone
pairing. Support keyboard access, screen-reader announcements, safe areas,
German/English and light/dark mode. Verify actual recovery interactions and
visually inspect phone, tablet, desktop and short-landscape screenshots.

## Implementation

`sessionFetch` classifies common read failures and bounds the wait for read-response
headers to 25 seconds, without cutting off streamed downloads afterwards.
Caller cancellation stays separate from network failure. Writes retain their
operation-specific and uncertain-outcome messages. Diagnostic submissions do not
count as evidence of an authenticated ILIAS session.

`ConnectionNotice` owns persistent session/service recovery outside page scroll
content. It uses a stable polite live region without moving focus. Its card
reserves layout space instead of covering page controls; phone text and actions
stack. Signing out on the landing page uses its primary Connect ILIAS action.
No extension-presence detection is inferred from missing cookies.

Failed requests are tracked by URL, so a successful unrelated request cannot
erase an outage. Retry probes failed reads, checks reachability for failed writes
without replaying them, then asks mounted views to refresh their data. It does
not reload the document. `ErrorNotice` handles local failures and provides
connection recovery inside dialogs, where the workspace notice is behind the
modal. Field validation and action-specific destructive/uncertain-write dialogs
retain their existing semantics. The separate administrator authentication and
render-exception boundary are not ILIAS connection states.

The status announcement follows [WCAG status-message guidance](https://www.w3.org/WAI/WCAG21/Understanding/status-messages).

## Verification

`tests/test_connection_feedback_browser.py` exercises four destinations with
401s; network, gateway and general-server failure recovery; search preservation;
the Chrome store action; modal dismissal/focus restoration; and signed-out
landing navigation. Its screenshots cover 320, 390, 430, 768 and 1280 px plus
844 x 390 landscape in both languages and themes. These checks use installed
Chrome through Playwright with mocked API responses. They do not establish live
ILIAS or physical iOS Safari/Android Chrome acceptance. Existing page-sync,
sidebar/history and mobile regressions cover related navigation and loading.

Validation for this change: 635 automated tests; 31 connection scenarios, 53
page-sync/history checks, 8 mobile workflows, 5 TA editor workflows and 51 player
scenarios passed. The frontend build, locale validation, six localisation tests
and launcher syntax check also passed. Browser screenshot runs used a fresh
scratch working directory because existing `.pytest_cache` artifacts were not
writable. Outdated drawer/recording geometry assertions were aligned with the
existing full-screen navigation and compact recording action rows.
