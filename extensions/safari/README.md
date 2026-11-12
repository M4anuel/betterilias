# BetterIlias Companion for Safari

Manifest V3 web extension for Apple's Safari Web Extension Packager, targeting
Safari on macOS, iPhone and iPad. Native Apple-device acceptance and App Store
review remain pending; the automated checks use simulated APIs and Chromium.

## Synchronisation

- Automatic checks when an ILIAS or configured BetterIlias tab finishes loading,
  becomes active, the extension/browser starts, or a five-minute alarm fires.
- Safari has no `cookies.onChanged`; this port does not depend on that event.
- The five-minute interval is best effort. Safari, especially iOS/iPadOS, can
  suspend background work. Open the popup and use **Sync session with BetterIlias**
  if automatic checks have not run. Opening the popup also checks the session.
- Grant Safari website access to both `ilias.unibe.ch` and your BetterIlias host.
  Without cookie/site permission, manual sync also needs permission granted first.
- Only backend-verified credentials are saved. Network errors retain the last
  credential for retry. The page bridge and one-use connection codes match the
  Chrome/Firefox flow; long-lived credentials never enter navigation URLs.
- Automatic checks respect `autoSyncEnabled: false`; the popup's manual action
  remains available. No website can send cookies or backend URLs in sync messages.

Cooldowns and bounded leases are persisted across worker restarts. Web Locks
serialize overlapping tab/alarm checks when available. Sessions are verified again
after five minutes or after the authentication cookie signature changes. Unrelated
tabs do not trigger checks; session messages go only to the configured app origin.

## Build the production upload ZIP

From the repository root:

```powershell
node scripts/sync-extension-locales.mjs
python scripts/package_companions.py --app-origin https://betterilias.ch --output scratch/safari-release
```

Use `scratch/safari-release/betterilias-safari.zip`. Choose a fresh output directory
for each build; the packager refuses to overwrite existing files. The ZIP contains
`manifest.json` at its root, all scripts/icons/locales, and exact production host
permissions. Development localhost permissions and defaults are replaced. The raw
source folder is for development and must be packaged before a production upload.

Safari's popup, transport, page bridge and artwork are generated from Chrome by
`scripts/sync-safari-companion.mjs`; edit the shared Chrome sources, then regenerate.
The Safari-specific background script remains independent. The regular frontend
build regenerates these files and all three browsers' shared translations.

## Apple packaging and publication

1. Enrol in the Apple Developer Program and create an App Store Connect app record
   for macOS, iOS, or both (for example bundle ID `ch.betterilias.companion`).
2. In **Users and Access → Xcode Cloud → Safari Web Extension Packager**, upload
   the production ZIP and review Apple's compatibility/build reports.
3. Use TestFlight for native macOS/iPhone/iPad testing. Enable the extension and
   allow both websites in Safari's extension settings.
4. Add the app icon, screenshots, descriptions, support/privacy URLs and privacy
   disclosures requested by App Store Connect, select the build, and submit it.
   The existing 128 px extension icon does not replace Apple's app-icon assets.

The browser-based packager works from Windows; it does not require local Xcode.
No Apple account changes, upload, signing or submission are performed by this repo.

Apple documentation:
- [Packaging with App Store Connect](https://developer.apple.com/documentation/safariservices/packaging-and-distributing-safari-web-extensions-with-app-store-connect)
- [Browser compatibility](https://developer.apple.com/documentation/safariservices/assessing-your-safari-web-extension-s-browser-compatibility)

## Native acceptance before public release

On a Mac and iPhone/iPad, exercise ILIAS login → tab load/activation → automatic
sync → open BetterIlias, manual sync, already-open app updates, an expired session,
missing website access, disabled automatic checks, offline retry, and Safari
suspension/resume. Check German/English and light/dark popup rendering and toolbar
feedback. Do not infer successful native execution from conversion or Chromium.
