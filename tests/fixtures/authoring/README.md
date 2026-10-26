# Repository authoring excerpts

These fixtures contain the native creation forms, file-widget initialization,
object creation links, management tabs and edit-page toolbar from the user's
saved Uni Bern ILIAS pages under `Ilias Course Formatting`.

Source pages: `New_Folder_…html`, `new_file.html`, and
`View_ Content_ 2718-HS2024-0_ Programmieren für Naturwissenschaften_…html`.
Unrelated page chrome and personal data were excluded; parent references are
normalized to `42` and CSRF tokens replaced with `fixture-token`.

The folder templates are **Default** (`dtpl_0`) and **Hidden folder** (`dtpl_5`).
The latter does not select a column layout. File upload uses the temporary
`ilObjFileUploadHandlerGUI` endpoint and then submits parallel title,
description and resource-ID arrays to the fresh native form action.
