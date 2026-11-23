# 1.5.0 — Native UniSport registration and cancellation

- Manage registration from offer details and cancel from personal registrations,
  using the native UniApp API after independent SWITCH login/affiliation selection.
- Review fresh offer conditions before registering. Complete text, multiline,
  choice, dependent, date and file questions in BetterIlias. File answers use the
  native app's base64 format, bounded to 1 MB per file and a 1.5 MB answer envelope.
- Show the provider's cancellation confirmation before the separate confirmation
  request. Verify final account state and retain provider status text, including
  waiting-list information, without promising a confirmed place.
- Persist account/occurrence-owned dispatch receipts before writes. Duplicate
  clicks, concurrent requests, lost responses and worker restarts never trigger
  automatic POST retries. Status checking only reads account data.
- Preserve drafts across dialog closing/resizing, use the shared native dialog
  and loading buttons, and support German/English, light/dark and mobile layouts.
- Keep catalogue/sport caches. Booking checks bypass public caches; private tab
  caches are invalidated after dispatch. Refresh personal registrations explicitly
  so an open cancellation dialog remains mounted.
- A participant-list API was not found in the inspected UniBE Mobile 3.4.0 code.
  The official offer page remains available. Unsupported forms and unfinished
  expired provider steps require the official site or UniBE Mobile.

Validation uses synthetic provider responses, Chromium emulation and the real
ILIAS dump fixtures. No live booking/cancellation, physical iOS Safari or Android
Chrome validation is claimed. See `UNISPORT_INTEGRATION.md` for protocol evidence
and operational boundaries. The immutable `v1.5.0` tag identifies the release commit.

Checks: full repository suite 807 passed / 990 optional tests skipped; final
targeted backend plus real-dump checks 100 passed / 14 unavailable dumps skipped;
49 booking browser scenarios and 53 existing UniSport UI/catalogue scenarios
passed. Frontend production build, locale catalogue checks and launcher syntax
passed. Browser coverage uses Chromium emulation with reviewed screenshots.
