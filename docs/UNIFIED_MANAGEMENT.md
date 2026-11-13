# Unified Course and Folder Management

BetterIlias provides an integrated, permission-aware **Manage this page** mode for courses and folders. It unifies content authoring, shared item reordering, and safe deletion into a single streamlined view, directly backed by live native ILIAS forms.

---

## 1. Capabilities & Feature Matrix

| Capability | What BetterIlias Does | Native ILIAS Mechanism |
| :--- | :--- | :--- |
| **Management Mode** | Unobtrusive toggle in course/folder header, visible only to users with manage/author permissions. | Evaluates native permission flags (`write`, `edit_content`, `create`). |
| **Folder Authoring** | Creates child folders with title, description, and template selection (Default `dtpl_0` or Hidden `dtpl_5`). | Scrapes fresh folder creation form; submits `form/input_0/input_1` and template choice to `ilObjFolderGUI`. |
| **File Authoring** | Uploads and registers new files with titles, descriptions, and licenses. | Two-step flow: chunked temporary upload via `ilObjFileUploadHandlerGUI` followed by metadata commit. |
| **Shared Sorting** | Reorders files and folders for all course participants using drag-and-drop or accessible keyboard controls. | Scrapes native sorting form; commits updated order via `position[ref_id]` and `cmd[saveSorting]`. |
| **Impact-Reviewed Deletion** | Safely deletes selected materials; preflights deletion to display recursive impacts before final confirmation. | Retrieves native confirmation screen to inspect affected resources, then confirms via `cmd[delete]`. |
| **Page-Editor Handoff** | Distinguishes repository objects from page-layout elements (COPage), providing a direct native handoff when page layout edits are needed. | Deep-links to native ILIAS COPage editor with session preservation. |

---

## 2. Workflows & Formats (How-To Guide)

### 2.1 Entering and Navigating Management Mode
1. When viewing a course or folder where you have editing rights, click **Manage this page** in the header.
2. The view shifts into management mode under the current breadcrumb path:
   - Content rows display selection checkboxes, drag handles, and up/down reorder buttons.
   - The management toolbar exposes **Add content**, **Delete selected**, and **Save order**.
3. Navigating into a child folder keeps management mode active within that child folder's scope without cross-container writes.

### 2.2 Adding Files and Folders
1. Click **Add content** in the management toolbar.
2. The unified catalogue organizes options by user intent:
   - **Materials and Activities (Repository Objects)**:
     - *Folder*: Enter title, description, and template. BetterIlias queries the fresh ILIAS form for available templates (Default or Hidden).
     - *File*: Select a file, specify title/description and license. BetterIlias executes a two-phase upload (temporary file upload handler followed by metadata commit).
   - **Text and Layout (Page Elements)**:
     - Explains the distinction between repository objects and page layout elements, providing an explicit handoff to native ILIAS COPage tools for complex multi-column/accordion layouts.

### 2.3 Shared Item Sorting
1. Move items using drag-and-drop handles or keyboard accessible **Move Up** / **Move Down** buttons.
2. BetterIlias tracks the unsaved dirty order locally. Navigation away from the page, exiting management mode, or destructive actions trigger a navigation guard prompting to save or discard changes.
3. Clicking **Save order** submits `position[ref_id]` mappings to ILIAS via `cmd[saveSorting]`. On success, the fresh verified order is reflected immediately across all participants.

### 2.4 Safe Deletion with Impact Preflight
1. Select one or more items using the row checkboxes (or click a row's trash icon).
2. Click **Delete selected**.
3. BetterIlias queries the native ILIAS deletion form and renders a **Deletion Impact Modal**:
   - Shows the exact resources that will be removed.
   - Warns if deleting a folder will recursively remove child files or sub-folders.
4. After explicit confirmation, BetterIlias posts to the live ILIAS confirmation endpoint.

---

## 3. Architecture & Technical Constraints (Explanation)

### 3.1 The Two Native Storage Models
In ILIAS, there are two fundamentally different ways content is structured:
1. **Repository Objects**: Files, folders, exercises, forums, and modules. They have unique reference IDs (`ref_id`), access permissions, and lifecycles.
2. **COPage Elements**: Text blocks, sections, columns, carousels, and media embeds placed directly on a container's overview page.

BetterIlias makes this distinction transparent:
- File and folder creation manages **Repository Objects**.
- Complex page-layout structuring (COPage) provides an intentional, authenticated handoff to the native editor rather than simulating an error-prone partial page editor.
- Deleting a folder deletes its repository contents; removing a COPage element from a page does not delete the underlying repository file.

### 3.2 Dynamic Form Discovery & CSRF Protection
BetterIlias never hardcodes ILIAS form URLs, tokens, or command structures:
- Creation, sorting, and deletion workflows fetch the live native ILIAS forms dynamically.
- CSRF tokens, `rtoken`, and structural hidden inputs are captured dynamically and submitted with exact encoding.
- Multi-row inputs like `id[]` and `position[ref_id]` use multi-value serialization to avoid losing repeated field values.

### 3.3 Concurrency & Locking
- Sorting and deletion operations verify that the target container's current state has not changed concurrently before committing writes.
- Write actions on shared VPS deployments utilize shared local file locks (`backend/services/shared_lock.py`) to prevent concurrent race conditions across tenant worker threads.

---

## 4. Source Code & API Reference

- **Frontend Component**: [`frontend/src/components/CourseManagement.tsx`](../frontend/src/components/CourseManagement.tsx)
- **Backend Scrapers**:
  - Management & Deletion: [`backend/scrapers/management.py`](../backend/scrapers/management.py)
  - Authoring & Creation: [`backend/scrapers/authoring.py`](../backend/scrapers/authoring.py)
- **Backend Services**:
  - Management Service: [`backend/services/management.py`](../backend/services/management.py)
  - Authoring Service: [`backend/services/authoring.py`](../backend/services/authoring.py)
- **API Endpoints** ([`backend/api/routes/materials.py`](../backend/api/routes/materials.py)):
  - `GET /materials/{ref_id}/management` — Scrapes management rows, permissions, and sort controls.
  - `POST /materials/{ref_id}/deletion-review` — Preflights deletion and retrieves affected items.
  - `POST /materials/{ref_id}/batch/delete` — Submits confirmed deletion to ILIAS.
  - `POST /materials/{ref_id}/order` — Submits updated `position[ref_id]` order.
  - `GET /materials/{ref_id}/authoring-context` — Discovers available creation options and templates.
  - `POST /materials/{ref_id}/folders` — Creates a new folder on ILIAS.
  - `POST /materials/{ref_id}/files` — Commits a new file upload.

---

## Appendix: Retained Historical Notes & Native Evidence

*(The material below preserves early protocol investigations and source references from development.)*

### Native Evidence and Source References
- Native behavior was verified against ILIAS release 10 source:
  - [ILIAS Object Deletion](https://github.com/ILIAS-eLearning/ILIAS/blob/release_10/components/ILIAS/ILIASObject/classes/class.ilObjectGUI.php)
  - [Container Sorting and Management](https://github.com/ILIAS-eLearning/ILIAS/blob/release_10/components/ILIAS/Container/classes/class.ilContainerGUI.php)
- Saved reference fixtures from initial development:
  - Folder creation form: `form/input_0/input_1` for title, `form/input_0/input_2` for description, `form/input_3` for template choice (`dtpl_0` default, `dtpl_5` hidden).
  - File creation form: `ilObjFileUploadHandlerGUI` temporary upload followed by metadata save.
  - Container sorting: `cmd[saveSorting]` with `position[ref_id]` mapping.
