# 1.6.0 — Direct UniSport participant-list access

- Open the official **Anmeldeliste / Participant list** beside existing
  registrations, after a verified signup, and before cancelling an owned offer.
  Hide the link after confirmed cancellation and on cancelled personal-list rows.
- Derive the website course ID from recognized ZSSW offer URLs. Native UniApp
  offer 28028 maps to website course 3003; the IDs are not interchangeable.
- Reuse the already loaded public catalogue for personal-list links. Existing
  caches keep working, with no extra catalogue/per-card requests and no caching
  of participant names. Unknown website mappings omit the link safely.
- Open the official list in a new tab with an accessible announcement and a
  visible login/access hint, in German/English and light/dark on phones/tablets
  and desktop. The site manages its own SWITCH/ZSSW browser session and access
  checks. BetterIlias does not forward API credentials or render participant rows.

The supplied saved page confirms the URL/table structure. An anonymous live GET
redirected to SWITCH; no authenticated participant-list read or real booking was
performed. Browser tests use synthetic names and Chromium emulation. The
immutable `v1.6.0` tag identifies the release commit.

Verification: 47 backend/real-dump checks passed (14 unavailable dump checks
skipped), 27 participant-navigation browser checks and 54 existing UniSport
UI/catalogue/cancellation checks passed. Production build, locale checks and
launcher syntax passed. Screenshots were reviewed at phone, tablet, desktop and
short-landscape sizes in both languages/themes; a positioned anchor keeps its
screen-reader announcement inside the scrolling view without blank page overflow.
