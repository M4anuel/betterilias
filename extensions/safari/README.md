# BetterIlias Companion for Safari 1.1.0

An independently authored Safari Web Extension for macOS and iPhone/iPad,
requiring Safari/iOS 16.4 or later. The implementation uses Safari background
scripts with `persistent: false`, not a generated Chrome service worker.

See [the analysis](../../docs/SAFARI_REBUILD_ANALYSIS.md) for existing companion
behaviour, the previous prototype's coupling and what Apple's empty errors do
and do not establish. Only translations and existing brand artwork are shared.

## Create the Apple upload

From the repository root, use a fresh output directory:

```powershell
node scripts/sync-extension-locales.mjs
python scripts/package_companions.py --browser safari --app-origin https://betterilias.ch --output scratch/safari-1.1.0-upload
python scripts/validate_safari_package.py scratch/safari-1.1.0-upload/betterilias-safari.zip
```

Upload `betterilias-safari.zip` through App Store Connect > Users and Access >
Xcode Cloud > Safari Web Extension Packager. Use the ZIP itself, not the containing
output directory, a Chrome/Firefox ZIP or the validation report. Keep the existing
`ch.betterilias.companion` app record/bundle ID. Version 1.1.0 distinguishes this
independent build from the 1.0.1 prototype. Apple assigns the native build number.

The ZIP includes only Safari resources, with `manifest.json` at its root. A
separate `betterilias-safari.validation.json` records the artifact's SHA-256 and
local checks. Neither output proves Apple's packaging/signing has succeeded.

For another BetterIlias installation, change `--app-origin` and build a separate
package. Its configuration and permissions will target that exact HTTPS origin.
Host addresses cannot be changed in the popup without matching host permissions.
The source defaults already target betterilias.ch; no localhost substitution is
needed for the standard package.

## Enable and use

1. Enable the extension in Safari settings.
2. Allow website access to `ilias.unibe.ch` and the configured BetterIlias host.
3. Sign in to ILIAS normally, then choose **Sync now** in the popup.
4. Choose **Open BetterIlias**. A newly verified, single-use handoff connects it.

**Sync now** also reconnects already-open app tabs. If a tab predates installation
and has no content receiver, this explicit action uses a new handoff and reloads
that tab. Automatic checks and Open BetterIlias do not force-reload editor tabs.

Automatic mode checks relevant tab activity and page loads. Optional alarms are
best effort; Safari may suspend background execution. Manual sync always remains
available. The popup provides permission instructions and separate retry feedback.
German/English, dark/light mode, touch targets and Dynamic Type are supported.

## Development and release acceptance

Edit Safari files directly. `scripts/sync-extension-locales.mjs` regenerates only
translation resources; it never copies Chrome/Firefox executable code to Safari.
All network/cookie work belongs to `core.js` in the background page. The popup
only sends a restricted command protocol; content scripts cannot force operations
or choose backend addresses.

Before public release, test Apple's generated app through TestFlight on a Mac
and an iPhone/iPad. Check granting/denying access, login, expired/offline sessions,
manual and automatic sync, account changes, already-open app tabs, one-use app
navigation and background suspension/resume. Local mocked APIs and Playwright
WebKit do not replace native Safari testing.
