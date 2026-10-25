# TODO

Unchecked items are unfinished; completed work is listed separately below.

## Localisation

**Status:** Only the text inventory has been saved. The language selector,
translation catalogues, and build validation are not implemented yet.

- [ ] Add a language setting with German and English support.
- [ ] Move hardcoded user-facing text into translation files (for example,
  `translations.ts`) and look up the selected language when rendering it.
  Cover the app, user-facing server messages, and both Chrome and Firefox
  extension popups. Keep course titles and other content supplied by ILIAS
  as provided.
- [ ] Give each language an explicit fully supported or partially supported flag.
- [ ] Check translation completeness at compile/build time:
  - Fully supported languages must contain every translation key; missing entries
    must fail the build.
  - Partially supported languages may report warnings for missing entries, but
    must still build and run. Use English for missing translations without
    crashing the app or server.
- [ ] Verify language selection, translation coverage, build failures for
  incomplete fully supported languages, and English fallback for partial ones.

## ILIAS content and formatting

- [ ] Preserve more of the original ILIAS structure and formatting where possible.

## Teaching assistant tools

- [ ] Support creating folders.
- [ ] Support creating exercises.
- [ ] Identify remaining TA workflows that should be available in BetterIlias.

## Completed

- [x] Correct and grade exercise submissions.
- [x] Connect a phone using a QR code in the desktop app's top-right settings menu.
