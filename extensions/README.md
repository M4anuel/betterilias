# BetterIlias browser companions

- [Chrome, Edge and Brave](chrome/README.md): load `extensions/chrome/`.
- [Firefox](firefox/README.md): load `extensions/firefox/manifest.json`.

The browser-specific folders contain complete extension packages. Locale bundles
are generated from the shared `locales/` catalogues by
`node scripts/sync-extension-locales.mjs` from the repository root.

Local match patterns omit ports because Firefox does not support port-specific
patterns. The content scripts check the page's actual origin against the standard
development endpoints and saved frontend/backend settings before sharing a session.
Keep this origin check when changing manifest permissions.

For native Firefox regressions, build the frontend and install `marionette_driver` in your test
environment and run `python -m pytest tests/test_firefox_extension_browser.py -v`
with `BETTERILIAS_FIREFOX_TESTS=1`. Set `BETTERILIAS_FIREFOX_BINARY` if Firefox is
not installed in its standard location. These tests use fresh headless Firefox
profiles, synthetic cookies and local test servers; they do not use a real ILIAS
account. They exercise the packaged popup document with real extension APIs,
including the 20-second network timeout, retry and content-script handoff.
The built React app is also checked in an already-open tab after another sync:
its course requests must carry the new `X-Session-Id`, the course must appear and
the inactive-session banner must disappear. The custom DOM event is tested
independently of postMessage to cover Firefox's page/extension object boundary.
Firefox event detail objects must be cloned into the page with `cloneInto`;
writing localStorage alone does not notify an already-mounted React app. Both
companions listen for extension-storage session changes as well as tab messages,
and register these listeners before waiting for a background sync response.
The native tests also use the backend's cookie helper on `localhost` and
`127.0.0.1`: Firefox must store the HttpOnly session cookie and send it on a
header-free native API GET, while keeping it unavailable to `document.cookie`.

Browser-internal addresses such as `chrome://extensions`, `edge://extensions`
and `about:debugging#/runtime/this-firefox` must be pasted into the address bar.
Browsers restrict navigation to these pages from websites; the BetterIlias setup
dialog provides copy buttons rather than links that cannot open them.
See [Chrome's installation instructions](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked)
and [Firefox's privileged URL restrictions](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabs/create).

## Safari feasibility

Safari supports WebExtensions on Mac, iPhone and iPad, so the existing JavaScript,
popup and translations are a useful starting point. There is no supported Safari
package in this repository yet. A port needs to verify the manifest/background
configuration, cookies and host permissions, session sync and content-script
handoff, background refresh, toolbar rendering, and popup behavior on Apple devices.
On iPhone/iPad, `localhost` refers to that device; connecting to a hosted BetterIlias
instance needs its HTTPS hostname in the extension permissions and settings.

Apple documents [Xcode conversion and App Store distribution](https://developer.apple.com/safari/extensions/).
Its [WWDC26 WebExtensions update](https://webkit.org/blog/17974/web-technology-sessions-at-wwdc26/)
also describes packaging and submitting through App Store Connect from a browser
without requiring a Mac or Xcode. Packaging alone does not establish runtime
compatibility: validate the actual sign-in/sync workflow in Safari before release.
