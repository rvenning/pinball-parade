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
shells, gears, clouds), stand-up and drop targets and their letters, rollovers,
spinners, saucers and locks, gates (the drawbridge, the temple door, the plunger
flap), the pendulum diverter, ramp tracks and their entry arrows, kickback lights,
wind/current arrows, the ball, and every objective ring. A background may *paint
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
| `characters/dragon.png` | 240 × 140 | transparent | castle toy, asleep; drawn in the box centred on logical (184, 118), 120 × 70 |
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

Characters sit on layer 2, under every rail and target: the dragon's box overlaps
the two dragon targets at logical y 166–178, which are always drawn on top.

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
