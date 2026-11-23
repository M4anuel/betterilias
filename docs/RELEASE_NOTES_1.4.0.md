# BetterIlias 1.4.0

- Browse public UniSport offers without SWITCH login, filter locally by text and
  sport type, and view offer details, availability and registration-window times.
- Cache the entire catalogue and derived sport types for 15 minutes, details for
  five minutes. Public snapshots persist in the shared server cache and browser
  IndexedDB; returning to UniSport, filtering and opening fresh cached details
  avoid repeat upstream requests.
- Retain complete previous snapshots when refresh fails, show timestamps/stale
  feedback and provide explicit refresh. Detail caches are bounded to 128 entries.
- View existing bookmarks after selecting an affiliation. Private caches live
  in tab storage for one minute, scoped to login generation, affiliation and
  language. Private reads reject account changes/disconnects during requests.
- Keep public upstream calls free of account credentials/cookies; render detail
  HTML as plain text and allow only HTTPS university links.

No booking, bookmark editing or automatic registration is introduced. The
existing opt-in flag and Companion 1.1.0 login remain unchanged.

Validation includes mocked client/cache/API tests, responsive German/English
light/dark Chromium interactions and IndexedDB reload checks. An unauthenticated
live snapshot contained 923 offers and 133 sport types; personal account calls
remain mocked in automated checks. See [integration notes](UNISPORT_INTEGRATION.md).
The immutable `v1.4.0` tag identifies the tested release commit; the push summary
records its exact ID.
