# Pinball Parade — art brief

The game is complete and playable with **no files in this folder at all**: every
piece is drawn in code. This brief describes the optional illustration pass that
replaces the *decorative* layers. Nothing here can change how the game plays, and
a missing or wrong-sized file never breaks anything — the code drawing simply
stays.

**Status of the current visuals: greybox-plus, not final.** Materials, palette
and hierarchy are in place so the game is coherent to play; authored
illustration is deliberately left for a specialist.

## 1. How images get into the game

1. Put files in the folders below with **exactly** these names and sizes.
   **Opaque art is JPEG, transparent art is PNG** — a painted 720×480 card is
   about 1 MB as PNG and about 100 KB as JPEG, and the family plays on phones.
   `node tools/optimise-art.js` makes the game-weight derivatives (JPEG cards,
   400×400 mascots) from the full-size sources in `../pinball-parade-art-source`
   using headless Edge's own resampler; keep the sources there, not here.
2. Run `node tools/scan-assets.js`. It checks every name and pixel size and writes
   `assets/available.json`. Only files listed there are ever requested, so a
   misnamed or wrong-sized image is reported and ignored rather than shipped.
3. Reload. Anything present replaces its procedural fallback; anything absent
   keeps it. Art is never part of the service worker's install: after install
   it caches whatever `available.json` lists one file at a time, so a failed
   image can never stop the game working offline.

No code change is needed for any file in this brief.

## 2. Coordinates and the safe region

- The table is a fixed **logical 400 × 720** field (y down). Art is authored at
  **2×: 800 × 1440 px**, so logical `(x, y)` is pixel `(2x, 2y)`.
- The **safe gameplay region** is the inside of the table shell: a stadium shape
  from x = 14 to 386, whose top is an elliptical arc centred (200, 214) with radii
  186 × 190 (apex at y = 24), running straight down both sides to the bottom.
  Everything the ball can reach is inside it.
- `docs/geometry/<table>.svg` is an **800 × 1440 registration overlay** for each
  table: safe region green, solids red, sensors dashed blue, ramps orange,
  characters purple. `docs/geometry/<table>.json` has every element's numbers.
  Both are generated from `js/tables.js` by `node tools/export-geometry.js`, so
  they can never disagree with the physics.
- `docs/screenshots/layers-<table>-base.png` and `…-mechanisms.png` show the two
  halves of the current drawing separately, for registering new art against.

## 3. Layers

The renderer draws, bottom to top:

| # | Layer | Replaceable by | Notes |
|---|---|---|---|
| 1 | base material | `table-backgrounds/<id>.jpg` | opaque, fills the whole 800×1440 |
| 2 | non-interactive scenery | same image, plus `characters/*.png` | the background image replaces the procedural motif entirely |
| 3 | rails and collision mechanisms | **never** | always code |
| 4 | interactive targets and objective states | **never** | always code |
| 5 | ball and gameplay effects | **never** | always code |
| 6 | foreground frame / occlusion | `table-foregrounds/<id>.png` | transparent; must be fully transparent inside the safe region |
| 7 | HUD | DOM | not part of the canvas |

**Must stay procedural (they communicate collision or state):** walls and rails,
slingshots, posts and the save post, flippers, bumpers (pop bumpers, the idol,
shells, gears, the drifting clouds), stand-up and drop targets and their letters
(the temple stones, totems, pearls, T-I-C-K, S-T-A-R), rollovers, spinners (the
prayer wheel, the weathervane), saucers and locks (the Keep, the idol's eye, the
whirlpool's sink, the chest, the toybox, the sky castle), gates (the drawbridge,
the clockwork door, the plunger flap), the pendulum, ramp tracks and their entry
arrows, kickback lights, wind/current arrows, the whirlpool's spiral, the ball,
and every objective ring.

**Things that MOVE.** The story can set these moving, so nothing painted may sit
where they travel: the castle dragon (its target flies 80 logical px either side
of its perch at (250, 164)), the three Cloud Kingdom bumpers (two drift ±30 at
y 232, one ±50 at y 302) and the workshop pendulum. The registration overlays draw
each mover at both ends of its sweep, dashed purple. A background may *paint
around* them — stone under the bells, a lawn under the flippers — but must never
paint a shape that looks like a rail or a target where there is none, and must
never draw one of these baked in.

**Readability rules for layers 1–2:** keep the playfield's value range in the
middle-dark band so cream rails, coral rubbers and the ivory ball stay the
brightest things on the table. No bright, saturated or high-contrast detail
within 20 px (logical 10) of any red line in the registration overlay. Avoid
anything round and enamel-like that could be mistaken for a bumper, and anything
long, thin and brass that could be mistaken for a rail.

## 4. Files

