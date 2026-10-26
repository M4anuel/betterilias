The two student upload fixtures contain only the native `addUpload` form and
the literal `il.UI.Input.File.init(...)` configuration extracted from the user-supplied
saved pages:

- `student_upload_gti.html`: `GTI_Exercises/Übungsserien_ ILIAS Universität Bern.html`
- `student_upload_mms.html`: `KW Way To Exercise Student/Hand_In_Upload_Submission_ Übungen_ ILIAS Universität Bern.html`

Account navigation, user names, cookies, submitted files, other scripts and
unrelated forms were excluded. Both saved pages have empty dynamic templates.
The fallback token field follows ILIAS's `DynamicInputsNameSource`; live HTML
with an explicit dynamic token input takes precedence.

The matching ILIAS 10 implementation defines the protocol in:

- [File widget](https://github.com/ILIAS-eLearning/ILIAS/blob/release_10/components/ILIAS/UI/resources/js/Input/Field/file.js)
- [Dynamic input names](https://github.com/ILIAS-eLearning/ILIAS/blob/release_10/components/ILIAS/UI/src/Implementation/Component/Input/DynamicInputsNameSource.php)
- [Submission upload handler](https://github.com/ILIAS-eLearning/ILIAS/blob/release_10/components/ILIAS/Exercise/Submission/class.ilExSubmissionFileGUI.php)
