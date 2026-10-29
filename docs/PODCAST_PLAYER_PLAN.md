# Native dual-stream podcast player plan

Status: **implemented for native Paella MP4 recordings**, with real-media
Chromium tests. Live authenticated ILIAS playback and physical mobile-device
acceptance remain open in [TODO](../TODO.md). Supported behavior and limits are
recorded in the [support inventory](ILIAS_SUPPORT_MATRIX.md).

## Goal

Let students watch readable lecture slides with synchronized lecturer audio and
an optional camera view inside BetterIlias. Support seeking by slide, switching
layouts and reducing camera bandwidth without degrading slide text.

## Evidence retained from the original TODO

The original findings came from saved HTML under
`htmlfromilias/PodcastStreaming/`. They describe inspected samples, not guaranteed
properties of every episode, CDN response or future ILIAS release.

- Episode links use the native `xoctPlayerGUI` `streamVideo` action with a series
  `ref_id` and episode `eid`. Resolve the authenticated native episode URL on
  demand rather than inventing or persisting a cmdNode.
- The sample player page initializes `il.Opencast.Paella.player.init(...)` with
  configuration containing `streams`, `metadata` and `frameList`.
- The sample presenter stream has `content: "presenter"` and `role: "mainAudio"`.
  It carries the lecture-hall microphone audio. The presentation/slides stream
  has `content: "presentation"` and no main-audio role.
- Sample renditions include camera/slides resolutions of 480p, 720p and 1080p.
  Both streams start together and report the same duration; metadata duration is
  expressed in milliseconds. Validate roles, units and timing on real episodes.
- `frameList` supplies slide-image URLs and timestamps in seconds, for example
  `{ "id": "frame_119", "time": 119, "url": "…/frame_119.jpg", "mimetype": "image/jpeg" }`.
- Sample MP4 URLs use `dist.opencast.unibe.ch`; byte-range delivery and playback
  without extra credentials were observed. Revalidate Range/CORS/authentication
  requirements and URL expiry rather than generalizing that observation.

One inspected lecture had approximate camera file sizes of 1,078 MB at 1080p,
716 MB at 720p and 443 MB at 480p. The listed camera audio was about 129 kbps
stereo for higher renditions and 65 kbps mono for the low rendition. These
measurements motivate keeping high-resolution slides with a lower-resolution
audio/camera source; they are not universal size or quality promises.

## Intended implementation

1. Resolve an episode into typed stream/rendition/audio-role data, duration,
   poster metadata and chapter frames. Keep protected resolution scoped to the
   authenticated session; handle unavailable/expired media and unsupported shapes.
2. Use two video elements with one playback clock and the audio-bearing stream
   unmuted. Mirror play/pause, seek and playback-rate changes; correct drift.
   The original prototype suggested a 300 ms drift threshold, which needs
   validation with buffering and real lecture recordings.
3. Offer slides-first picture-in-picture, side-by-side and a one-action swap.
   Choose slide/camera quality independently. Hiding the camera must preserve
   audio from the audio-bearing source.
4. Build a chapter/slide navigator from the actual frame timestamps. Seeking
   should move both streams consistently and preserve playback state.
5. Keep an exact native ILIAS fallback for unsupported configurations. Localize
   controls/errors, support keyboard/accessibility and dark mode, and handle
   rejected playback promises and one stream buffering/failing independently.

## Acceptance criteria

- A recording with two streams plays with one audio source and remains aligned
  after pause, seeking, rate changes, quality changes and buffering.
- A supported single-stream recording still works; missing chapters do not
  prevent playback.
- Low-camera/high-slides settings do not accidentally mute lecture audio.
- Chapter actions seek to the correct units/timestamps, including near the end.
- Native fallback, expired session/media and unavailable episodes have clear
  outcomes rather than a permanently loading player.
- Parser fixtures and browser/media tests cover the supported configurations
  before the inventory calls this native dual-stream support.

## Implementation and verification

- `backend/scrapers/player.py` decodes the JSON argument to the native Paella
  initializer without executing JavaScript. It retains audio roles, signed MP4
  rendition URLs and `frameList` times, and converts metadata milliseconds to
  seconds. Unsupported shapes are dumped through `safe_parser`.
