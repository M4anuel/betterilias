# 1.7.0 — Cached participant dialog, registrations and verified CI

- Show the official UniSport Anmeldeliste inside a shared native dialog. Search
  names/offers live, with accent-insensitive matching and full names retained on
  phones/tablets. Keep the official website link for login and fallback.
- Companion 1.2.0 reads the fixed website route using the current normal browser
  session. It does not read login inputs or forward ZSSW cookies/API credentials
  to BetterIlias. Chrome and Firefox have matching narrowly scoped host access.
- Cache up to 20 participant lists for five minutes in private tab storage,
  scoped to native account/affiliation/course and an opaque website-session
  identity. Recheck that identity on opening; hide data after a session change.
  Parse inert HTML and render text only; no participant HTML/names go to the server.
- Cache native registrations for one minute on server and client, preserving
  original timestamps and providing explicit refresh. Serialize cache reads
  against mutations, invalidate on writes, and keep authorization/readback fresh.
- Fix GitHub Actions dependency order: install frontend packages before pytest's
  locale-generation checks. Include the Safari worker builder in Docker context.
  Run focused dialog/Companion Chromium tests in CI. Automatic push runs cover
  main/release tags; pull requests and manual verification remain enabled.

Reload Companion 1.2.0, accept ZSSW host access and reload BetterIlias. Native
UniApp login and ZSSW website login remain separate. Private/container windows
and restricted cookies retain the official-site fallback. No browser-store
publication or live personal-account validation is implied by this source release.
The immutable `v1.7.0` tag identifies the tested application release commit.

Validation: 824 backend tests passed (1047 opt-in checks skipped); 133 focused
UniSport browser checks passed, plus the actual Chrome/Firefox participant bridge
checks with isolated synthetic accounts. All 57 Node checks, localisation, the
frontend production build, launcher syntax and the production container smoke
test passed. Responsive checks use desktop-browser emulation, not physical phones.
