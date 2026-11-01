# LeetCode Cat Celebration 🐱🎉

A Chrome extension (Manifest V3) that makes a cat pop out from the bottom of
the screen — with confetti poppers, sparkles and a synthesized "meow" — whenever
your code passes on LeetCode (submission accepted or run test cases pass).

## Install

1. Open `chrome://extensions` (Edge: `edge://extensions`, Brave: `brave://extensions`).
2. Enable **Developer mode** (toggle in the top-right corner).
3. Click **Load unpacked** and select this folder (`leetcode-cat-celebration/`).
4. Open any problem on [leetcode.com](https://leetcode.com) and submit (or run)
   some passing code. The cat appears from the bottom-right corner.

Click the extension's toolbar icon for two toggles: celebrate on/off and sound
on/off (saved with `chrome.storage.sync`).

## How it works

- `page-hook.js` runs in the page's main world (`"world": "MAIN"`) and patches
  `fetch` / `XMLHttpRequest` to watch LeetCode's `/check/{submission}/` polling
  endpoint. A response with `status_code: 10` / `status_msg: "Accepted"` is
  re-broadcast as a `lc-cat:accepted` DOM event. This is the primary trigger and
  covers both **Submit** (all test cases pass) and **Run** (sample cases pass).
- `content.js` (isolated world) listens for that event and also runs a
  `MutationObserver` fallback that detects a fresh green "Accepted" label on
  problem pages, in case the API shape changes.
- Deduplication: celebrated submission IDs are remembered and a 12-second
  cooldown prevents repeated triggers while LeetCode keeps polling.
- The celebration renders inside a shadow DOM host (`z-index: 2147483647`,
  `pointer-events: none`), so it never interferes with the page. The cat is
  inline SVG, the poppers are a `<canvas>` confetti simulation, and the meow is
  synthesized with the Web Audio API (no audio files, no network access).
- Audio follows browser autoplay rules: the context is warmed up on your first
  click/keypress on the page, and the meow is held until then if needed.

## Customization

In `content.js`:

- `COOLDOWN_MS` — minimum gap between celebrations (default 12s).
- `CELEBRATION_MS` — how long the cat stays (default 4.3s).
- `COLORS` (inside `runConfetti`) — confetti/popper colors.
- `playMeow()` — pitch (`baseHz`) and length (`dur`) of the meow.
- The cat's fur color is the `#FCA64D` fill in `CAT_SVG`.

## Notes & permissions

- Only needs the `storage` permission (for the two toggles). No network access,
  no tracking, nothing leaves your browser.
- Targets `leetcode.com`; the free-tier UI is what the DOM fallback was tuned
  against. If LeetCode redesigns something and the API hook stops firing, the
  "Accepted" text observer is the safety net.
- Firefox: MV3 with `"world": "MAIN"` is supported in recent Firefox versions;
  load it via `about:debugging` → **Load Temporary Add-on** → `manifest.json`.
