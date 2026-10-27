# Native management and sorting evidence

`manage.html` and `sorting.html` are excerpts of the supplied course-formatting
page saves. They retain native list rows, selection controls, sorting fields,
form actions and command names. Unrelated dialogs/scripts were removed,
parent references normalized to `42`, and CSRF tokens replaced by
`fixture-token`.

Repository deletion confirmation contract fixtures are constructed in
`test_management.py` from the ILIAS release 10 `ilObjectGUI` protocol. The
supplied `select_and_deleting.html` demonstrates COPage element deletion and
must not be used as a repository deletion fixture. Both modern generated-input
and legacy repeated-ID confirmation forms are tested, including optional
references that must remain unselected.
