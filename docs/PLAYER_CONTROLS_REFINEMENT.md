# Player controls refinement

## Refined implementation prompt

Refine the shared podcast/embedded-video player without changing its audio roles
or synchronization. Reserve the video area during authenticated stream resolution
and media loading, and display a reduced-motion-aware skeleton until usable video
frames are available. Match the loading placeholders to the responsive settings
layout, including translated buttons that wrap on narrow phones.

Move play/pause, seek, volume and playback speed into a translucent overlay over
the video. Reveal it on pointer movement, tap or keyboard focus. Hide it after
2.5 seconds of inactivity during playback; retain it while paused, buffering,
scrubbing or operating controls by keyboard. Hidden controls must not intercept
pointer events or remain in the keyboard tab order. Keep touch and keyboard entry
available after hiding. Preserve native dropdown usability and fullscreen access.

Replace the separate slide collection with an 8 px seek track containing chapter
markers at actual frame timestamps. Show the corresponding chapter thumbnail and
target timestamp while hovering or dragging, and commit a drag seek on release.
Keep the native range accessible by keyboard, with Page Up/Down navigation between
slides. Constrain previews at either edge. Give the volume range a tapered cone
that grows from low to high volume while preserving a 44 px hit area and normal
keyboard input. Keep independent stream quality/layout controls below the video.

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

`tests/test_player_browser.py` checks delayed API/media loading geometry, timeline
markers and keyboard slide seeks in all four language/theme combinations at
320/390/430/768/1280 px and 740 × 360 landscape. Focused phone/desktop checks drag
the native slider, verify the selected thumbnail before seeking on release,
operate the volume range by keyboard, and test inactivity, touch and keyboard
reveal with controlled browser clocks. Screenshots cover the skeleton, loaded
controls and drag preview. These are Chromium viewport/touch emulations with a
synthetic H.264/AAC clip, not physical-device or live ILIAS validation.
