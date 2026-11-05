# Review: outbound security and TA allocation defaults

These features were reviewed and accepted on 5 November 2026. The temporary
review worktrees and branches are retired after integration. Their common
starting point was `638258a`; the commit references below preserve the history.

| Review scope | Branch | Independent feature head |
| --- | --- | --- |
| Safe outbound fetches, redirects and credential isolation | `fix/outbound-target-security` | `cb9a3c9` |
| Account/course assistant defaults and refused note truncation | `feat/ta-allocation-defaults` | `75552e0` |
| Both features together | `feat/review-hosting-ta` | Accepted integration |

The features are now available in the normal repository checkout. Temporary
`scratch/features/` paths from the review are no longer needed.

## Run the accepted features

Stop any existing BetterIlias development launcher first: the current launcher
uses ports 8000 and 5173. From the normal repository checkout, run:

```powershell
python start.py
```

Reconnect the browser companion if the selected backend instance has changed.
Private credentials were never copied between the temporary worktrees.

## Suggested checks

1. Open a tutor exercise and choose **Distribute work**. Rename/reorder assistants,
   add/remove one, then close/reopen or refresh. Defaults should remain for this
   account/course, including across exercises. A different course/account starts
   independently. Editing defaults must not publish an ILIAS allocation.
2. Resize/rotate while editing. Check keyboard Escape and touch close, priority
   arrows and the footer on a phone. Draft fields should remain intact.
3. Use a long existing tutor note. The preview must identify any 200-character
   overflow and disable saving. Neither the UI nor server may shorten the note.
4. Check ordinary material/submission/feedback downloads, PDF previews and video
   captions. The server must refuse untrusted/private targets, unsafe redirects
   and native write URLs supplied as download links. Blocked links show translated
   feedback while retaining the BetterIlias connection.
5. Verify companion recovery if the backend is unavailable. Network failures and
   timeouts must not replace a working saved session with unverified cookies.

Use controlled test content before publishing any real allocation. Automated
tests use mocked native/API/network responses; no authenticated ILIAS writes or
physical iOS/Android validation are claimed.

Detailed behavior, configuration and staging limitations:

- [TA allocation review](docs/TA_ALLOCATION_REVIEW.md)
- [Outbound target security](docs/OUTBOUND_TARGET_SECURITY.md)

## Automated verification

Independent branches passed their full backend suites, frontend build, locale
checks and launcher syntax checks. The TA branch also passed four helper tests
and 12 browser cases; the security branch passed 20 browser cases. The combined
review passed **545 backend tests** (329 opt-in/unavailable-fixture skips),
**32 browser cases**, **4 helper tests**, the production build, locale checks
and launcher syntax validation. It retains all source changes from both branches.

```powershell
python -m pytest tests/ --basetemp=.pytest-tmp-review -p no:cacheprovider
npm.cmd --prefix frontend run check:locales
npm.cmd --prefix frontend run build
node --test tests/ta_allocation_defaults.test.mjs
$env:BETTERILIAS_BROWSER_TESTS='1'
$env:BETTERILIAS_BROWSER_CHANNEL='chrome'
python -m pytest tests/test_allocation_browser.py tests/test_outbound_targets_browser.py --basetemp=.pytest-tmp-review-browser -p no:cacheprovider
```

Local generated screenshots are in `scratch/allocation-review/` and
`scratch/egress-review/`. Browser checks cover German/dark and English/light,
320/390/430 px phones, 768 px tablets, 1280 px desktops, short landscape windows,
and both companion popup variants through mocked extension APIs in Chrome.
