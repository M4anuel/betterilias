# TODO

Unfinished work only. Current behavior and limitations are recorded in the
[support inventory](docs/ILIAS_SUPPORT_MATRIX.md). Design details belong in the
linked feature plans; completed changes remain in Git history.

## Course and folder management

Design: [unified management plan](docs/UNIFIED_MANAGEMENT_PLAN.md).

- [ ] Verify repository deletion and shared ordering against controlled live
  ILIAS test content; committed fixtures/mocks do not replace live acceptance.
- [ ] Add exercise-container creation and open the existing assignment editor
  afterwards.
- [ ] Add native weblink and item-group creation.
- [ ] Add native rename/title/description editing for supported objects.
- [ ] Add native move, copy and reference-link workflows with a destination picker.
- [ ] Add an optional move-to-parent/evacuation flow before folder deletion;
  verify each move and never delete after a partial evacuation.
- [ ] Add native selected-item ZIP download and trash/restore workflows where
  ILIAS exposes supported forms.
- [ ] Extend management to additional repository types once their permission,
  confirmation and verification paths are implemented.
- [ ] Add native page-element creation/editing/removal and resource placement to
  the unified catalogue, replacing the current explicit ILIAS editor handoff.
- [ ] Support complete review of currently refused paginated/unsupported folder
  trees without assuming that a partial listing is empty.
- [ ] Identify remaining TA workflows that should be available in BetterIlias.

## Repository object coverage and rendering

The inventory lists all 30 catalogue types and the exact current support.

- [ ] Recognize all 30 types explicitly from native icons, permalinks and GUI
  classes; reduce heuristic `other`/incorrect-type fallbacks.
- [ ] Add distinct localized labels/icons/badges for types throughout material
  views, beyond their existing catalogue labels.
- [ ] Add readers for content pages (`copa`), glossaries (`glo`) and ILIAS
  learning modules (`lm`).
- [ ] Add HTML-module asset resolution/viewing (`htlm`) and SCORM/AICC runtime
  support (`sahs`).
- [ ] Add data-collection tables/details/filtering (`dcl`) and literature-ordering
  status handling (`xds2`).
- [ ] Add interactive-video behavior (`xvid`) and media-pool browsing (`mep`).
- [ ] Add dedicated item-group (`itgr`) and learning-sequence (`lso`) workflows.
- [ ] Add blog (`blog`), wiki (`wiki`) and Etherpad (`xpdl`) workflows, plus
  a dedicated group workspace (`grp`).
- [ ] Add instructor question-pool browsing for tests (`qpl`) and surveys
  (`spl`), and portfolio-template preview (`prtt`).
- [ ] Add native poll (`poll`), survey (`svy`) and self-evaluation (`xsev`)
  participation/results workflows.
- [ ] Continue preserving custom lecturer layouts and page-element edge cases,
  with sanitized examples and regressions for each supported shape.

## Podcast player

Design and retained stream findings:
[native dual-stream player plan](docs/PODCAST_PLAYER_PLAN.md).

- [ ] Resolve episode streams/roles/renditions and slide frames on demand into
  a typed model with session/media-expiry handling.
- [ ] Synchronize presenter audio/camera and slides through playback, seeking,
  rate changes, buffering and quality changes.
- [ ] Add picture-in-picture, side-by-side and screen-swap layouts.
- [ ] Add independent slide/camera quality and bandwidth-saving viewing.
- [ ] Add slide/chapter navigation from native frame timestamps.
- [ ] Validate supported single-/dual-stream recordings and fallback behavior
  before marking native dual-stream playback as implemented.
