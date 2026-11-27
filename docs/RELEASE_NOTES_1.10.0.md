# 1.10.0 — Compact Companion 1.5.0

Chrome and Firefox share one popup for SWITCH edu-ID and the optional deprecated
browser-cookie login. The header has one tagline, connection failures appear in
a warning below it, and each login button stays inside its status card. Unknown
connection state is no longer labelled as signed out. Verified names and explicit
affiliation/account confirmation remain available after shared login.

The Companion opens only the official provider page for SWITCH login. Pending
transactions live in background/session storage so closing the action popup is
safe. Reopen the Companion to choose an affiliation. It never opens a Companion
or legacy-login tab. Explicit Open BetterIlias focuses an existing configured app
tab or opens the web app. The ILIAS login button similarly opens the official site.

Advanced settings contain online/local presets, a deprecated-cookie checkbox,
orange unsaved feedback and a brief green checkmark after saving. Both presets
work in packaged Chrome/Firefox builds. Draft settings/affiliations survive popup
closure within the browser session. Saved credentials remain scoped to their
configured server; page writes check the selected origins after settings changes.

On first use, an accessible configured BetterIlias tab's supported language
preference takes priority over browser language. The app stores this preference
in localStorage, not an authentication cookie. Subsequent app/Companion changes
synchronize both ways, including across open configured app tabs. Unsupported
values are ignored. No authentication cookies are read for language detection.

## SWITCH form warning

The current native-app prototype requests `response_mode=form_post` and the fixed
`ch.unibe.campusapp://campusapp.unibe.ch` callback. That is not a localhost or HTTPS
callback. A browser may warn when the provider submits to a non-HTTPS destination.
The code therefore points to the native callback as the likely trigger; this is
not a browser determination that BetterIlias is the registered campus app. We
have not captured the particular live warning's action URL, so this is an
inference, not a live-browser diagnosis. Backend requests are separate from that
form navigation. Moving the local backend to HTTPS does not change the callback.
Do not disable browser security warnings. A registered web callback remains the
future migration path documented in the UniSport integration notes.

Validation covers both languages/themes, 320/390/430/768/1280 CSS px and short
landscape emulation, real Chromium popup sizing, and installed Chromium/native
headless Firefox flows with synthetic provider callbacks and two-way language
changes. No physical-device or live SWITCH acceptance is claimed.
