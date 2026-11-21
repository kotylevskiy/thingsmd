# Cover walkthrough recording kit

The published light and dark walkthroughs run for 127.833 seconds at 24 fps with the same cuts and chapters. The source footage was recorded in Obsidian 1.14.4 with ThingsMD 0.8.1 and the Things theme 2.2.6. The example dates in the original walkthrough use November 21, 2026 as today.

The Quick Capture scene was re-recorded in both appearances with **Buy some milk**, using the original cut length.

- `capture-*.mjs` contains the scripted UI actions, the synthetic vault fixtures, the cursor placement, and the deliberate waits.
- `cut-frames.json` gives the edited duration of every shot in frames. The file keys are in playback order.
- `original-light.json` and `original-dark.json` preserve the original frame timestamps and action cues. `startFrame / 24` gives the start time on the final timeline. Each cue's `time` is local to the source shot, before editing.
- `render.mjs` preserves the shot order, framing, zoom, subtitle placement, and timing adjustments. The final WebM, MP4, posters, and shared chapter track are in [docs/assets](../../docs/assets).

## Record a new take

1. From the repository root, install the project dependencies and build ThingsMD. Create a fresh, marked vault with `npm run dev:vault`, with `TMPDIR` pointing to a directory inside the repository. Set `THINGSMD_TEST_VAULT` to the resulting path.
2. Start a separate Obsidian instance, with its profile inside the repository and remote debugging on localhost. Open the marked vault, set `THINGSMD_DEBUG_URL` to its debugging endpoint, then run `npm run deploy` and `npm run dev:open`. The global capture scene uses Finder and requires macOS Accessibility permission for the program invoking AppleScript.
3. Stage the Things theme's `manifest.json` and `theme.css` in `artifacts/documentation-preview/official-things-theme/`. The theme comes from [colineckert/obsidian-things](https://github.com/colineckert/obsidian-things). The SHA-256 hashes below identify the files used in the original recording.

   | File | SHA-256 |
   | --- | --- |
   | `manifest.json` | `ab5058fb55a089d19685b225340535779aa44d1384e1e825af8615c41ab6d0d3` |
   | `theme.css` | `529d20f9a979850b7e6b48205d8a52d1b7ee80063e2a787cfbba87ac08dddeb1` |

4. Run the drivers in sequence for each theme. The fixture dates are relative to the recording date. The playback timing stays fixed by the edit even when the app takes a different amount of time to respond.

   ```sh
   THINGSMD_RECORDING_THEME=light sh recordings/cover/capture.sh
   THINGSMD_RECORDING_THEME=dark sh recordings/cover/capture.sh
   ```

## Render and review

Use FFmpeg with H.264 and VP9 support (the original render used FFmpeg 8.0), and Playwright WebKit for subtitle rasterization. Install the browser inside the repository with `PLAYWRIGHT_BROWSERS_PATH` set to a repo-local path. Use `THINGSMD_RECORDING_WEBKIT` to point to a specific WebKit executable and `THINGSMD_RECORDING_PLAYWRIGHT` to supply its matching Playwright module as an absolute module path if needed.

```sh
export THINGSMD_RECORDING_THEME=light
node recordings/cover/render.mjs
take="artifacts/screencast/replay-rendered-$THINGSMD_RECORDING_THEME"
ffmpeg -i "$take/cover-screencast.mp4" -map 0:v:0 -c:v libvpx-vp9 \
  -b:v 0 -crf 28 -deadline good -cpu-used 5 -row-mt 1 -tune-content screen \
  -pix_fmt yuv420p -an "$take/cover-screencast.webm"
```

Add `--original` to the render command to use the original local PNG takes listed in the scene logs. Those source frames and intermediate outputs live in the ignored `artifacts/screencast/` directory. A clean checkout can recapture footage from the scripts. It needs the original PNG takes as well to re-render the historical capture. The published videos preserve the final historical footage.

Review the output under `artifacts/` before replacing the site files. The light files use the `-light` suffix. The site shares a single chapter track, so verify that new cuts stay aligned across both variants.

For the rendered Jekyll site, run `node scripts/test-documentation.mjs` while the local preview is running. Set `THINGSMD_DOCS_URL` if it uses a different address. The check verifies the light and dark screenshot sets, their size limits, the video and poster selections, and internal links.
