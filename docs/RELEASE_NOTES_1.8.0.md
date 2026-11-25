# 1.8.0 — Connect ILIAS from the existing UniBE login

After connecting UniSport and saving an affiliation, **Connect ILIAS with this
login** exchanges the server-held UniBE ID token through ILIAS's mobile-auth
entry point. The server verifies the personal dashboard with the resulting
cookie jar before creating a fresh BetterIlias ILIAS capability.

The token is confined to the fixed UniBE mobile-auth entry/alias. Verification
uses cookies only, has bounded responses/timeouts and does not retry login.
Anonymous/error pages, external redirects and changed/revoked UniSport
connections fail without replacing any saved ILIAS credentials. A configured
custom ILIAS origin cannot receive the UniBE token.

The frontend asks before switching an existing ILIAS connection, preserves it
on failure, ignores late replies after account changes, and reuses the existing
session activation/cache-clearing flow on success. Initial SWITCH login still
uses the Companion; ZSSW's website identity login also remains separate.

This is an opt-in prototype under `UNISPORT_ENABLED=true`. The inspected Android
app and anonymous/invalid-token endpoint probes establish protocol evidence;
synthetic tests do not establish successful live personal-account acceptance.
After updating, open UniSport, save your affiliation and choose the new action.
Reload Companion 1.3.0 and BetterIlias before testing: it preserves the explicitly
selected token connection across reloads and automatic cookie-sync notifications.
Manual Companion sync or a successfully claimed handoff selects browser sync
again. No new extension permissions are requested.

Local validation: 844 backend tests passed (1085 opt-in browser checks skipped),
64 UniSport connection/UI checks passed, 59 Node checks passed, and nine actual
Chrome/Firefox bridge checks passed with isolated synthetic profiles. Locales,
frontend production build, launcher syntax and production container smoke checks
passed. Responsive screenshots use desktop-browser emulation, not real phones.
