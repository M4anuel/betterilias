# BetterIlias Companion store notes

Updated 2026-11-27. Companion 1.5.0 is a prototype source update; this document
does not mean it has been submitted or approved in either browser store.

## Store listing

Name: BetterIlias Companion.

Short description: Sign in once with UniBE to connect ILIAS and UniSport in BetterIlias.

Detailed description: Sign in directly with SWITCH in a separate tab, choose
your organisation in the Companion, and connect ILIAS and UniSport to your chosen
BetterIlias instance. See your name and affiliation choices while signed in,
and a login button when the login expires. Open participant lists
inside BetterIlias and search names or offers without leaving the dialog, using
your existing official UniSport website login. The chosen instance must enable
UniSport. Automatic login renewal is not included. The
companion does not read passwords or authentication codes entered in login forms.

Category: Productivity. Primary language: English, with German translation.
Single purpose: Connect the user's university accounts to BetterIlias.

## Assets

Existing icons are in `extensions/chrome/icon*.png`. Updated public store
screenshots and listing review remain outstanding before a store submission;
synthetic test screenshots are not evidence of live account compatibility.

## Permissions justification

| Permission / host | Purpose |
| --- | --- |
| `cookies` | Support the explicitly selected deprecated ILIAS browser-cookie login. Locally fingerprint applicable ZSSW cookies to invalidate participant caches when its browser session changes; ZSSW cookie values are never sent to BetterIlias. SWITCH cookies are not read. |
| `storage` | Retain the supported language preference, unsaved settings/affiliation drafts and instance settings, per-instance BetterIlias connection capabilities and display names. Keep pending login state/tab ownership temporarily in session storage; provider tokens stay on the backend. |
| `alarms` | Periodically check the existing ILIAS connection. |
| `tabs` | Find the configured BetterIlias tab and open/close the separate user-initiated SWITCH login tab. |
| `webRequest` (new) | Observe the final SWITCH login redirect in the companion-owned login tab and deliver its authorization result to the chosen BetterIlias server. Requests are not blocked or modified. |
| `https://ilias.unibe.ch/*` | Read ILIAS login cookies and detect login changes. |
| `https://login.eduid.ch/*` (new) | Observe login completion and read only a native-callback form's hidden result fields. Do not read password, OTP or other login inputs. |
| `https://www.zssw.unibe.ch/*` (1.2.0) | Read the user-requested official participant list using the existing website session. Only fixed Anmeldeliste URLs are fetched; participant content is displayed locally in the chosen BetterIlias tab. |
| `https://betterilias.ch/*` | Connect the explicit online preset and synchronize the supported language preference with configured app tabs. |
| `http://localhost/*`, `http://127.0.0.1/*` | Connect local BetterIlias instances; page bridges additionally check exact configured origins/ports. |

Configured remote instance permissions and content-script registration continue
to use the existing setup flow. Both Chrome and Firefox receive the new bridge;
Safari does not receive these permissions or this login feature.

## Privacy and data use

Shared login stores only per-instance BetterIlias capabilities and display
metadata in the extension; the provider token stays on the configured backend.
The Companion displays the verified name and domain-only affiliation labels.
Full affiliation values are used for confirmed requests. Browser-cookie export
is available only in the explicitly selected deprecated fallback.

Authentication information is processed: ILIAS cookies and, on user request,
UniSport authorization codes and connection capabilities. The companion sends
these only to the configured BetterIlias instance. The instance exchanges the
code with SWITCH and sends the verified ID token to the UniApp backend to fetch
affiliations/registrations. Pending companion records expire after ten minutes
and are cleared with browser session storage; no provider refresh token is kept.
Established backend connections expire within one hour or can be disconnected.
Closing/uninstalling the companion does not itself revoke backend connections.

No password collection, browsing-history collection, advertising or sale of data.
See [PRIVACY.md](PRIVACY.md) for bilingual details and contact information.

Participant HTML is bounded, read only on request and parsed inertly into names
and offer text. It is not injected into the app or transmitted to the BetterIlias
server. Up to 20 participant lists are cached for five minutes in account,
affiliation, course and opaque website-session-scoped tab storage. Closing the
tab removes that storage. Disconnect clears private caches; website cookie
changes invalidate visible participant data after comparing its local identity.
Private/incognito windows and Firefox containers are not supported for this read;
the official participant page remains available. Browser cookie restrictions can
also require using the official page. Safari does not include this feature.

Firefox 1.2.0 additionally declares `websiteContent` and
`personallyIdentifyingInfo` for participant content delivered outside the
extension to the local BetterIlias page; existing `authenticationInfo` remains.
Update the matching store disclosures before submission. No store upload or
approval is implied by publishing source code.

## Version history

- 1.4.0 (2026-11-26): Shared UniBE login, name and affiliation selection in the
  Companion; domain-only affiliation labels and expiry/rejection checks.
  Browser-cookie login is deprecated and available explicitly in advanced
  settings. Same-account caches stay intact. Both browser sources are updated;
  no new permissions. Refresh store screenshots before submission.

- 1.3.0 (2026-11-25): Respect BetterIlias's explicit UniBE-token ILIAS
  connection preference on startup and automatic cookie sync. A manual sync
  switches back to browser cookies. Chrome/Firefox parity, no new permissions,
  no provider token delivered to the extension.

- 1.2.1 (2026-11-24): Guide the separate ZSSW website identity login in an
  official provider tab and resume participant-list loading on return. Track
  fixed return paths and tab ownership in session storage, with cancellation
  and expiry. No new permissions or provider-form access.

- 1.2.0 (2026-11-24): Read official UniSport participant lists inside BetterIlias,
  search names live, retain a short-lived local cache and detect website-session
  changes. Adds narrowly scoped ZSSW host access in Chrome and Firefox.
- 1.1.0 (2026-11-23): Independent companion-assisted SWITCH login prototype.

Before store submission, update authentication-data disclosures, publish matching
privacy text and complete the store's permission/privacy review. Package only
the relevant extension folder, excluding `.git`, `.env` and dependencies.

### Verified account usage disclosure (1.4.0)

When the instance has an enabled administrator dashboard, actual authenticated app use records a verified account identifier, display name and last-use timestamp in a private server-side usage index. The identifier is an instance-specific keyed hash of the verified SWITCH issuer, client and subject; raw subjects and provider tokens are not stored in this index. Administrators can see distinct-account totals and explicitly open/search the names. This counts accounts, not guaranteed individual people; legacy cookie-only connections are not attributed. Names and usage records expire 30 days after the last app use. Cleanup runs on access and every five minutes while the backend runs. Login/status polling does not extend retention. The Companion shows this purpose and retention before login when collection is enabled. No names enter diagnostic events, public endpoints or persistent browser analytics storage. The index is bounded to 10,000 most recently used accounts; older rows can be removed earlier at that limit.

This adds no browser permissions. See [PRIVACY.md](PRIVACY.md).

## Companion 1.5.0 (2026-11-27)

Compact shared login/status card and backend warning; deprecated cookies are an
advanced checkbox that changes the same card. No Companion-owned tab opens for
login or legacy sync. Official provider pages and explicit app-opening actions
remain. Both online/local presets work in distributable packages; drafts are
orange until saved and briefly turn green with a checkmark on success.

Language follows a configured app's supported preference on first use when
accessible, otherwise browser language, then synchronizes in both directions.
Only language codes cross this bridge; no auth cookies are used for it. Pending
transactions remain in session storage while the action popup closes. Store
submission/signing and updated public screenshots remain separate.
