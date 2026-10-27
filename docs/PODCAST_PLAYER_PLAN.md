# Native dual-stream podcast player plan

Status: **planned**, not the current playback implementation. Open tasks are in
[TODO](../TODO.md); existing episode discovery, native-stream links and limited
embedded MP4 playback are recorded in the
[support inventory](ILIAS_SUPPORT_MATRIX.md).

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
