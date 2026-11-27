# 1.9.0 — Shared UniBE login and verified account usage

Companion **1.4.0** makes shared UniBE login the primary Chrome/Firefox flow.
It checks the server-held connection, shows the verified name and affiliation
choices, and offers login when the connection expires. Choices display only the
domain after `@`; requests retain the full verified affiliation. Selection needs
explicit confirmation. Same-account ILIAS renewal preserves caches, while account
replacement remains guarded and isolated. The flow works independently of the
UniSport navigation flag. Initial SWITCH login still uses the Companion.

The admin dashboard counts distinct verified shared-login accounts across
browsers, with an explicitly opened searchable list of names and last app use.
Named records expire **30 days after last use**. Login/status polling does not
count. Collection requires an enabled admin dashboard and is disclosed before
login. Raw provider subjects/tokens and names stay out of diagnostic events;
search uses a private POST body. Legacy cookie-only sessions are not attributed.

Reload/update the Chrome or Firefox Companion to 1.4.0 and refresh BetterIlias.
Keep the existing app tab open during migration so its explicit ILIAS credential
can be nominated for cache-preserving renewal. Store submission is separate.

The old cookie login remains in advanced settings as a deprecated recovery path.
[Protocol and rollback details](LEGACY_ILIAS_LOGIN.md),
[shared-login architecture](UNIBE_LOGIN.md),
[private account retention](OBSERVABILITY_PRIVACY.md#verified-account-usage-190).

Validation includes backend isolation/retention tests, frontend build and locale
checks, controller tests, responsive Chromium emulation, and installed Companion
flows in Chromium and native headless Firefox with synthetic provider callbacks.
These checks do not constitute live SWITCH or physical mobile-device acceptance.
The immutable `v1.9.0` tag identifies the exact published release commit.
