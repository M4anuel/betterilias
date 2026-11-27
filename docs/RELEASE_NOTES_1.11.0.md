# 1.11.0 — Stable Companion status and complete logout

Companion **1.6.0** keeps the warning and existing login card visible while a
retry is pending or fails. Only a validated backend status clears the warning.
Rejected login/affiliation requests are reported as operation errors rather than
network outages. The retry action stays on the right with centred text. Explicit
popup/body bounds and shrinkable controls prevent Firefox from widening after
affiliation controls become visible.

New connections prefer an available `unibe.ch` affiliation; an existing saved or
edited choice is preserved. The login action is labelled simply Log in. The
domain explanation is removed. Named-usage disclosure moves from the popup into
the app privacy/data-usage dialog. Cookie mode shows automatic-sync information
below its sync action instead of repeating its status underneath the pill.

## Logout

Both popup modes and the app logout now end the paired BetterIlias/ILIAS
connection and the shared UniBE connection, clear ILIAS/browser app auth cookies
when the Companion is available, cancel pending provider callbacks and pause
automatic restoration. Logout clears private ILIAS/UniSport content and rejects
stale responses/session-sync messages. A new explicit login or valid handoff
re-enables the selected connection. Background startup cannot bypass the pause.

New clients opt into native logout using `POST /api/auth/logout` with the explicit
tenant credential and `X-ILIAS-Logout: 1`. The server reads the current authenticated
account menu and validates its same-origin `doLogout` link, including its fresh
`rtoken`. It sends that logout command once, within a 10-second total bound,
without following logout/SSO redirects or retrying the mutation. Local credentials are revoked even if
the upstream logout cannot be confirmed; the response and UI report that partial
outcome. Requests without the opt-in retain the existing local-only behaviour.
Other tenant capabilities are not selected or cleared by the backend endpoint.

The Companion removes only ILIAS auth cookies and the configured instance's
`betterilias_session` cookies. It does **not** perform global SWITCH SSO logout or
log out unrelated university services. Offline logout pauses local reconnection
before its network work, reports errors and retains only what is needed to retry
revocation; it does not claim that an unreachable remote session was revoked.

Validation includes failed/held/successful retries, default affiliation and draft
preservation, rejection-versus-outage handling, paired logout and stale-sync
rejection, app logout for both auth sources, and the privacy dialog at phone,
tablet, desktop and short landscape widths. Installed Chromium and native
headless Firefox use a synthetic provider. Firefox checks measure the *open*
toolbar panel before and after status resolution, including the outer panel.
These are emulated/headless desktop checks, not physical devices or live SWITCH
acceptance. Update both the application and Companion and refresh existing tabs.
