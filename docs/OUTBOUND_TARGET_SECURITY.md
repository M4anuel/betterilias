# Outbound target security — review branch

Branch: `fix/outbound-target-security`. This feature is independent of the TA
allocation-defaults branch and is held off `main` for review.

## What changed

The shared SessionManager HTTP transport now validates every native request and
redirect against an exact origin allowlist. Its authenticated origin is
`ILIAS_BASE_URL`; external media origins come from `OUTBOUND_MEDIA_ORIGINS`.
The defaults are `https://opencast.unibe.ch` and
`https://dist.opencast.unibe.ch`, matching supplied player/caption fixtures.
There are no wildcard domain matches. Different ports, HTTP downgrades, userinfo,
trailing-dot aliases and lookalike domains are rejected. Add other legitimate
origins explicitly in server configuration after checking the native links.

Before opening each new TCP connection, the HTTPCore network backend resolves
the allowlisted hostname and rejects the entire answer set if any address is
non-public, loopback, link-local, reserved, multicast or an IPv4 translation/tunnel
address. It connects using a validated **numeric IP**, preventing a second DNS
lookup between validation and connection. The original hostname remains the TLS
SNI/certificate name, HTTP Host header and connection-pool key. TLS verification
stays enabled. Keepalive reuses the established safe connection; new connections
repeat DNS checks. No DNS safety claim relies on a preflight lookup alone.

Only GET/HEAD without bodies may reach an external media origin. A header
allowlist removes ILIAS cookies, Authorization, BetterIlias credentials, CSRF
headers and Referer before external dispatch. External Set-Cookie responses are
removed before HTTPX can update the native cookie jar. Native cookies are also
domain scoped. Signed media query strings are preserved. A media redirect back
to ILIAS must be a resource read, not an authenticated editor/grade command.
Cross-origin 307/308 redirects cannot forward native form bodies.

The low-level adapter uses HTTPCore's public connection-pool/network-backend API
and explicitly maps transport errors back to HTTPX exceptions. It ignores request
extensions that could override SNI or the wire target. Requests still pass through
the shared outbound budget, and streams still hold their permits until closed.

The material-download and PDF endpoints no longer accept arbitrary native command
URLs. Supported routes include sendfile/download/downloadReturned, file permalinks,
native repository file navigation and common static file types. Duplicate command
parameters, write commands and unsafe fallback commands are refused. This resource
constraint follows redirect hops. Public numeric route/assignment IDs also reject
query delimiters before existing service URL construction can interpret them as
additional commands. New native download protocols require an explicit adapter or
allowlist extension with fixtures; unrecognized links fail closed.

PDF metadata probes use streaming reads capped at 256 KiB even when the server
ignores Range. A small first range can fall back to one bounded prefix read.
Blocked targets return a localized 400 `OUTBOUND_TARGET_BLOCKED` response, without
echoing private URLs, credentials, signed queries or resolved IPs. This condition
does not activate session verification's old network-latency acceptance fallback.
That fallback is removed: network failures/timeouts produce retryable gateway
errors, and cookie names alone never validate incoming credentials or replace
a working tenant. Other native workflow fallbacks propagate blocked targets
instead of trying another write.

## Configuration and limits

```dotenv
ILIAS_BASE_URL=https://ilias.unibe.ch
OUTBOUND_MEDIA_ORIGINS=["https://opencast.unibe.ch", "https://dist.opencast.unibe.ch"]
OUTBOUND_ALLOW_LOCAL_ILIAS=false
```

Media origins must be exact HTTPS origins on port 443, without paths or wildcards.
The native installation uses its explicitly configured origin. A local/private
ILIAS test server is permitted only with **both** `APP_ENV=development` and
`OUTBOUND_ALLOW_LOCAL_ILIAS=true`, and only at that exact configured native origin.
Production refuses the local override. It does not relax external media checks.

Direct connections are used; environment HTTP proxies are not supported by this
transport. A proxy adapter would need equivalent destination validation and IP
pinning at the actual egress point. Exact origins and DNS checks do not replace
network/firewall egress controls, patching, production monitoring or the separate
multi-host coordination work. No administrator can enable arbitrary hostnames
through a user API; these settings are server-owned.

Login redirects to identity-provider origins outside the allowlist are blocked,
not followed with ILIAS cookies. Reconnect through the companion after signing
in to ILIAS in the browser. Staging acceptance should exercise expired-session
redirects and all real media/file delivery hosts; automated fixtures do not prove
compatibility with every installation or CDN. Do not add identity-provider or
arbitrary university-wide wildcard origins to bypass an error.

## Review and verification

Run the normal development launcher from this worktree and reconnect the companion
to that instance. Saved user credentials are not copied between worktrees. Check
ordinary file/submission/feedback downloads, PDF previews and video captions.
Direct browser video playback continues to use the manifest's media URLs.

```powershell
python -m pytest tests/ --basetemp=.pytest-tmp-egress
npm.cmd --prefix frontend run check:locales
npm.cmd --prefix frontend run build
$env:BETTERILIAS_BROWSER_TESTS='1'
$env:BETTERILIAS_BROWSER_CHANNEL='chrome'
python -m pytest tests/test_outbound_targets_browser.py --basetemp=.pytest-tmp-egress-browser
```

Focused tests cover malicious URLs, native write URLs, public/private mixed DNS,
DNS rebinding, numeric-IP pinning with original TLS SNI/Host, verified SSL context,
credential/header isolation, cookie poisoning, redirect chains, blocked POST body
forwarding, query-ID injection, sanitized bilingual API errors and bounded PDF
reads. Mock network backends establish connection/TLS plumbing without asserting
that a live certificate handshake or live ILIAS operation was performed.

Browser tests use the production build with mocked blocked/successful downloads
at 320, 390, 430, 768 and 1280 px and short landscape sizes in German/dark and
English/light. They exercise readable error feedback, dismissal, keyboard retry,
the resulting downloaded filename and retained credentials. Additional Chrome
and Firefox popup checks verify that 502/504 verification failures preserve the
stored connection and permit recovery after a positive verification response.
Both popup variants run with mocked extension APIs in Chrome; this does not
claim a new physical Firefox/Xray validation. Screenshots are under
`scratch/egress-review/`. This is Chrome viewport emulation, not physical iOS
Safari/Android Chrome or live authenticated ILIAS validation.

The implementation follows the public
[HTTPX transport interface](https://www.python-httpx.org/advanced/transports/),
[HTTPCore network-backend API](https://www.encode.io/httpcore/network-backends/),
and Python's [IP-address classification API](https://docs.python.org/3/library/ipaddress.html).
