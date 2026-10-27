# Unified course and folder management

## Refined implementation brief

Build one permission-aware **Manage this page** mode for the current course or
folder. Start with user goals: provide material, explain it, organize it, and
remove obsolete content safely. Keep student browsing clean; reveal **Add
content**, selection, deletion and shared ordering only inside management mode.
Use the existing file/folder authoring flows and live native ILIAS forms. Every
shared change must be verified on ILIAS, localized in German and English, work
in dark mode, and cooperate with the existing navigation guards and cache.

Investigate native page-editor content before defining the add interface.
Distinguish a repository object from an element that displays it. Design one
intent-based catalogue rather than copying ILIAS's separate Add Object,
Manage, Sorting and Edit Page entry points. Never present an unimplemented
write flow as working. Keep uncertain destructive outcomes from being retried.

## User goals and interaction design

| Goal | Unified interaction | Native operation |
| --- | --- | --- |
| Read/download material | Normal course/folder page; one unobtrusive Manage button for authors | Existing content parser and download proxy |
| Publish files or create a folder | Manage → Add content → Materials and activities | Existing fresh creation forms and temporary file handler |
| Explain or structure a page | Same Add content catalogue → Text and layout | Native COPage elements, not repository creation |
| Remove outdated files/folders | Select rows or use a row's Delete action → inspect consequences → confirm | Live Manage form → native deletion confirmation → confirmed deletion |
| Change the shared reading order | Move rows up/down, review unsaved order, Save order | Fresh Sorting form, `position[ref_id]`, `cmd[saveSorting]` |
| Continue in a child folder | Open the folder from the management list; current-container scope follows navigation | Ref-ID-based folder navigation, no cross-container writes |
| Preview the result | Leave Manage; refresh verified server contents | Existing course blocks retain lecturer structure |

Management uses a scoped panel in place of the normal content body, under the
same breadcrumbs and title. Its toolbar holds Add content, a selection count,
Delete selected and Save order. A single list holds file/folder identities,
selection controls, open actions and keyboard-accessible reorder buttons.
Dirty ordering is protected on navigation, exiting management and destructive
actions. It is kept separate from personal block-display preferences.

## What the two native add menus mean

The saved Add Object dialog lists 30 repository types: files, folders, exercises,
forums, modules and so on. These have identities, permissions and lifecycles.
The saved Edit Page menu instead inserts text, image/media, tables, sections,
accordions/carousels, columns, interactive images, snippets, resource groups,
code, lists, maps and references to interactive/Opencast videos. These are page
elements, often displaying an existing repository object or media resource.

Thus there are two native storage models, not two equivalent ways to create a
file. In the unified catalogue the user chooses a goal; the adapter chooses the
correct model. A future image flow can ask whether to display the image on the
page or provide a downloadable file, and resource insertion can offer existing
objects before creating duplicates.

Deleting a repository folder can delete its contents; removing a page element
must not imply deleting its referenced resource. The saved
`select_and_deleting.html` is **page-element deletion**, not evidence for the
repository confirmation form. The implementation must inspect the latter live
and validate its selected IDs, rather than reuse COPage deletion commands.

## Native evidence and implementation boundaries

Source saves are in the user's `Ilias Course Formatting` directory. The Manage
save contains `id[]` controls and native delete/move/copy commands. The Sorting
save contains `position[ref_id]` and `cmd[saveSorting]`. Edit Page contains the
COPage insertion menu, but no completed text/table/media creation submissions.

The first implementation provides one mode, existing folder/file creation,
reviewed repository deletion and native ordering. The Text and layout category
documents the separate page-element choices and provides an explicit native
editor handoff when ILIAS advertises that capability. It does not claim native
BetterIlias page-element editing. Full editing adapters, moving/copying,
resource evacuation, and additional object creation remain explicit follow-ups
until their native forms and verification paths are supported.

Native behavior was cross-checked against ILIAS release 10 source:
[repository confirmation/deletion](https://github.com/ILIAS-eLearning/ILIAS/blob/release_10/components/ILIAS/ILIASObject/classes/class.ilObjectGUI.php)
and [container ordering/page editing](https://github.com/ILIAS-eLearning/ILIAS/blob/release_10/components/ILIAS/Container/classes/class.ilContainerGUI.php).
These establish the protocol, but runtime URLs, CSRF tokens, commands and input
names must always come from the active user's pages.

## Deletion safeguards

1. Load fresh management permissions and direct child IDs. Accept no arbitrary
   URLs or IDs from the browser. Only supported file/folder items are deletable.
2. Prepare a review of the selected items and recursively inspect selected
   folders using native management listings. If inspection is incomplete,
   unavailable, cyclic or too large, refuse deletion rather than assume empty.
3. Bind that review to a server-derived snapshot. On confirmation, recheck the
   snapshot and refuse if the selection or descendant contents have changed.
4. Follow the native confirmation, matching its selected IDs exactly. Preserve
   required hidden controls and exclude optional extra references. Do not
   silently expand deletion to other locations.
5. Never promise recoverability: ILIAS can disable its trash. Show the cascade
   warning even when a folder currently appears empty.
6. Submit confirmed deletion once, verify all selected direct references are
   absent from a fresh authoritative management listing, and record IDs/titles
   in the server log. A timeout or unconfirmed outcome requires review, not an
   automatic replay.
7. Invalidate affected material caches, including an empty parent, so deleted
   content cannot reappear from SWR or ILIAS Saver caches.

## Verification

Use sanitized excerpts of the supplied Manage/Sorting saves and contract
fixtures for live native confirmation variants. Cover permissions, unrelated
IDs, recursive folders, stale reviews, optional extra references, repeated
hidden fields, timeout/no-retry, incomplete verification, ordering conflicts,
and read-only users. Browser checks cover both languages and themes, management
gating, creation, selection/review/deletion, order changes, navigation guards
and empty-container cache refresh. Run the repository's full mandatory checks
and integrate upstream before publication.
