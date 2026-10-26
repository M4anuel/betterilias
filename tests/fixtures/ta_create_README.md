`ta_create_upload.html` contains only the assignment creation form from
`CreateExercises/add_assignment_type_upload.html`, provided by the user.
Account navigation and unrelated dialogs were excluded; the CSRF token and
file hash were replaced with fixture values.

`test_ta_assignment_save.py` reconstructs the additional team-upload controls
to exercise conditional team formation, as defined by the matching ILIAS 10
[assignment editor](https://github.com/ILIAS-eLearning/ILIAS/blob/release_10/components/ILIAS/Exercise/Assignment/class.ilExAssignmentEditorGUI.php).
The supplied workflow contains the file-upload creation form, rather than a
saved team-upload creation form. Tests distinguish these two sources.

The tests simulate native form navigation, multipart payloads, create/update
commands, preserved settings and assignment identity checks. They never create
or edit anything in a live ILIAS course.

Empty upload parts must explicitly include `filename=""`, including the file in
the unchecked sample-solution subform. PHP otherwise puts them in `$_POST`, and
ILIAS reports a file-size error when `$_FILES` is missing. See the native
[file validator](https://github.com/ILIAS-eLearning/ILIAS/blob/release_10/components/ILIAS/Form/classes/class.ilFileInputGUI.php)
and [checkbox validator](https://github.com/ILIAS-eLearning/ILIAS/blob/release_10/components/ILIAS/Form/classes/class.ilCheckboxInputGUI.php).
Tests inspect filename parameters, and a browser test compares the backend's
empty parts with Chromium's serialization of this native form without making
any network request.

`ta_assignments_list.html` contains the two native editor forms from a read-only
inspection of the failing exercise list. Original CSRF tokens, scripts and account
navigation were removed. It preserves the leading layout table, the actual table
with 12 assignments, and the unnamed Add button using `fallbackCmd=addAssignment`.
The complete markup is used in parser, API, and browser regression tests; simplified
one-table mock pages alone do not cover this structure.

`ta_instruction_upload.html` contains the upload form and its matching file-widget
initialization from the provided instruction-file dialog. `ta_instruction_files.html`
contains the native table row after an upload. Navigation, account details, unrelated
scripts and dialogs were excluded. These cover the `upload` JSON handler, the
`resource_id` token sent to `postUpload`, and the checkbox column preceding the
filename. They are exercised with a mock HTTP transport; browser tests cover
formatting, HTML editing, link targets, reloading existing instructions and retrying
failed attachments without creating the assignment again.
