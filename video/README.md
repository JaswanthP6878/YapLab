# YapLab video (Remotion)

Parts 1–2 of the 3-minute video, Purpose and Design, as a [Remotion](https://www.remotion.dev/) composition. The live demo (Part 3) is a screen recording appended after this. The full script is in [`docs/demo-video-script.md`](../docs/demo-video-script.md).

```bash
npm install
npm run studio             # preview and scrub in the browser
npm run render             # out/yaplab-intro.mp4 (1920×1080, 30 fps, 90 s, captions on)
npm run render:nocaptions  # same, without burned-in captions
npm run still              # out/still.png at frame 500, for a quick look
npm run banner             # ../docs/assets/yaplab-banner.png, the README banner
```

## How it's put together

| File | What it holds |
|---|---|
| `src/scenes.ts` | **Scene order, lengths, and captions**: the one place to change timing or wording |
| `src/Intro.tsx` | Lays the scenes out in sequence with fades and captions |
| `src/scenes/Purpose.tsx` | `Alone`, `Wall`, `Brand`, `ForWho` |
| `src/scenes/Design.tsx` | `Swarm`, `Personas`, `Orchestrator`, `Grounding`, `Moderator`, `Voices` |
| `src/components.tsx` | Board background, captions, cards, chips, and the animated `Student` |
| `src/theme.ts` | The app's palette and fonts (Instrument Serif, Hanken Grotesk, IBM Plex Mono, Caveat) |
| `src/Banner.tsx` | The README banner (`Banner` still) and the logo mark |

The students are the app's own `Avatar` and `Icon` components and `PERSONAS` data, imported from `../frontend/src`, so the intro matches the demo footage. `remotion.config.ts` points those imports at this package's React, so the frontend's dependencies don't need to be installed.

Changing a scene's length in `src/scenes.ts` moves every later scene and updates the total duration automatically; animation delays inside a scene are in frames from that scene's start.

## Adding the demo

Render the intro, record the demo, then append it:

```bash
./join.sh path/to/demo.mp4         # writes out/yaplab.mp4
```

The intro has no audio track, so `join.sh` lays silence under it and scales the demo to 1920×1080 at 30 fps, whatever it was recorded at. If you record a voice-over for the intro, add it in an editor instead (or mix it onto `out/yaplab.mp4`).
