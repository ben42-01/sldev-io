# sldev-io promo video

A 90-second advert that tells the sldev-io story over music. Every scene is animated in code with
[Remotion](https://www.remotion.dev): React components rendered frame by frame to MP4. Nothing is
screen-recorded, so it stays sharp at 1080p, and you can re-render after every change to the app or
the site. Colours, fonts, the logo, the tagline, the price and the URL come from the website
(`website/src/styles.css`, `website/src/content/site.json` and `pricing.json`). When those change,
render again.

```bash
cd marketing/promo
npm ci
npm run studio          # live preview in the browser, scrub the timeline
npm run render          # out/sldev-io-promo.mp4, no sound
npm run music           # public/music.mp3: an original placeholder track (see Music)
npm run render:music    # with public/music.mp3
```

## The story (44 bars at 120 BPM = 88 s)

| Bars | Scene | Says |
|---|---|---|
| 5 | Chaos | Nine terminals pile up, one per beat: "Claude Code in one terminal. Codex in another…" "…and one has been waiting since lunch." |
| 2 | Turn | "Coding agents got good. Keeping track of them didn't." |
| 2 | Logo | The mark draws itself: sldev-io, the terminal-first workspace for agentic coding. |
| 8 | Missions | Mission Control: four agents in their own worktrees; Codex needs you, one click, the cards walk to Ready. |
| 5 | Review | The diff, then Commit / Merge / Open PR. |
| 8 | Factory | A recipe as a graph: spec approval, two agents in parallel, a failing test loops back, the PR waits for your click. |
| 5 | Failover | Claude hits its usage limit; Codex continues with the same task and branch. |
| 5 | Agents | Every supported CLI, then: not an IDE, no new AI subscription, no telemetry. |
| 4 | Call to action | Free trial, the price paid once, platforms, URL. |

Scenes live in `src/scenes/`, their order and length in bars in `src/Promo.tsx`, and the brand pieces
(window, status pills, pointer, toasts) in `src/ui.tsx`.

## Music

The video is timed in bars of a **120 BPM** track (`BPM` in `src/lib.ts`), so every cut lands on a
downbeat. `npm run music` synthesises an original placeholder track (`scripts/make-music.cjs`: four-on-the-floor
in A minor, a build over the chaos, a breakdown on the turn, the drop on the logo, a final hit on the call to action).
It's made from scratch, so you can use it freely, but it's a placeholder: a produced track sounds better. To use one:

1. Pick a royalty-free, upbeat track around 120 BPM that you may use in adverts. YouTube Audio Library,
   Pixabay Music and Uppbeat are free; Artlist and Epidemic Sound are paid. Keep the licence.
2. Save it as `public/music.mp3`. Audio files are git-ignored, because most licences don't allow
   redistributing the track.
3. If the first downbeat isn't at 0:00, trim the start (`ffmpeg -ss 0.42 -i in.mp3 public/music.mp3`).
   If the tempo isn't 120, set `BPM` to the track's tempo: every scene scales with it.
4. Run `npm run render:music`. The track fades in and out at the edges.

## Notes

- **Remotion licence**: free for individuals and companies of up to 3 people. Bigger teams need a
  company licence (remotion.pro).
- `remotion.config.ts` passes the JSX setting to Remotion's bundler itself, because Remotion reads
  it through TypeScript's `sys` API and TypeScript 7 doesn't expose that.
- The mock UI follows the app (`src/renderer/src/styles/app.css`) and the website's mockups. When a
  screen changes in the app, update its scene so the advert doesn't promise an old UI.
