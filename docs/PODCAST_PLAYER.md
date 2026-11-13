# Native Dual-Stream Podcast Player

BetterIlias provides an integrated, native dual-stream video player for university Opencast and Paella recordings. It allows students to watch readable high-resolution lecture slides alongside synchronized lecturer audio and camera video directly in BetterIlias without third-party plugins.

---

## 1. Capabilities & Feature Matrix

| Capability | What BetterIlias Does | Technical Guarantee |
| :--- | :--- | :--- |
| **Dual-Stream Sync** | Concurrently streams high-res presentation slides and lecturer camera video. | The audio-bearing stream (`role: "mainAudio"`) drives the master clock; video drift is actively corrected if it exceeds 300 ms. |
| **3 Layout Modes** | Offers Inset (Picture-in-Picture), Responsive Split View, and Single Stream View. | Switching layouts never resets playback state or unmounts underlying HTML5 video elements. |
| **Stream Swapping** | Swaps primary and secondary streams with a single click in any layout mode. | The unmuted lecture microphone stream remains active regardless of which stream is visually dominant. |
| **Chapter & Slide Navigation** | Displays an interactive seek track with chapter markers from Paella `frameList` metadata. | Hovering or dragging reveals thumbnail previews with timestamps; seeking synchronizes both video streams. Page Up / Page Down jumps between slides. |
| **Independent Quality Selection** | Allows setting camera and slides resolutions independently (e.g. 1080p slides + 480p camera to save bandwidth). | Low camera resolution never degrades slide legibility or lecture audio quality. |
| **Subtitles & Captions** | Renders WebVTT/SRT subtitles in an overlay over the video canvas. | Subtitles remain visible even when the audio-bearing video element is hidden or swapped. |
| **Local Playback Checkpointing** | Saves playback position per session and episode every 5 seconds and on pause/exit. | Resuming an episode restores the exact position paused; completed recordings start from the beginning. |
| **Keyboard & Touch Accessibility** | Full keyboard shortcuts (`Space`, `F`, `M`, `C`, `PageUp`, `PageDown`) and responsive touch controls. | Overlay controls auto-hide after 2.5s of inactivity during playback and reveal immediately on pointer move, tap, or focus. |

---

## 2. Controls & Interaction Guide (How-To)

### 2.1 Keyboard Shortcuts

| Key | Action | Behavior |
| :--- | :--- | :--- |
| `Space` | Play / Pause | Toggles playback. Native button activation and repeated key-down toggles are suppressed. |
| `F` | Fullscreen | Enters canvas-only fullscreen (targets the video canvas and overlays, not the browser window or recording header). |
| `M` | Mute / Unmute | Toggles audio mute while maintaining volume level memory. Speaker icon waves reflect volume (dimmed outer wave $\le$ 50%, dimmed inner wave $\le$ 15%). |
| `C` | Captions / Subtitles | Toggles subtitle overlay on/off. Reports available languages or informs if no subtitles are attached. |
| `Page Up` / `Page Down` | Previous / Next Slide | Seeks directly to the previous or next chapter frame marker on the timeline. |
| `Left` / `Right` Arrow | Seek ±5 seconds | Steps forward or backward by 5 seconds on the active timeline. |
| `Escape` | Exit / Close | Exits fullscreen if active; otherwise closes the player dialog and restores keyboard focus to the launching button. |

### 2.2 Layout & Stream Controls
- **Picture-in-Picture (Inset View)**: Presentation slides fill the main canvas with the camera stream in a floating inset corner window.
- **Split View**: Side-by-side display of slides and presenter, scaling responsively to viewport aspect ratio.
- **Single View**: Maximizes either slides or camera to full size.
- **Stream Swap Button**: Interchanges which stream is primary and which is secondary in all three layouts.

### 2.3 Timeline & Chapter Scrubbing
- The seekbar features tick marks corresponding to actual slide changes extracted from Paella's `frameList`.
- Hovering or dragging along the timeline displays a 288 px thumbnail preview (scaled down to 192 px on narrow phones) showing the slide at that timestamp.
- Dragging commits the seek only on pointer release, preventing buffer churn during scrubbing.

