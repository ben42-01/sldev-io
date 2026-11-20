# sldev-io promo video

A 136-second advert that tells the sldev-io story over music. Every scene is animated in code with
[Remotion](https://www.remotion.dev): React components rendered frame by frame to MP4. Nothing is
screen-recorded, so it stays sharp at 1080p, and you can re-render after every change to the app or
the site. Colours, fonts, the logo, the tagline and the URL come from the website
(`website/src/styles.css` and `website/src/content/site.json`). When those change,
render again.

```bash
cd marketing/promo
npm ci
npm run studio          # live preview in the browser, scrub the timeline
npm run render          # out/sldev-io-promo.mp4, no sound
npm run music           # public/music.mp3: an original placeholder track (see Music)
npm run render:music    # with public/music.mp3
```

## The story (68 bars at 120 BPM = 136 s)

After the intro the story follows the developer's loop in four chapters: **Plan → Build → Review → Ship**. Each
chapter opens on a downbeat with its title slamming in out of a flash (`Chapter` in `src/ui.tsx`); the camera
then flies through the word into the scene. Inside a scene a `Camera` (keyframed zoom, pan and 3D tilt, with a
slow handheld drift) pushes into whatever is happening, a `Spotlight` dims the window around the moment that
matters and labels it, and a `SceneTag` top left names the feature ("02 BUILD · MISSION CONTROL"). A scene says at
most three lines, each held long enough to read while you watch.

| Bars | Scene | Says |
|---|---|---|
| 9 | Intro | Terminals pile up, captions centred over them ("One agent feels like *magic*" … "one has been waiting *since lunch*"), the pile becomes a whirlpool around "Coding agents got good. Keeping track of them *didn't*", and on the drop the mark is born. |
| 7 | 01 Plan · Board | An agent writes three stories into Proposed, you approve them, auto pick-up starts them (one waits for its dependency), a merged PR moves its card to Done. |
| 6 | 02 Build · Mission Control | Every agent in its own worktree; Codex needs you, one click, cards walk to Ready. |
| 6 | Lead missions | One agent delegates to three vendors (Codex routed by your evals), sends work back, merges, one branch for you. |
| 7 | Software Factory | A recipe as a graph: approval, parallel agents, a failing test loops back, the PR waits for your click. |
| 4 | Failover | Claude hits its usage limit; Codex continues on the same branch. |
| 6 | 03 Review · Review cockpit | Review by purpose: noise folded, an extra sent back, and a hunk the walkthrough didn't claim (`SKIP_AUTH`) is still shown. |
| 5 | Evals | The grid fills, the leaderboard sorts, Lead missions on `auto` route to the winner. |
| 8 | 04 Ship · montage | Commit graph, code map, Recap standup, the CLI, then a 3D wall of everything else. |
| 5 | Agents | A slot lands each supported agent name (from `site.json`), then: not an IDE, runs on your machine, free and open source. |
| 5 | Call to action | Download free, open source, platforms, URL. |

Scene lengths and chapters live in `src/timeline.json`, which both the video (`src/Promo.tsx`) and the music
script read: change a scene's bars there and the soundtrack's arrangement follows. Cuts zoom through (the
outgoing scene keeps going for 8 frames under the incoming one). The Lead, Factory and Failover scenes scale
their beats (`bt`) to fit the bars they were given.

**Type**: Roboto Thin carries the story (the intro's captions, the turn, the tagline; `story()` in `src/lib.ts`, which
takes Roboto Light below 72px so a hairline doesn't vanish) and Inter carries the product (headlines over the UI, the
wordmark, the chapter titles). Coloured words are always set like the wordmark and the website's `.brand-text`: Inter
bold, upright, in the brand gradient (`ACCENT` in `src/ui.tsx`), so a line is thin story and bold brand. In a line,
`*starred words*` get that accent: one accent per line at most. The intro's captions are centred over the pile of
terminals, on a dark pool that keeps them readable. `STORY_FONTS.mono` (JetBrains Mono Light) is the code-style
alternative: switch `STORY` to it.

## The CLI video (35 bars = 70 s)

A second composition, `CliPromo`, tells the `sldev` CLI's story in the same style: `src/cli/timeline.json`,
scenes in `src/cli/Scenes.tsx`, and the TUI drawn by `src/cli/Tui.tsx`, which follows `cli/src/render.ts` and the
website's mockup (`website/src/cli/TerminalMockup.tsx`) by eye. Its tagline, agents and version come from
`website/src/cli/cli.json` and `cli/package.json`. Both films run on `src/Film.tsx` (scenes in bars, chapters,
cuts that zoom through).

```bash
npm run music:cli       # public/music-cli.mp3 from src/cli/timeline.json
npm run render:cli      # out/sldev-cli-promo.mp4, with that music
```

| Bars | Scene | Says |
|---|---|---|
| 4 | Open | A plain shell: three `sldev new --agent … --worktree` commands, then `sldev`. |
| 6 | 01 Run · tabs | Every agent in a tab; Codex needs you (desktop notification), Ctrl-b 2, 1, it carries on; Gemini is ready. |
| 4 | Worktrees | The branch and diff stat on each pane; Ctrl-b v shows the changes side by side. |
| 3 | 02 Recover · failover | Claude hits its usage limit; `--failover` continues the task on Codex in a new pane, same worktree. |
| 4 | Repeat | `--repeat 4 --check "npm test"`: a commit per pass, a failing check handed to the next pass. |
| 5 | 03 Delegate · conductor | An `--allow-spawn 3` pane starts three agents, waits, merges their branches, runs the tests; nothing pushed. |
| 2 | Scripting | `sldev wait 2 --for needs-you && sldev send 2 "yes"`. |
| 3 | Agents | Every agent from `cli.json`; no account, no telemetry, free and open source. |
| 4 | Call to action | The tagline, Apache-2.0, works next to the app, `npm i -g sldev-cli` and the /cli URL. |

When a command, flag or key in the CLI changes, change the scene that shows it: the video should never show
something `sldev` doesn't do.

## Music

The video is timed in bars of a **120 BPM** track (`BPM` in `src/lib.ts`), so every cut lands on a downbeat.
`npm run music` synthesises an original track from `src/timeline.json` (`scripts/make-music.cjs`, about 30 s):
anti-aliased supersaws through a resonant filter, a layered kick the rest of the mix pumps against, a Freeverb and
a ping-pong delay, a hook that comes in when the agents start building, half-time and a new progression for the
Review chapter, and a snare fill, riser and impact into every chapter. It's made from scratch, so you can use it
freely; it comes out at about -14 LUFS, YouTube's level.

A produced track still sounds better. To use one:

1. Pick a royalty-free, upbeat track around 120 BPM that you may use in adverts. YouTube Audio Library,
   Pixabay Music and Uppbeat are free; Artlist and Epidemic Sound are paid. Keep the licence.
2. Save it as `public/music.mp3`. Audio files are git-ignored, because most licences don't allow
   redistributing the track.
3. If the first downbeat isn't at 0:00, trim the start (`ffmpeg -ss 0.42 -i in.mp3 public/music.mp3`).
   If the tempo isn't 120, set `BPM` to the track's tempo: every scene scales with it. The chapters land
   on bars 9, 15, 34 and 43, so look for a track whose drops come every 8 or 16 bars.
4. Run `npm run render:music`. The track fades in and out at the edges.

## Notes

- **Remotion licence**: free for individuals and companies of up to 3 people. Bigger teams need a
  company licence (remotion.pro).
- `remotion.config.ts` passes the JSX setting to Remotion's bundler itself, because Remotion reads
  it through TypeScript's `sys` API and TypeScript 7 doesn't expose that.
- The mock UI follows the app (`src/renderer/src/styles/app.css`) and the website's mockups. When a
  screen changes in the app, update its scene so the advert doesn't promise an old UI.
