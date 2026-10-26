# TODO

Unchecked items are unfinished; completed work is listed separately below.

## Localisation

**Status:** Only the text inventory has been saved. The language selector,
translation catalogues, and build validation are not implemented yet.

- [ ] Add a language setting with German and English support.
- [ ] Move hardcoded user-facing text into translation files (for example,
  `translations.ts`) and look up the selected language when rendering it.
  Cover the app, user-facing server messages, and both Chrome and Firefox
  extension popups. Keep course titles and other content supplied by ILIAS
  as provided.
- [ ] Give each language an explicit fully supported or partially supported flag.
- [ ] Check translation completeness at compile/build time:
  - Fully supported languages must contain every translation key; missing entries
    must fail the build.
  - Partially supported languages may report warnings for missing entries, but
    must still build and run. Use English for missing translations without
    crashing the app or server.
- [ ] Verify language selection, translation coverage, build failures for
  incomplete fully supported languages, and English fallback for partial ones.

## ILIAS content and formatting

- [x] Preserve original ILIAS structure and formatting:
  - [x] Multi-column layouts (2-column flex rows rendered side-by-side).
  - [x] Section divider titles and accent colors (#d81e5b / #fb7185) preserved sequentially without merging.
  - [x] Embedded Opencast video playback directly in BetterIlias with fallback link to exact ILIAS folder.
  - [x] Full-height PDF embed containers.
  - [x] Responsive table wrappers and optimal reading measure (~68ch max width for prose).
- [ ] Continue preserving custom lecturer layouts and edge cases.

## Media & Podcast Streaming

- [ ] Native In-App Opencast Podcast Player with Dual-Stream Support:
  - [ ] Synchronized playback for presenter camera feed (with `mainAudio`) and presentation slides feed.
  - [ ] Viewing layouts: Picture-in-Picture (PiP), Side-by-Side (desktop split), and one-click screen swap.
  - [ ] Bandwidth Saver / Slides-Only Mode: Ability to set presenter video quality to lowest (480p) while keeping presentation slides at 1080p.
  - [ ] Slide chapter navigation using Opencast `frameList` thumbnails and timestamps.
  - [ ] Fast on-demand stream resolution for podcast episode IDs (`eid`).

### Technical Specification & Findings for Podcast Streaming
*(Reference dump inspected under `htmlfromilias/PodcastStreaming/`)*

1. **Episode URL & Player Initialization:**
   - Episodes in ILIAS point to:
     `https://ilias.unibe.ch/ilias.php?baseClass=ilobjplugindispatchgui&cmdClass=xoctPlayerGUI&cmd=streamVideo&ref_id=<ref_id>&eid=<eid>`
   - Requesting this page with authenticated session cookies returns an HTML payload containing:
     `il.Opencast.Paella.player.init(<config_json>);`

2. **Stream Structure & Audio Track Mapping:**
   - `<config_json>.streams` provides two synchronized MP4 streams:
     - **Stream 0 — Presenter Camera:** `content: "presenter"`, `role: "mainAudio"`. Contains the lecturer camera feed **and the primary AAC audio track** from the lecture hall microphone.
       - *1080p:* ~1,078 MB (Video ~1665 kbps, Audio 129 kbps AAC stereo 44.1 kHz)
       - *720p:* ~716 MB (Video ~1059 kbps, Audio 129 kbps AAC stereo 44.1 kHz)
       - *480p:* ~443 MB (Video ~668 kbps, Audio 65 kbps AAC mono 44.1 kHz — crystal clear voice quality, cuts data by ~60%)
     - **Stream 1 — Presentation/Slides:** `content: "presentation"`, `role: null`. Contains the projector / slides screen capture. Muted / video-only (854x480, 1280x720, 1920x1080).
     - **Bandwidth Optimization Tip:** When students only care about the presentation slides, BetterIlias can stream the 480p presenter feed for audio and the 1080p presentation feed for crisp slide text, saving over 600 MB of cellular/Wi-Fi bandwidth per lecture with zero loss in spoken audio comprehension.
   - **Stream Synchronization:** Both streams start at timestamp `t = 0.000` and have identical duration (`<config_json>.metadata.duration` in ms).
   - **CDN & Range Requests:** Streams are hosted on `https://dist.opencast.unibe.ch/...mp4`. They support standard HTTP byte-range requests (`HTTP 206 Partial Content`) and do **not** require cookies, credentials, or special CORS headers.

3. **Slide Timestamps & Thumbnails (`frameList`):**
   - `<config_json>.frameList` contains an array of slide change events:
     ```json
     [
       { "id": "frame_0", "time": 0, "url": "https://dist.opencast.unibe.ch/.../frame_0.jpg", "mimetype": "image/jpeg" },
       { "id": "frame_119", "time": 119, "url": "https://dist.opencast.unibe.ch/.../frame_119.jpg", "mimetype": "image/jpeg" }
     ]
     ```
   - Can be used directly in the UI as a chapter scrubber or slide sidebar.

4. **Frontend Dual-Video Sync Architecture:**
   - Use two HTML5 `<video>` elements:
     - Master video: Presenter (with sound unmuted).
     - Slave video: Presentation (muted to avoid potential audio conflicts/echo).
   - Sync logic:
     ```ts
     const syncPlayback = () => {
       if (Math.abs(presentationRef.current.currentTime - presenterRef.current.currentTime) > 0.3) {
         presentationRef.current.currentTime = presenterRef.current.currentTime;
       }
     };
     presenterRef.current.onplay = () => presentationRef.current?.play();
     presenterRef.current.onpause = () => presentationRef.current?.pause();
     presenterRef.current.onseeking = syncPlayback;
     presenterRef.current.ontimeupdate = syncPlayback;
     ```
   - Layout modes:
     - **Picture-in-Picture (Default):** Presentation full container width; presenter camera floating card in the bottom corner with a 1-click swap button.
     - **Side-by-Side:** 70% slides / 30% camera or 50/50 split on desktop screens.

## Teaching assistant tools

- [ ] Support creating folders.
- [ ] Support creating exercises.
- [ ] Identify remaining TA workflows that should be available in BetterIlias.

## Completed

- [x] Correct and grade exercise submissions.
- [x] Connect a phone using a QR code in the desktop app's top-right settings menu.
