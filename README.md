# Pinball Parade

**Let the story roll.** A storybook pinball adventure where every table is a
miniature mechanical world and every shot moves the story on. Five worlds, twenty
chapters, each a little pinball story told in phases — ring the bells, lower the
drawbridge, wake the dragon and chase it across the sky — plus free play on every
table and a Daily Parade for the family leaderboard.

## Play it

**https://rvenning.github.io/pinball-parade/**

Portrait, phone or tablet. Installs as an app (Add to Home Screen) and works offline.

## Features

- **Five tables, five shapes.** Each world has its own layout and signature
  mechanisms on a shared lower playfield, so the flipper skill carries over:
  the castle's drawbridge and flying dragon; the temple's central stairs behind
  two toppling stones and the idol's eye; the sea's current and whirlpool (no
  ramp — the water moves the ball); the workshop's pendulum and clockwork door
  that ticks open and shut; the clouds that drift and the rainbow lane.
- **Twenty stories.** A chapter is a setup, 4–8 phases and a finale — a hurry-up
  jackpot, a timed frenzy or two-ball play. Only the current phase is lit, every
  phase changes the table, and the length comes from new shots, never from padded
  counts. Stars: tell the story, win the side quest, beat the score.
  See [`docs/STORY-DESIGN.md`](docs/STORY-DESIGN.md).
- **Designed pacing, measured.** Intro chapters take 2–4 minutes, middle ones 4–7,
  each world's finale 6–10, and nothing under a minute — asserted with the bots
  and checked with real-time real-touch play; the app logs each player's real
  times (`?debug=1` → pacing report).
- **Kind to small players.** Every new phase brings a ball save and relit
  kickbacks; middle chapters have 4 balls and finales 5; a game that runs out of
  balls leaves a checkpoint, and the next carries the story on from there. No
  score can ever block progress, and a genuinely stuck ball is nudged and then
  returned for free.
- **Real pinball underneath.** A fixed 1/480 s step, tunnel-proof micro-stepping,
  tapered flippers with true surface speed, pop bumpers, slingshots, stand-up and
  drop targets, lane change, spinners, ramps, one-way and clockwork gates, a
  pendulum, moving targets and bumpers, wind, current and whirlpool fields,
  saucers, ball locks and two-ball multiball.
- **Parade meter.** Bumper chains fill it; a parade is ten seconds of double points
  with a march.
- **Free play and the Daily Parade** are the optional skill layer: every mechanism
  awake, no mercy post, family leaderboard. No shop and no currency, on purpose —
  getting better at the table is the only upgrade.
- **Controls.** Hold the left or right half of the lower table (true multi-touch);
  tap or hold Launch. Keys: ← → / A D, Space, P.
- Reduced-motion aware, sound toggle, pause on tab hide with no physics jump,
  landscape fallback message.

## Built on gamekit

Profiles and PINs, family sync, the leaderboard, sounds, the version line and the
install button all come from [gamekit](https://github.com/rvenning/gamekit),
vendored into `lib/`. To update it:

```
node ../gamekit/tools/sync-to-game.js .
node lib/tools/stamp-version.js . --bump
```

## Code

No build step: plain scripts in load order.

| File | Role |
|---|---|
| `js/physics.js` | capsule/circle/flipper collision, one resolver — no DOM, no randomness |
| `js/tables.js` | the five tables as data: one vocabulary of elements, shared lower playfield |
| `js/chapters.js` | the twenty chapter stories, their pacing bands, free play and the Daily Parade |
| `js/game.js` | `Sim`: ball lifecycle, the story (phases, bonus, checkpoints), movers, scoring, locks — cloneable plain state |
| `js/render.js` | layered Canvas renderer drawing the same element data |
| `js/input.js` | multi-touch, mouse and keys → three booleans |
| `js/assets.js` | optional illustrated art with procedural fallbacks |
| `js/storage.js`, `js/audio.js`, `js/main.js` | gamekit wiring and app flow |
| `js/shots.js` | debug-only screenshot director (`?shot=…`) |

## Art pipeline

The visuals are a coherent greybox-plus, **not final art**. The renderer draws in
explicit layers (base, scenery, rails, mechanisms, ball/effects, foreground, HUD)
and every decorative layer can be replaced by a PNG in `assets/` without touching
geometry or gameplay. See [`assets/ART-BRIEF.md`](assets/ART-BRIEF.md) for sizes,
the safe region, filenames and per-world palettes;
[`docs/geometry/`](docs/geometry/) has an 800×1440 registration overlay per table
and [`docs/screenshots/`](docs/screenshots/) the current captures.

- `?shot=<table>&hide=ball,fx,hud` — an empty table; `&layers=bg,scenery` or
  `&layers=rails,mech` — one half of the drawing; `?debug=1` — a toggle per layer.
- `node tools/scan-assets.js` — validate art and write `assets/available.json`.
- `node tools/export-geometry.js` — regenerate the overlays after a table change.
- `node tools/shots.js` — recapture the screenshots (headless Edge, 390×844 @2×).

## Tests

```
node --test                 # 54 tests: physics, table + story lint, pacing, bots, storage
node tools/e2e.js           # trusted touch in headless Edge; plays chapter 1 to the end (server on :8133)
PP_REPORT=1 node --test tests/pacing.test.js   # minutes per chapter, per phase, stars
node tools/shot-rates.js castle 20             # hits per minute on every mechanism, per bot
node tools/balance.js 1 20 5                  # times, scores, stars and score-target suggestions
```

- **Physics:** exact contacts, restitution, resting, tunnelling at ten times the
  speed cap, rising flippers, cradle-and-flip power, stuck-ball rescue that leaves
  slow rolling alone, byte-identical replays.
- **Table lint:** no pinch gaps or overlapping solids, every plunger strength
  reaches the table, a ball dropped anywhere drains unaided (no traps, no stable
  orbits) with every door shut and again with everything open and moving, movers
  never pinch at any point of their sweep, no saucer juggles its own eject, ramp
  exits feed a flipper, weak shots roll back. Every chapter is walked phase by
  phase against the table it changes: nothing aimed at what is hidden or shut, no
  padded counts, no phase repeating the one before, a special finale.
- **Pacing:** every chapter played as the family plays it (carrying on from
  checkpoints) lands in its band, no phase takes over half a chapter, every star is
  earnable and none is free, and nobody tells chapter 1 in under a minute.
- **Bots, all on the real engine:** an idle control, an enthusiastic masher, a
  delayed and distractible child, a quicker older child, and a planner that clones
  the game to choose flip timings and aims at whatever the story has lit. The child
  tells every story of the first two worlds on every seed, the older child the whole
  book, the planner everything it tries; better players tell the same story faster.

## Local development

```
npx http-server . -p 8133 -c-1
```

## Storage

localStorage prefix `pbp_`; Firestore collection `pinballparade` in the shared
family project (the public API key is restricted and safe to ship). Progress keeps
best stars and score per chapter, best free-play score per table, the day's Daily
Parade and lifetime counters — all monotonic, merged by max — plus the pacing log
(time to each chapter's first clear, written once) and the newest checkpoint. `?debug=1` and the
screenshot director never write progress.