---

## 3. Architecture & Technical Constraints (Explanation)

### 3.1 Opencast Paella Stream Extraction
When a student launches a recording:
1. `GET /api/courses/video-stream-info?url=...` contacts ILIAS with the tenant's authenticated session.
2. `backend/scrapers/player.py` extracts the JSON configuration passed to `il.Opencast.Paella.player.init(...)` without executing JavaScript in a headless browser:
   - Identifies stream renditions (`1080p`, `720p`, `480p`) and URLs from `dist.opencast.unibe.ch`.
   - Identifies stream roles: `content: "presenter"` with `role: "mainAudio"` vs. `content: "presentation"`.
   - Converts metadata duration from milliseconds to seconds.
   - Extracts chapter slide frames from `frameList` with second-precision timestamps and thumbnail URLs.
3. The response is returned with `Cache-Control: private, no-store`. No video media or episode files are downloaded by the backend; video bytes stream directly from the university Opencast CDN to the user's browser.

### 3.2 Dual-Stream Synchronization Model
Running two concurrent `<video>` elements in HTML5 presents drift and audio race conditions:
- **Master Audio Clock**: Only the stream marked `mainAudio` is unmuted; the second stream is permanently muted. The playback clock of the unmuted stream serves as the single source of truth.
- **Active Drift Correction**: Both streams monitor their current playback time. If the secondary video drifts by more than 300 ms relative to the audio clock, its `currentTime` is adjusted to re-align.
- **Synchronized Intent**: Play, pause, seek, and playback rate changes are executed synchronously on both video elements. If either stream enters buffering, both pause until sufficient buffer is available, with a 20-second timeout safety guard.

### 3.3 Aspect Ratio & Viewport Containment
- The video canvas reserves a stable **16:10 aspect ratio** during authenticated resolution and media buffering, preventing layout shifts.
- A reduced-motion-aware skeleton placeholder displays until video frames are ready to render.
- The canvas height is capped to the visible viewport to prevent off-screen controls on short landscape or phone viewports.

### 3.4 Captions & Subtitle Security
Subtitle tracks are proxied via `GET /api/courses/video-captions`:
- The backend re-resolves the native manifest under the user's session.
- Restricts allowed hosts strictly to ILIAS and university Opencast domains, refusing external redirects.
- Enforces a 2 MiB content limit.
- Normalizes SRT timestamps to standard WebVTT format.
- Rendered in a React overlay positioned over the video canvas so subtitles remain readable across stream swaps and single-stream views.

---

## 4. Source Code & API Reference

- **Frontend Component**: [`frontend/src/components/PodcastPlayer.tsx`](../frontend/src/components/PodcastPlayer.tsx)
- **Backend Scraper**: [`backend/scrapers/player.py`](../backend/scrapers/player.py)
- **Backend API Endpoints** ([`backend/api/routes/materials.py`](../backend/api/routes/materials.py)):
  - `GET /api/courses/video-stream-info` — Resolves Opencast Paella stream configuration, renditions, and chapter frames.
  - `GET /api/courses/video-captions` — Validates and proxies WebVTT / SRT subtitle tracks.
  - `GET /api/podcasts/{ref_id}` — Lists series episodes and metadata.
- **Automated Tests**:
  - `tests/test_player.py` — Parser verification for Paella initializer, streams, renditions, and frameList.
  - `tests/test_player_browser.py` — Chromium browser tests covering dual-stream sync, chapter seek, keyboard shortcuts, layout swapping, and mobile viewports.

---

## Appendix: Retained Research Findings & Historical Baseline

*(The notes below preserve inspected stream characteristics from initial development.)*

- Inspected recording baseline: `xoctPlayerGUI` action `streamVideo` with series `ref_id` and episode `eid`.
- Observed rendition file sizes on a sample 1080p lecture recording:
  - Presenter/Camera stream: ~1,078 MB at 1080p, ~716 MB at 720p, ~443 MB at 480p.
  - Audio bitrate: ~129 kbps stereo for 720p/1080p, ~65 kbps mono for 480p.
- Slide frames extracted from `frameList` with `{ id, time, url, mimetype }`.
