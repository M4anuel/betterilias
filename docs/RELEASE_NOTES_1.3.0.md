# BetterIlias 1.3.0

- Add default Unisport navigation in every semester with a separate SWITCH
  connection, explicit affiliation confirmation and read-only registrations.
- Add opt-in `UNISPORT_ENABLED` (false by default). Reuse the native UniBE public
  client for a prototype; no official registration is implied.
- Chrome/Firefox Companion 1.1.0 captures native form-post callbacks. Chromium
  additionally captures HTTP redirects; Firefox relies on explicit form-post.
- Verify server-owned PKCE/state/nonce and signed ID tokens, expire connections
  within one hour, and prevent replay or stale completion after disconnect.
- Keep ILIAS credentials and all session behavior independent. Provider passwords
  remain on SWITCH pages. No refresh token, booking or scheduling is implemented.

Validation uses synthetic RSA tokens, mock UniApp responses, installed Chromium
and Firefox with isolated profiles, and responsive German/English light/dark
browser emulation. Real SWITCH account acceptance and physical-device validation
remain manual checks. See [setup and limitations](UNISPORT_INTEGRATION.md).

The immutable `v1.3.0` tag identifies the tested release commit; the publishing
summary records its exact commit ID. Extension store publication is separate.
