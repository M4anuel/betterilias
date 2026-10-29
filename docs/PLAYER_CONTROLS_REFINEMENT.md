# Player controls refinement

## Refined implementation prompt

Refine the shared podcast/embedded-video player without changing its audio roles
or synchronization. Reserve the video area during authenticated stream resolution
and media loading, and display a reduced-motion-aware skeleton until usable video
frames are available. Keep the canvas geometry stable while the recording loads.
Use a default 16:10 canvas with a larger vertical allowance; cap it to the visible
viewport and retain the minimum phone canvas size needed for touch controls.

Move play/pause, seek, volume and playback speed into a translucent overlay over
the video. Reveal it on pointer movement, tap or keyboard focus. Hide it after
2.5 seconds of inactivity during playback or when the pointer leaves a paused
video; retain it while buffering, scrubbing, opening settings or operating
controls by keyboard. Hidden controls must not intercept
pointer events or remain in the keyboard tab order. Keep touch and keyboard entry
available after hiding. Preserve native dropdown usability and fullscreen access.

Replace the separate slide collection with an 8 px seek track containing chapter
markers at actual frame timestamps. Show the corresponding chapter thumbnail and
target timestamp while hovering or dragging, and commit a drag seek on release.
Keep the native range accessible by keyboard, with Page Up/Down navigation between
slides. Constrain previews at either edge. Use a straight volume track with a
44 px hit area and normal keyboard input. Dim the speaker's outer wave at 50%
volume and below, and its inner wave at 15% and below; keep mute visually distinct.
Put independent stream quality controls in a scrollable overlay
settings popover. Use three SVG layout buttons and a stream-switch button that
works in inset, split and single view. Keep the audio-bearing source unchanged
when changing the visible stream.

Handle Space, F, M and C throughout the open player as play/pause, canvas-only
fullscreen, mute and subtitle toggles. Suppress repeated key-down toggles and
native Space key-up button activation. Keep native slider/select arrows and Tab
navigation. Canvas taps/clicks toggle playback with a briefly growing/fading
central icon, respecting reduced motion. Capture the canvas gesture before newly
revealed controls can retarget a touch click. Fullscreen contains the canvas and
its own overlays, not the page or recording dialog header.

Remove persistent reload and bandwidth-saver actions. Keep retry available only
for errors, and move the exact native episode link below its Stream button in
the recording list.

Verify German/English and light/dark mode at phone, tablet, desktop and short
landscape sizes. Exercise delayed loading, native slider dragging, preview
selection, seek synchronization, inactivity hiding, tap reveal, keyboard focus,
speed/volume changes and fullscreen using real local media decoding.

## Implementation and verification

The shared player uses the existing `frameList` image URLs; it does not fetch or
build a second chapter collection. Native range inputs retain keyboard and touch
behavior. Compact previews on phones and short viewports leave the timeline
and control hit areas in place throughout dragging. Layout changes do not
unmount the media elements or reset playback state.

Playback position is saved in browser storage per session, series `ref_id` and
episode `eid`, independently of routing nodes, request tokens and signed CDN
URLs. It is checkpointed at five-second intervals and on play, pause, seeking,
quality changes, closing, visibility changes and page exit. Records also retain
the last play-start time and update time. Reopening restores both streams to the
saved position while paused; an ended recording starts from zero. Saved positions
are clamped to the actual media duration. Unavailable storage and malformed
records do not block playback. Progress is local to this browser/session and is
not synchronized to ILIAS or another device.

Native Paella caption metadata is passed through for WebVTT and SubRip tracks.
The authenticated caption endpoint re-resolves the native manifest, limits hosts
to ILIAS and the university Opencast domain, refuses redirects, caps content at
2 MiB, normalizes SRT timestamps to WebVTT, and returns private/no-store text.
A blob-backed hidden native text track supplies cues from the audio clock. Cue
text is rendered as escaped React text over the canvas, so subtitles remain
visible when the audio source is hidden or the visible stream is switched.
Settings expose the supplied language labels. C reports missing tracks instead
of inventing captions. The supplied saved recording has no subtitle tracks;
caption rendering is verified with synthetic WebVTT. Native manifest background
is recorded in [Opencast's caption discussion](https://github.com/opencast/opencast/issues/4407).

`tests/test_player_browser.py` checks delayed API/media loading geometry, timeline
markers and keyboard slide seeks in all four language/theme combinations at
320/390/430/768/1280 px and 740 × 360 landscape. Focused phone/desktop checks drag
the native slider, verify the selected thumbnail before seeking on release,
operate the volume range by keyboard, and test inactivity, touch and keyboard
reveal with controlled browser clocks. Screenshots cover the skeleton, loaded
controls and drag preview. These are Chromium viewport/touch emulations with a
synthetic H.264/AAC clip, not physical-device or live ILIAS validation.
Additional language/theme cases cover all shortcuts, repeat suppression, canvas
taps with visible/hidden overlays, animated-feedback lifetime, subtitle toggles
and language changes, quality menus, swapping in every layout, actual fullscreen
element identity, and Escape/focus restoration.
Resume regressions reopen a recording after changing its routing tokens, verify
tenant isolation and completion reset, and check 16:10 geometry and speaker wave
thresholds at phone, tablet, desktop and short landscape sizes.
