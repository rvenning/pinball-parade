# Pinball Parade

**Let the story roll.** A storybook pinball adventure where every table is a
miniature mechanical world and every shot moves the story on. Five worlds, twenty
chapters, three objectives each — ring the bells, lower the drawbridge, wake the
dragon — plus free play on every table and a Daily Parade for the family
leaderboard.

## Play it

**https://rvenning.github.io/pinball-parade/**

Portrait, phone or tablet. Installs as an app (Add to Home Screen) and works offline.

## Features

- **Five tables, one feel.** Moonlight Castle, Jungle Temple, Deep Sea, Clockwork
  Workshop and Cloud Kingdom each have their own layout and mechanisms on a shared
  lower playfield, so the flipper skill learned on the first table carries over.
- **Twenty chapters.** Each shows three short objectives before play and keeps
  them as icon chips during it. The first opens the next chapter; stars come from
  the second and from the third *or* a generous score. Completing an objective
  changes the table — the drawbridge comes down, the dragon wakes, the chest opens.
- **Kind to small players.** Early chapters raise a post between the flippers,
  relight the outlane kickbacks quickly and give a long ball save; a chapter whose
  story is told wraps itself up after three minutes. No score can ever block
  progress, and a genuinely stuck ball is nudged and then returned for free.
- **Real pinball underneath.** A fixed 1/480 s step, tunnel-proof micro-stepping,
  tapered flippers with true surface speed, pop bumpers, slingshots, stand-up and
  drop targets, lane change, spinners, ramps, one-way gates, a swinging diverter,
  wind and current fields, saucers, ball locks and two-ball multiball.
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
| `js/chapters.js` | the twenty chapters, free play and the Daily Parade |
| `js/game.js` | `Sim`: ball lifecycle, objectives, scoring, parade, locks — cloneable plain state |
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
node --test                 # 41 tests: physics, table lint, balance bots, storage
node tools/e2e.js           # trusted-touch first run in headless Edge (server on :8133)
PP_REPORT=1 node --test tests/bot.test.js   # per-chapter balance tables
node tools/balance.js 1 20 3               # the full bot matrix
```

- **Physics:** exact contacts, restitution, resting, tunnelling at ten times the
  speed cap, rising flippers, cradle-and-flip power, stuck-ball rescue that leaves
  slow rolling alone, byte-identical replays.
- **Table lint:** no pinch gaps or overlapping solids, every plunger strength
  reaches the table, a ball dropped anywhere drains unaided (no traps, no stable
  orbits), ramp exits feed a flipper, weak shots roll back, objectives name real
  mechanisms, concepts arrive one at a time, the art brief matches the code.
- **Bots, all on the real engine:** an idle control, an enthusiastic masher, a
  delayed and distractible child, a quicker older child, and a planner that clones
  the game to choose flip timings. The child finishes the first two worlds on every
  seed, the older child the whole book, the planner everything; the planner scores
  far above both children.

## Local development

```
npx http-server . -p 8133 -c-1
```

## Storage

localStorage prefix `pbp_`; Firestore collection `pinballparade` in the shared
family project (the public API key is restricted and safe to ship). Progress keeps
best stars and score per chapter, best free-play score per table, the day's Daily
Parade and lifetime counters — all monotonic, merged by max. `?debug=1` and the
screenshot director never write progress.
