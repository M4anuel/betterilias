# Safari Companion: analysis and independent rebuild

## What the existing companions do

| Behaviour | Chrome / Firefox | Independent Safari client |
| --- | --- | --- |
| Read ILIAS credentials | Selected PHP, Shibboleth and ILIAS cookies; Firefox also tries partition-aware queries | Safari cookies API, auth-name/domain filtering; no Firefox query arguments |
| Verify the login | `POST /api/auth/sync`; persist only authenticated server results | Same backend contract, with `source: safari_extension`; one background owner |
| Connect an open app | Page localStorage plus session notifications; Firefox uses Xray bridging | Safari isolated-world bridge, structured-clone page messages, exact app-origin/top-frame checks |
| Open the app | Request a single-use 60-second handoff | Verify current cookies, obtain a new handoff, then open a tab; never put a session ID in URLs |
| Automatic sync | Cookie-change events, startup and periodic alarms | Relevant tab navigation/activation, ILIAS/app page-ready messages, optional alarms and popup checks |
| Preferences | Configurable addresses, language and automatic mode | Language and automatic mode; server host is fixed by the package to match permissions |
| Manual recovery | Popup login, verification and reconnect actions | Independent touch-friendly Safari popup with access instructions, login, sync and open actions |

The backend contract and brand assets are reused. Executable code, popup layout,
message routing and lifecycle handling are authored specifically for Safari.
Chrome and Firefox executable sources are unchanged.

## Findings in the previous Safari prototype

The regular frontend/localisation build imported `sync-safari-companion.mjs`,
which copied Chrome's popup, content bridge, request helper, toolbar helper and
manifest over the Safari tree. Safari's independent background logic therefore
coexisted with a generated popup that performed its own network verification.
Those two writers did not share a single verification lifecycle. Editing Safari
resources was also unreliable because the next frontend build replaced them.

The raw source manifest/defaults targeted localhost, so uploading the source tree
instead of the production package omitted the real BetterIlias host permission.
That is a runtime configuration problem, not evidence of an archive/build failure.

Apple explicitly lists `cookies.onChanged` as unsupported in Safari. Apple also
requires nonpersistent background execution on iOS and documents a background
page with `scripts` and `persistent: false`. The new client uses that Safari
model, without worker imports, Chrome toolbar canvas code or Firefox shims.
See [Apple compatibility guidance](https://developer.apple.com/documentation/safariservices/assessing-your-safari-web-extension-s-browser-compatibility)
and [Safari lifecycle guidance](https://developer.apple.com/documentation/safariservices/optimizing-your-web-extension-for-safari).

WebKit's own manifest parser accepts background `scripts` and `persistent: false`
with Manifest V3; it rejects persistence set to true. This Safari declaration is
intentional, rather than applying Chrome's manifest restrictions to Safari. See
[WebKit's background manifest parser](https://github.com/WebKit/WebKit/blob/main/Source/WebKit/UIProcess/Extensions/WebExtension.cpp).

Safari 18.4 also changed extension-page CORS to honour per-site grants. Declaring
a host in the manifest alone does not replace the user's website permission.
The popup requests access within a user gesture, and the background checks the
grants before reading cookies or contacting the backend. See
[Apple's Safari 18.4 release notes](https://developer.apple.com/documentation/safari-release-notes/safari-18_4-release-notes).

## What the Apple status actually establishes

The supplied build 11 status reports 60% progress, macOS still processing and an
iOS error with an empty errors array. It does not identify unpacking, JavaScript,
entitlements, icon conversion, compilation or signing as the failing operation.
Changing JavaScript cannot establish that Apple's native build failure is fixed.

The browser-based Safari Web Extension Packager is an official distribution path
and works without a local Mac/Xcode installation. It accepts the extension's
manifest and resources and builds the containing apps. This workflow remains
appropriate for the independently written Safari client. See
[Apple's packaging instructions](https://developer.apple.com/documentation/safariservices/packaging-and-distributing-safari-web-extensions-with-app-store-connect).

## New implementation and package checks

- Safari 16.4+ Manifest V3 with an explicitly nonpersistent background page.
- One background controller owns cookies, verification and credential storage.
  Concurrent requests share a flight; bounded persisted leases recover after
  suspension. Preference revisions and fresh cookie fingerprints reject stale
  replies, including a login change during the cooldown window.
- Cookie fingerprints are SHA-256 digests, not persisted raw ILIAS credentials.
  Saved BetterIlias credentials are scoped to the packaged server; failures keep
  them for retry without presenting an unverified login as connected.
- Only the trusted popup can force sync, change preferences or open tabs. Page
  messages cannot supply cookies, addresses or preference values. ILIAS pages
  never receive BetterIlias credentials.
- Manual sync remains available when automatic work is disabled or Safari
  suspends background execution. No promise of continuous iOS background sync.
- A dedicated Safari resource allowlist excludes retired helpers. The ZIP has
  its manifest at root, relative POSIX paths, Unix file modes and deflated files.
  Referenced resources, PNG icon dimensions, opaque 1024px RGB master icon,
  localisations, path safety and ZIP CRCs are checked before delivery.
  The latest upstream 64/120/152/167/180px native-app artwork is preserved too.
- A separate validation report records version, size and SHA-256. It explicitly
  records native Apple validation as not run.

The frontend build now regenerates translations only. A regression verifies that
it leaves all authored Safari executable/UI resources unchanged.

## Validation boundaries

Node simulations cover successful and failed verification, cookie filtering,
account switches, revision changes during pending work, concurrent wakeups,
suspension recovery, absent alarms, origin/message isolation, timeouts including
stalled response bodies and one-use handoffs. Chrome/Firefox retain their own
existing tests; Safari has independent behavioural tests.

The new popup is exercised in Chromium and Playwright WebKit at 320, 390, 430,
768 and 1280 CSS pixels plus short landscape, with German/English and dark/light
themes. These runs mock extension APIs; WebKit rendering is not native Safari
extension execution. Screenshot inspection checks density, wrapping and contrast.

Apple packaging/signing and real macOS/iPhone/iPad TestFlight acceptance remain
required: grant both website permissions; log in; verify automatic tab activity
and manual sync; open/reconnect the app; change accounts; disable automatic work;
test offline/expired sessions and suspension/resume. This repository does not
upload to Apple or alter the existing bundle identifier/app record.
