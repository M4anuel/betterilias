# 1.7.1 — Complete the website identity login before reading participant lists

- Expose the official ZSSW/SWITCH website login as a step after native API
  affiliation selection. These services use separate OIDC and SAML sessions;
  saving an API affiliation cannot create the website's authenticated session.
- When a participant list needs login, open its actual protected route in a
  Companion-managed tab. Let the user choose an identity on SWITCH and resume
  the list read on return to the exact ZSSW route. Keep the dialog open and its
  native close control available throughout the external login.
- Track the login tab across worker restarts, report cancellation, discard
  expired/closed-owner transactions, scope completion to the initiating account
  and affiliation, and invalidate cached participant rows before retrying.
- Chrome and Firefox Companion 1.2.1 have matching behavior and require no new
  permissions. Reload the extension and BetterIlias. Credentials and identity
  selection remain on the official provider; no SWITCH login form is scraped.

Browser validation uses isolated synthetic accounts and emulated viewports;
live SWITCH accounts and physical mobile devices are not used by these checks.
Local checks passed: 824 backend tests (1048 opt-in skips), 59 participant/login
and connection UI checks, nine actual Chrome/Firefox bridge checks, 57 Node
checks, localisation, frontend production build and launcher syntax.