- `/api/courses/video-stream-info` validates the ILIAS origin/player action,
  uses the tenant's authenticated client, checks session expiry before parsing,
  and returns a typed response with `Cache-Control: private, no-store`.
  No episode listing or media file is prefetched. Episode `eid` and native
  routing parameters come from the supplied link, never a fabricated cmdNode.
- `PodcastPlayer.tsx` is shared by episode Stream buttons and embedded course
  video launchers. Its native dialog traps focus, handles Escape and touch
  dismissal, restores focus, and fits the shared visible viewport styles.
  Course embeds no longer eagerly request every player page on course load.
- The audio-bearing stream drives the clock. Both streams pause during buffering,
  share seeks/rate changes, and correct drift above 300 ms. Rendition changes
  retain the clock, playback intent, rate and volume. The second stream is always
  muted. Rejected play promises and media failures have localised retry/fallback
  feedback, and buffering times out after 20 seconds.
- Picture in picture is an **in-player inset layout**, alongside responsive split
  and single views. All three icon-selected layouts support stream swapping.
  Selecting a single visible stream preserves the audio-bearing source. Quality
  options come from the recording and live in the overlay settings menu. The
  persistent bandwidth/reload buttons were removed; error states retain retry.
  Fullscreen targets the video canvas and its overlays, never the page/header.
  Space/F/M/C toggle playback, fullscreen, mute and available subtitles. Canvas
  taps toggle playback with short, reduced-motion-aware animated feedback.
- Chapter timestamps mark the timeline, with thumbnails displayed during hover
  and scrubbing instead of a separate slide collection. Keyboard Page Up/Down
  seeks between chapters. The translucent playback controls hide after inactivity
  while preserving touch and keyboard access, and loading skeletons reserve the
  video area. See [the refinement specification](PLAYER_CONTROLS_REFINEMENT.md).
  Single-stream recordings work without layout controls. Supported native WebVTT
  and SRT subtitles use the audio clock and render over every layout. HLS/DASH-only
  recordings, DFXP subtitles and OS-level picture in picture remain outside scope.
- The default canvas is 16:10 and uses more of the visible viewport height. A
  straight volume slider replaces the tapered track; speaker waves dim as volume
  decreases. Session/series/episode-scoped local checkpoints restore the last
  playback position without storing native routing tokens or signed stream URLs.
  Closing, hiding the page, seeking and pausing save immediately; playback saves
  at five-second intervals. Completed recordings reopen at the beginning.
- The portable Paella fixture retains the supplied stream/configuration structure
  and 42 chapter timestamps. Unneeded OCR/transcriptions and captions are omitted.
  `tests/fixtures/player-test.mp4` is a synthetic 12-second H.264/AAC test clip
  generated using FFmpeg's `testsrc2` and `sine` sources, not lecture footage.
- Browser tests decode this local clip via byte-range responses and cover both
  languages/themes at 320/390/430/768/1280 px and short landscape. They exercise
  actual play/pause, seeking, rates, quality changes, layouts, focus and fallback.
  Targeted checks also inject buffering/drift, playback rejection and media errors.
  These are Chromium viewport/touch emulations, not physical-device validation.
- Read-only checks of the supplied sample's 480p camera and 1080p presentation
  URLs each returned HTTP 206 and `video/mp4` for a 1 KiB range request. Native
  authenticated episode resolution encountered `SessionExpiredError` in the
  existing local session. Renewed-session live playback, long-recording drift,
  CDN expiry behavior and real iOS/Android acceptance still need validation.
- Player settings now persist across recordings and reloads per session. The
  recordings dialog remembers title/date and ascending/descending sort choices.
  Explicit upload-date metadata takes priority over recording dates; the saved
  real pages expose only recording dates, so the control explains that fallback.
  Backend responses include canonical date timestamps for chronological sorting,
  while older cached responses retain a bilingual recording-date fallback.
  Undated episodes stay last in either direction; titles sort naturally.