| File | Size (px) | Alpha | Used for |
|---|---|---|---|
| `logo/logo.png` | 1200 × 600 | transparent | splash title (replaces the typeset logo) |
| `world-cards/castle.jpg` | 720 × 480 | opaque | world card in the book |
| `world-cards/temple.jpg` | 720 × 480 | opaque | |
| `world-cards/sea.jpg` | 720 × 480 | opaque | |
| `world-cards/workshop.jpg` | 720 × 480 | opaque | |
| `world-cards/clouds.jpg` | 720 × 480 | opaque | |
| `table-backgrounds/castle.jpg` | 800 × 1440 | opaque | layers 1+2 |
| `table-backgrounds/temple.jpg` | 800 × 1440 | opaque | |
| `table-backgrounds/sea.jpg` | 800 × 1440 | opaque | |
| `table-backgrounds/workshop.jpg` | 800 × 1440 | opaque | |
| `table-backgrounds/clouds.jpg` | 800 × 1440 | opaque | |
| `table-foregrounds/castle.png` | 800 × 1440 | transparent | layer 6: cabinet frame outside the safe region |
| `table-foregrounds/temple.png` | 800 × 1440 | transparent | |
| `table-foregrounds/sea.png` | 800 × 1440 | transparent | |
| `table-foregrounds/workshop.png` | 800 × 1440 | transparent | |
| `table-foregrounds/clouds.png` | 800 × 1440 | transparent | |
| `characters/dragon.png` | 240 × 140 | transparent | castle toy, asleep; drawn in the box centred on logical (250, 118), 120 × 70 (its perch over the gatehouse; once awake it flies 80 either side, so draw it facing left and keep it self-contained) |
| `characters/dragon-awake.png` | 240 × 140 | transparent | the same box, awake |
| `characters/automaton.png` | 80 × 120 | transparent | workshop toy, run down; box centred on (58, 300), 40 × 60 |
| `characters/automaton-awake.png` | 80 × 120 | transparent | marching |
| `characters/mascot-castle.png` | 400 × 400 | transparent | results screen after a castle game |
| `characters/mascot-temple.png` | 400 × 400 | transparent | results after the temple |
| `characters/mascot-sea.png` | 400 × 400 | transparent | results after the deep sea |
| `characters/mascot-workshop.png` | 400 × 400 | transparent | results after the workshop |
| `characters/mascot-clouds.png` | 400 × 400 | transparent | results after the clouds |
| `characters/mascot.png` | 400 × 400 | transparent | results fallback for a world without its own mascot |
| `ui/paper.jpg` | 512 × 512 | opaque, tileable | menu paper texture (reserved) |

Characters sit on layer 2, under every rail and target. The dragon RIDES its
target: its box moves with it, so both frames must be self-contained sprites
(no scenery baked around them), facing left, with the target — always drawn on
top — just under its chin at logical y 156–172.

**Layouts changed on 2026-09-25** (the chapters became stories, and each table
got its own shape). Moonlight Castle gained the Keep saucer and the flying
dragon; the Jungle Temple is now built round central stairs with two stones in
their mouth, the idol's eye under the vine lanes, totems on the left wall and
the prayer wheel across the right orbit; the Deep Sea has a reef row of shells and
a whirlpool top centre; the Clockwork Workshop has its gear train across the top,
the T-I-C-K letters below it and the toybox on the right above the conveyor; the
Cloud Kingdom has drifting clouds and a rainbow lane up the right-hand side. The
backgrounds still pass `tools/audit-art.js`, but anything painted to sit "under"
a mechanism should be checked against the new `docs/geometry/<table>.svg`.

## 5. Worlds

Shared material language: warm painted wood, embossed paper, polished brass
rails, enamel bumpers, soft felt shadows. Charming and theatrical, not babyish.
Shared palette: midnight blue `#121c3a`, warm cream `#f6ecd6`, brass `#d9a441`,
coral red `#e0604f`, moss green `#5f8b4c`, small cyan magic `#72e6f2`.

| World | id | Felt (top → bottom) | Motif and silhouette |
|---|---|---|---|
| Moonlight Castle | `castle` | `#223463` → `#121c3a` | towers and battlements, a crescent moon, stars; the sleeping red dragon on the upper wall. Friendly, first-night-at-the-theatre |
| Jungle Temple | `temple` | `#23452f` → `#10261a` | a stepped stone ziggurat behind the idol, hanging vines from the arch, gold and moss |
| Deep Sea | `sea` | `#14485e` → `#082333` | kelp rising from the lower corners, bubbles, coral; a sunken chest top right |
| Clockwork Workshop | `workshop` | `#4a3020` → `#24170d` | big faint gears, springs, a wind-up toy soldier; walnut and copper |
| Cloud Kingdom | `clouds` | `#435a98` → `#1f2b5a` | soft cloud banks, a low rainbow arc, a castle in the sky; dusk lavender, the finale |

The ball is ivory/silver with a cyan glint and must stay the brightest object on
every table.

## 6. Checking your work

- `?shot=<id>&hide=ball,fx,hud` shows an empty table; `&layers=bg,scenery` shows
  only what your background replaces; `&layers=rails,mech` shows only what it
  must sit under. `?debug=1` adds an on/off button for each layer.
- `node tools/shots.js` recaptures `docs/screenshots/` at 390 × 844, DPR 2.
- `node tools/audit-art.js` checks what a screenshot can't: every foreground pixel
  inside the safe region must be fully transparent, and the ivory ball must stay
  at least 3:1 against the brighter 5% of each background. Rails carry their own
  dark keyline and lights their own dark insert, so those stay readable on any
  paint — but keep cyan out of the playfield scenery, because cyan is the
  game's "hit this" colour.
