# BetterIlias Companion store notes

Updated 2026-11-24. Companion 1.2.1 is a prototype source update; this document
does not mean it has been submitted or approved in either browser store.

## Store listing

Name: BetterIlias Companion.

Short description: Connect your ILIAS session to BetterIlias and test a separate
SWITCH connection for UniSport.

Detailed description: Connect your signed-in University of Bern ILIAS account to
your chosen BetterIlias instance. The experimental UniSport connection opens
SWITCH in a separate tab so you can sign in directly with SWITCH, choose your
affiliation and view your registrations in BetterIlias. Open participant lists
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
| `cookies` | Read ILIAS authentication cookies for the existing connection. Locally fingerprint applicable ZSSW cookies to invalidate participant caches when its browser session changes; ZSSW cookie values are never sent to BetterIlias. UniSport does not read SWITCH cookies. |
| `storage` | Retain instance settings and ILIAS connection metadata. Keep UniSport login state/tab ownership temporarily in session storage. |
| `alarms` | Periodically check the existing ILIAS connection. |
| `tabs` | Find the configured BetterIlias tab and open/close the separate user-initiated SWITCH login tab. |
| `webRequest` (new) | Observe the final SWITCH login redirect in the companion-owned login tab and deliver its authorization result to the chosen BetterIlias server. Requests are not blocked or modified. |
| `https://ilias.unibe.ch/*` | Read ILIAS login cookies and detect login changes. |
| `https://login.eduid.ch/*` (new) | Observe login completion and read only a native-callback form's hidden result fields. Do not read password, OTP or other login inputs. |
| `https://www.zssw.unibe.ch/*` (1.2.0) | Read the user-requested official participant list using the existing website session. Only fixed Anmeldeliste URLs are fetched; participant content is displayed locally in the chosen BetterIlias tab. |
| `http://localhost/*`, `http://127.0.0.1/*` | Connect local BetterIlias instances; page bridges additionally check exact configured origins/ports. |

Configured remote instance permissions and content-script registration continue
to use the existing setup flow. Both Chrome and Firefox receive the new bridge;
Safari does not receive these permissions or this login feature.

## Privacy and data use

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
