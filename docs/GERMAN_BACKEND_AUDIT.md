# German ILIAS backend compatibility audit

Date: 2 November 2026. Scope: the existing 44 backend Python modules, plus the new shared native-text parser added during this audit. No live ILIAS writes or authenticated German-page captures were performed.

## Result

Saved German pages are **not required to identify and fix code-level language assumptions**. They **are required for stronger deployment confidence**, especially where Uni Bern plugins or ILIAS versions change markup as well as labels. This audit is a source/fixture review with regression coverage, not certification of every German screen on the live installation.

The review inventoried every backend module, inspected string comparisons, regular expressions, property lookups and native form discovery, then followed the text-sensitive scraper/authentication paths. Machine commands, field names and enum values must stay untranslated: `cmd[saveStatusAll]`, `notice[...]`, `passed`, `failed`, `ass_id`, etc. are not English interface labels.

Native wording was cross-checked against the official [ILIAS 9 German catalogue](https://github.com/ILIAS-eLearning/ILIAS/blob/release_9/lang/ilias_de.lang) and [English catalogue](https://github.com/ILIAS-eLearning/ILIAS/blob/release_9/lang/ilias_en.lang). The deployed version/plugin translations may differ. In particular, native `exc_tbl_notice` is “Interne Anmerkung,” `exc_settings_feedback` is “Rückmeldung,” `exc_edit_until` is “Abgabetermin,” and `event_ass_materials_prop` is “Materialien zur Sitzung.” Existing code did not recognize all of these.

## Findings fixed

| Area | Failure before the fix | Change |
| --- | --- | --- |
| TA grading status | “Nicht bestanden” contains “bestanden,” so positive-first matching could report a failed submission as passed, even when a selected native option said `failed`. | Native option values take precedence. Negative, ungraded and positive labels are distinguished explicitly. |
| Student assignment feedback | The German “Rückmeldung” panel was not recognized as an evaluation panel. Feedback/status could be absent. Broad whole-panel status searches could also mistake feedback prose for the actual result. | Recognize the native German panel, read labelled status separately and retain lecturer feedback text. |
| Grading errors | A German “could not save” message could be missed, and an explicit native error could subsequently be overridden by a 200/302 HTTP-success fallback. | Recognize negative save messages and apply any legacy unconfirmed-response fallback only after explicit errors have been ruled out. This is not full read-back verification of every grading write. |
| Tutor submission metadata | “Interne Anmerkung/Bemerkung,” “Text-Feedback” and “Individueller Abgabetermin” were not all mapped to canonical fields. | Add native German heading aliases without changing form names or note content. |
| Assignment overview | German deadline/requirement/ended/starting properties could be missed, leaving details empty or classifying upcoming work as ongoing. | Normalize label whitespace/colons and map Abgabetermin, Anforderung, Beendet am and Startet am. |
| Calendar/course sessions | Several material-session paths accepted only ASCII English month labels. `März`, dotted abbreviations and numeric German dates could lose their date. German session-material counts and previous-session navigation were also missed. | Share native date tokens/month parsing; support German/numeric dates, relative-day labels, Sitzung icons and Materialien zur Sitzung in the session paths. Skip German previous-session navigation as chrome. |
| Course title chrome | Some paths stripped Content/View prefixes but retained Inhalt/Ansicht. | Strip those known native prefixes in the same header contexts, preserving the actual title. |
| Recording metadata | Presenter/Location extraction relied on English text. Some German date formats were not normalized; label colons could defeat direct lookup. | Normalize native labels, prefer structured definition-list values, support German aliases and dates, and retain a bounded text fallback. Plugin-specific wording still needs real-page confirmation. |
| News/activity | German Datei/Kurs/Übung targets and Heute/Gestern/month dates were absent from metadata. Missing dates could also collapse repeated headlines during deduplication. | Support German metadata and share the log-item parser with the course sidebar instead of maintaining a separate English-only implementation. |
| Semester contacts | A native Kontakt property was ignored; German chrome could be treated as a category. | Recognize Kontakt and the corresponding known navigation headings. Preserve the contact's actual text. |
| Full filenames in action menus | The Actions for/Aktionen für fallback had an over-escaped whitespace regex, preventing full filename recovery in that path. | Correct the regex and verify both label languages, including extensionless display titles. |
| Assignment instruction attachments | The count parser looked for `file`, not `Datei/Dateien`. | Recognize both native count labels. |
| Feedback file sizes | Größe was not recognized alongside the Swiss spelling Grösse. Positional fallback could include the column heading in its value. | Support both spellings and retain the existing structural download/upload parsing. |
| Participant pagination | Formatted totals such as `1.234`, `1'234` or `1 234` could be read as `1`, truncating a complete-list workflow. | Parse English/German summary labels and normalize grouping separators in totals. |
| Locked repository objects | Without a useful icon filename or content link, German Kurs/Gruppe/Kategorie alt text was not recognized. | Add exact native alt-label fallbacks; do not classify by arbitrary course titles. |
| Session validation | Both validators looked for generic login links before checking the authenticated user control. A German authenticated page with a help/login link or archived denial notice could be rejected. The client also depended on double-quoted login fields. | Prefer the actual user identity before body-level prompt heuristics; parse login inputs structurally. HTTP authorization failures and login redirects still take precedence. |

The shared `backend/scrapers/native_text.py` handles only interface label normalization, grade-status decoding, date tokens/months and native page prefixes. It does not translate or rewrite lecturer content, student names, tutor notes or filenames.

## Module coverage

“No additional issue found” means the reviewed paths use machine identifiers/structure or already have the relevant German aliases. It is not a claim of live-page validation.

| Modules | Review outcome |
| --- | --- |
| `backend/{__init__,config,i18n,main,schemas}.py` | Configuration, request localisation, canonical data models and error handling; no native German DOM matching added or required. The authenticated HTTP client already requests German-compatible Accept-Language, so English fixtures alone were never sufficient proof. |
| `backend/api/deps.py`; `backend/api/routes/{__init__,auth,calendar,dashboard,exercises,materials,system}.py` | Reviewed route dispatch, parameters, permissions, download proxying and canonical status usage. Native parsing is delegated; no translated native-command replacements needed. |
| `backend/auth/{__init__,playwright_login,session}.py` | Login automation primarily follows domains, machine routes and cookies. Session validator corrected as above. Actual SWITCH/ILIAS login variants remain a capture/manual-test item. |
| `backend/scrapers/{__init__,dumper,player}.py` | Parser infrastructure and manifest/media JSON are structure/protocol based; no additional German label failure found. |
| `backend/scrapers/{dashboard,membership,management}.py` | Course IDs, native membership/create/delete commands and form names are structural. Existing German navigation fallbacks inspected. No additional language-driven change required in these modules. |
| `backend/scrapers/{authoring,calendar,exercise_editor,feedback_files,forms,logs,materials,podcasts,repository,semester,submission_listing,submissions}.py` | Native text-sensitive paths reviewed and corrected as described above. |
| `backend/scrapers/native_text.py` | New shared pure-text helpers; regression coverage for positive/negative labels, German months, numeric/relative dates and invalid dates. |
| `backend/services/{__init__,assignment_multipart,authoring,calendar_service,exercise_bulk,management,semester_utils,submission_listing,ta_allocation}.py` | Reviewed orchestration, multipart fields, allocation/status enums, pagination and cache/date handling. Native DOM interpretation delegates to the parsers. Pure HS/FS semester codes, ICS properties, archive paths and form commands remain unchanged. No additional German-label fix required here. |
| `backend/services/ilias_client.py` | Reviewed native endpoint/form discovery, downloads, grading, uploads, team handling and session-loss checks. Session detection corrected; existing machine-command routes retained. |

## Verification

- `tests/test_german_pages.py` adds focused regressions spanning grading, student feedback, overview properties, date formats, course sessions, recording metadata, course/sidebar news parity, contacts, full filenames, paging totals, attachment counts, file sizes, repository types, native save messages and session verification.
- These tests use explicitly constructed German native layouts or translated **interface nodes** on existing fixtures. They do not pretend to be saved German production pages. English/native fixtures and the existing backend suite are also run to check regressions.
- Known commands/IDs remain unchanged; instructor titles, feedback prose, contact names and file names are asserted unchanged where applicable.
- This is a backend/data audit. No new frontend layouts or mobile interactions were introduced. A frontend build is still part of the repository's required verification.

## German pages that would provide the most confidence

Save the **rendered full page** after switching ILIAS itself to German. A screenshot alone cannot establish field names, command URLs, data attributes or dynamically supplied form actions. Sanitized examples are sufficient; no password or real session cookie is needed.

1. **Abgaben und Noten**, for a team and an individual assignment: include passed, failed, ungraded, late and unsubmitted rows, internal notes, Text-Feedback, individual deadlines and more than one table page if available.
2. **A student's assignment page**, expanded: Terminplan, Arbeitsanweisung, uploaded files, team controls and Rückmeldung with status and text.
3. **A course page with session drawers**, including German dates, März or an umlaut month if possible, counts for Materialien zur Sitzung, previous/upcoming links and sidebar news.
4. **The podcast/Opencast recording list**, with its Datum/presenter/location fields. This plugin is the least safe place to assume core ILIAS translations apply.
5. **Bewertungsdateien / feedback file manager**, plus any upload/confirmation dialog that differs from the saved English layouts. Native upload JavaScript/token wiring cannot be proven from a screenshot.
6. **Assignment edit/list and course join/leave or management dialogs** if those workflows fail in German; include validation messages and the native form rather than only the overview.
7. **Semester/course-group overview** if German labels differ from Kontakt or the currently supported navigation.

If providing pages, remove or invalidate cookies/CSRF/session tokens and identifying student data before sharing. Keep structural identifiers consistently replaced so relationships between team rows, members, form fields and URLs remain testable. The app's failed-HTML dumps can also be useful, but inspect them for student data and tokens first.

Remaining uncertainty is mostly deployment/plugin/version-specific markup and uncommon translated form variants. Real captures would let these be turned into representative regression fixtures; this audit does not justify saying that saved German pages are unnecessary for complete assurance.
