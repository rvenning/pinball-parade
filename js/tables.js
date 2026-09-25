// Table registry — the fixed GEOMETRY of the five worlds, as plain data.
//
// Nothing here knows about chapters, objectives or art. Each table is a list
// of elements from one small vocabulary; the physics compiles them into
// capsules and circles, the renderer draws them on the same centre lines, and
// tests/tables.test.js lints them. A chapter (js/chapters.js) never moves a
// rail — it only switches state on elements that already exist here (a gate
// closed, a target hidden, a lock lit).
//
// Vocabulary (every element has a unique `id`; `group` ties it to objectives):
//   wall     { pts:[[x,y]…], r }                 rail/wall, a chain of capsules
//   post     { x, y, r, stateful? }              passive round post
//   bumper   { x, y, r, kick, group, look }      pop bumper
//   sling    { pts:[A,B,C], face:[i,j], kick }   slingshot; edge i→j kicks
//   target   { a, b, r, group, letter? }         stand-up target (solid, counts hits)
//   drop     { a, b, r, group, letter? }         drop target (falls when hit)
//   rollover { x, y, r, group }                  switch the ball rolls over (sensor)
//   spinner  { a, b }                            sensor line; spins by crossing speed
//   orbit    { a, b, dir:[x,y] }                 sensor line counting crossings along dir
//   ramp     { mouth:[a,b], enter:[x,y], minSpeed, speed, path:[…], exit:{x,y,vx,vy} }
//   saucer   { x, y, r, hold, eject:[vx,vy] }     captures, holds, kicks out; can be a lock
//   gate     { a, b, r, oneWay?:[nx,ny], timed?:{period, closed} }
//   arm      { x, y, len, r, a0, amp, period }   moving diverter, angle = f(time)
//   field    { rect:[x0,y0,x1,y1], ax, ay, pulse?:{period, on} }   wind / current
//   kickback { x, y, r }                          outlane saver (sensor)
//   toy      { x, y, look, w, h }                 story character: no collision at all
//
// Coordinates: logical 400×720, y down. Playfield x 14…354 is mirror-symmetric
// about CX = 184; the plunger lane is x 354…386 on the right.

const TABLE_W = 400, TABLE_H = 720;
const CX = 184;
const mx = (x) => 2 * CX - x;
const mp = (pts) => pts.map(([x, y]) => [mx(x), y]);

function arcPts(cx, cy, rx, ry, a0, a1, n) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + (a1 - a0) * (i / n);
    out.push([+(cx + rx * Math.cos(a)).toFixed(2), +(cy + ry * Math.sin(a)).toFixed(2)]);
  }
  return out;
}

// The shared lower playfield and cabinet shell. Every table uses it
// unchanged, so the flippers, slings, inlanes and drain behave identically in
// every world — the skill the player builds on Moonlight Castle transfers.
function baseElements() {
  const top = arcPts(200, 214, 186, 190, Math.PI, 2 * Math.PI, 30);
  return [
    { id: "shell", type: "wall", r: 3, pts: [[70, 712], [14, 600], ...top, [386, 712]] },
    { id: "laneFloor", type: "wall", r: 3, pts: [[354, 712], [386, 712]] },
    { id: "laneWall", type: "wall", r: 3, pts: [[354, 250], [354, 712]] },
    { id: "slantR", type: "wall", r: 3, pts: [[354, 600], [298, 712]] },
    // One-way flap at the top of the plunger lane: the launch passes up
    // through it; a ball coming down the right orbit rolls off it into play.
    { id: "laneGate", type: "gate", r: 3, a: [386, 222], b: [354, 250], oneWay: [-0.659, -0.753] },

    // Orbit returns: a ball coming down either side wall is carried into the
    // inlane and onto its flipper, as on a real table. Without them every
    // plunge orbited, ran down the left wall and fell straight into the
    // outlane. The outlane is still open below each return's lower end.
    { id: "returnL", type: "wall", r: 3, pts: [[14, 372], [24, 410], [36, 440], [50, 466]] },
    { id: "returnR", type: "wall", r: 3, pts: mp([[14, 400], [24, 432], [36, 452], [48, 468]]) },
    { id: "guideL", type: "wall", r: 3, pts: [[46, 500], [46, 604], [109.2, 638.5]] },
    { id: "guideR", type: "wall", r: 3, pts: mp([[46, 500], [46, 604], [109.2, 638.5]]) },
    { id: "slingL", type: "sling", pts: [[78, 520], [78, 584], [110, 606]], face: [0, 2], kick: 330 },
    { id: "slingR", type: "sling", pts: mp([[78, 520], [78, 584], [110, 606]]), face: [0, 2], kick: 330 },
    { id: "kickL", type: "kickback", x: 30, y: 588, r: 10 },
    { id: "kickR", type: "kickback", x: mx(30), y: 588, r: 10 },
    // Rises between the flippers in the gentlest chapters.
    { id: "savePost", type: "post", x: CX, y: 700, r: 10, stateful: true },
  ];
}

const FLIPPERS = [
  { id: "L", x: 112, y: 648, len: 62, r0: 10, r1: 6, rest: 0.5236, up: -0.4538 },
  { id: "R", x: mx(112), y: 648, len: 62, r0: 10, r1: 6, rest: Math.PI - 0.5236, up: Math.PI + 0.4538 },
];

const PLUNGER = { x: 370, y: 700, lane: [354, 386], ready: 660 };

// A right-hand ramp channel (castle, workshop, clouds) and its mirror.
function rightRamp(id, exitSide) {
  const ex = exitSide === "L" ? 62 : mx(62);
  const path = exitSide === "L"
    ? [[294, 305], [312, 250], [322, 190], [312, 130], [280, 84], [230, 60], [170, 60], [114, 80], [78, 124], [60, 190], [56, 270], [56, 380], [ex, 486]]
    : [[294, 305], [312, 250], [322, 190], [320, 260], [ex, 486]];
  return [
    { id: id + "W1", type: "wall", r: 3, pts: [[252, 358], [280, 288]] },
    { id: id + "W2", type: "wall", r: 3, pts: [[288, 372], [316, 302]] },
    { id: id + "Cap", type: "wall", r: 3, pts: [[280, 288], [316, 302]] },
    {
      id, type: "ramp", mouth: [[272.3, 307.3], [308.3, 321.3]], enter: [0.371, -0.928],
      minSpeed: 360, speed: 560, path, exit: { x: ex, y: 488, vx: 0, vy: 160 },
    },
  ];
}
function leftRamp(id) {
  return [
    { id: id + "W1", type: "wall", r: 3, pts: mp([[252, 358], [280, 288]]) },
    { id: id + "W2", type: "wall", r: 3, pts: mp([[288, 372], [316, 302]]) },
    { id: id + "Cap", type: "wall", r: 3, pts: mp([[280, 288], [316, 302]]) },
    {
      id, type: "ramp", mouth: mp([[272.3, 307.3], [308.3, 321.3]]), enter: [-0.371, -0.928],
      minSpeed: 360, speed: 560,
      path: [[74, 305], [56, 250], [46, 190], [56, 130], [88, 84], [138, 60], [230, 60], [282, 84], [312, 130], [320, 200], [318, 300], [314, 400], [mx(62), 486]],
      exit: { x: mx(62), y: 488, vx: 0, vy: 160 },
    },
  ];
}

const TABLES = [
  {
    id: "castle", name: "Moonlight Castle", world: 0,
    motif: "towers, bells and a sleeping dragon",
    // The classic castle: every basic shot, introduced one at a time. Its own
    // mechanisms are the DRAWBRIDGE (a ramp behind a gate the story lowers)
    // and the DRAGON — one target that sleeps on its perch and, once woken,
    // flies back and forth across the top of the table. The KEEP on the left
    // holds a ball and throws it back into the bell tower; the MOAT is the
    // left-hand loop round the top.
    upper: [
      { id: "bell1", type: "bumper", group: "bells", look: "bell", x: 132, y: 246, r: 20, kick: 520 },
      { id: "bell2", type: "bumper", group: "bells", look: "bell", x: 216, y: 236, r: 20, kick: 520 },
      { id: "bell3", type: "bumper", group: "bells", look: "bell", x: 174, y: 306, r: 20, kick: 520 },
      { id: "star", type: "target", group: "star", a: [161, 382], b: [203, 396], r: 5 },
      { id: "dragonT", type: "target", group: "dragon", a: [237, 156], b: [263, 172], r: 5, move: { dx: 80, dy: 0, period: 5.2 } },
      { id: "dragon", type: "toy", look: "dragon", x: 250, y: 118, w: 120, h: 70, follow: "dragonT" },
      { id: "keep", type: "saucer", x: 90, y: 272, r: 12, hold: 1.0, eject: [240, 90] },
      { id: "moat", type: "orbit", a: [17, 330], b: [58, 330], dir: [0, -1] },
      ...rightRamp("bridge", "L"),
      { id: "drawbridge", type: "gate", r: 4, a: [252, 358], b: [288, 372] },
    ],
  },
  {
    id: "temple", name: "Jungle Temple", world: 1,
    motif: "stepped stone, hanging vines and a golden idol",
    // The temple is built round its STAIRS: a channel straight up the middle,
    // where a shot from either flipper goes, closed by two STONES standing one
    // behind the other in its mouth. Each good shot topples the next stone;
    // only when both are down can the ball climb, up over the golden idol and
    // down the far side. The stones stay down until the temple raises them.
    // Above the idol, right under the three vine lanes, is the idol's EYE — a
    // saucer that opens when the story says so. Totems stand on the left wall
    // and the prayer wheel (a spinner) spans the right-hand orbit.
    upper: [
      { id: "idol", type: "bumper", group: "idol", look: "idol", x: 184, y: 236, r: 24, kick: 540 },
      { id: "vine1", type: "bumper", group: "vines", look: "leaf", x: 112, y: 300, r: 16, kick: 480 },
      { id: "vine2", type: "bumper", group: "vines", look: "leaf", x: 256, y: 300, r: 16, kick: 480 },
      { id: "sep1", type: "wall", r: 3, pts: [[128, 100], [128, 136]] },
      { id: "sep2", type: "wall", r: 3, pts: [[164, 100], [164, 136]] },
      { id: "sep3", type: "wall", r: 3, pts: [[200, 100], [200, 136]] },
      { id: "sep4", type: "wall", r: 3, pts: [[236, 100], [236, 136]] },
      { id: "lane1", type: "rollover", group: "lanes", x: 146, y: 120, r: 9 },
      { id: "lane2", type: "rollover", group: "lanes", x: 182, y: 120, r: 9 },
      { id: "lane3", type: "rollover", group: "lanes", x: 218, y: 120, r: 9 },
      { id: "eye", type: "saucer", x: 184, y: 174, r: 12, hold: 1.1, eject: [-300, 30] },
      { id: "totem1", type: "target", group: "totems", a: [21, 296], b: [21, 320], r: 4 },
      { id: "totem2", type: "target", group: "totems", a: [21, 320], b: [21, 344], r: 4 },
      // the prayer wheel spans the right-hand orbit, so every loop turns it
      { id: "spinner", type: "spinner", a: [292, 236], b: [346, 236] },
      // the stairs: two walls and a peaked roof (a flat one would be a shelf)
      { id: "stairsWL", type: "wall", r: 3, pts: [[164, 376], [164, 302]] },
      { id: "stairsWR", type: "wall", r: 3, pts: [[204, 376], [204, 302]] },
      { id: "stairsCap", type: "wall", r: 3, pts: [[164, 302], [184, 290], [204, 302]] },
      {
        id: "stairs", type: "ramp", mouth: [[167, 318], [201, 318]], enter: [0, -1],
        minSpeed: 340, speed: 540,
        path: [[184, 318], [184, 262], [176, 206], [150, 162], [108, 130], [70, 150], [54, 210], [54, 300], [56, 390], [62, 486]],
        exit: { x: 62, y: 488, vx: 0, vy: 160 },
      },
      { id: "stone1", type: "drop", group: "stones", keep: true, a: [167.6, 368], b: [200.4, 368], r: 4 },
      { id: "stone2", type: "drop", group: "stones", keep: true, a: [167.6, 340], b: [200.4, 340], r: 4 },
    ],
    laneChange: "lanes",
  },
  {
    id: "sea", name: "Deep Sea", world: 2,
    motif: "coral, kelp, shells and a sunken chest",
    // The sea has no ramp: here the WATER moves the ball. Up the left runs the
    // CURRENT, a lane that pulses upward and carries the ball to the top
    // (the story can still it); in the middle of the upper table opens the
    // WHIRLPOOL, which draws a passing ball in, swallows it and spits it out.
    // Three shells sing in a reef row across the middle, pearls hide on the
    // right-hand wall and the sunken chest sits top right.
    upper: [
      { id: "shell1", type: "bumper", group: "shells", look: "shell", x: 112, y: 286, r: 19, kick: 520 },
      { id: "shell2", type: "bumper", group: "shells", look: "shell", x: 184, y: 264, r: 19, kick: 520 },
      { id: "shell3", type: "bumper", group: "shells", look: "shell", x: 256, y: 286, r: 19, kick: 520 },
      { id: "reef", type: "wall", r: 3, pts: [[64, 428], [64, 210]] },
      { id: "current", type: "field", rect: [17, 205, 61, 450], ax: 0, ay: -1500, pulse: { period: 4, on: 2.4 } },
      { id: "tide", type: "orbit", a: [17, 330], b: [61, 330], dir: [0, -1] },
      { id: "whirlpool", type: "field", pull: { x: 184, y: 168, r: 72, k: 1500 } },
      { id: "whirl", type: "saucer", x: 184, y: 168, r: 12, hold: 1.2, eject: [150, 250] },
      { id: "chest", type: "saucer", x: 292, y: 168, r: 12, hold: 0.9, eject: [-250, 240] },
      { id: "pearl1", type: "target", group: "pearls", a: [347, 292], b: [347, 314], r: 4 },
      { id: "pearl2", type: "target", group: "pearls", a: [347, 322], b: [347, 344], r: 4 },
      { id: "pearl3", type: "target", group: "pearls", a: [347, 352], b: [347, 374], r: 4 },
    ],
  },
  {
    id: "workshop", name: "Clockwork Workshop", world: 3,
    motif: "brass gears, springs and a wind-up toy",
    // The workshop is about TIMING. Nothing ticks until the key is wound:
    // then the PENDULUM swings across the middle of the table, and the
    // CLOCKWORK DOOR in front of the conveyor opens and shuts on a beat, so
    // the conveyor is a shot you time rather than aim. A gear train turns
    // across the top, the T-I-C-K targets face the flippers below it, and the
    // toybox waits on the right, above the conveyor.
    upper: [
      { id: "gear1", type: "bumper", group: "gears", look: "gear", x: 116, y: 180, r: 21, kick: 520 },
      { id: "gear2", type: "bumper", group: "gears", look: "gear", x: 184, y: 166, r: 21, kick: 520 },
      { id: "gear3", type: "bumper", group: "gears", look: "gear", x: 252, y: 180, r: 21, kick: 520 },
      { id: "pendulumPin", type: "post", x: 184, y: 290, r: 6 },
      { id: "pendulum", type: "arm", x: 184, y: 290, len: 46, r: 5, a0: Math.PI / 2, amp: 0.75, period: 2.4 },
      { id: "tickT", type: "target", group: "tick", letter: "T", a: [92, 248], b: [112, 236], r: 4 },
      { id: "tickI", type: "target", group: "tick", letter: "I", a: [140, 227], b: [160, 224], r: 4 },
      { id: "tickC", type: "target", group: "tick", letter: "C", a: [208, 224], b: [228, 227], r: 4 },
      { id: "tickK", type: "target", group: "tick", letter: "K", a: [256, 236], b: [276, 248], r: 4 },
      { id: "key", type: "target", group: "key", a: [21, 300], b: [21, 332], r: 4 },
      { id: "automaton", type: "toy", look: "automaton", x: 58, y: 300, w: 40, h: 60 },
      ...rightRamp("conveyor", "R"),
      { id: "clockDoor", type: "gate", r: 4, a: [252, 358], b: [288, 372], timed: { period: 2.4, closed: 1.2 } },
      { id: "toybox", type: "saucer", x: 302, y: 238, r: 12, hold: 0.9, eject: [-240, 200] },
    ],
  },
  {
    id: "clouds", name: "Cloud Kingdom", world: 4,
    motif: "puffy clouds, a rainbow and a castle in the sky",
    // The finale world is about things that FLOAT. Its three cloud bumpers
    // drift across the sky once the wind picks up — two together in a high
    // band, one alone below, so no two can ever pinch a ball between them.
    // Up the left blows the WIND lane, with the S-T-A-R storm bank on its
    // wall; up the right runs the RAINBOW, a narrow lane that turns into a
    // ramp arcing over the whole sky when the ball is going fast enough. The
    // castle in the sky waits at the top right.
    upper: [
      { id: "puff1", type: "bumper", group: "puffs", look: "cloud", x: 145, y: 232, r: 19, kick: 520, move: { dx: 30, dy: 0, period: 6.4 } },
      { id: "puff2", type: "bumper", group: "puffs", look: "cloud", x: 245, y: 232, r: 19, kick: 520, move: { dx: 30, dy: 0, period: 6.4 } },
      { id: "puff3", type: "bumper", group: "puffs", look: "cloud", x: 190, y: 302, r: 19, kick: 520, move: { dx: -50, dy: 0, period: 5.2 } },
      { id: "windWall", type: "wall", r: 3, pts: [[64, 428], [64, 220]] },
      { id: "wind", type: "field", rect: [17, 215, 61, 460], ax: 0, ay: -1250, pulse: { period: 3.2, on: 1.7 } },
      { id: "windLane", type: "orbit", a: [17, 320], b: [61, 320], dir: [0, -1] },
      // The storm bank hangs on the wind lane's wall, facing the right flipper.
      { id: "stormS", type: "drop", group: "storm", letter: "S", a: [71, 252], b: [71, 274], r: 4 },
      { id: "stormT", type: "drop", group: "storm", letter: "T", a: [71, 282], b: [71, 304], r: 4 },
      { id: "stormA", type: "drop", group: "storm", letter: "A", a: [71, 312], b: [71, 334], r: 4 },
      { id: "stormR", type: "drop", group: "storm", letter: "R", a: [71, 342], b: [71, 364], r: 4 },
      { id: "spinner", type: "spinner", a: [17, 380], b: [61, 380] },
      // the rainbow: the right-hand lane between this wall and the plunger
      // lane's own wall, becoming a ramp at speed
      { id: "rainbowW", type: "wall", r: 3, pts: [[318, 286], [318, 350]] },
      {
        id: "rainbow", type: "ramp", mouth: [[321, 318], [351, 318]], enter: [0, -1],
        minSpeed: 340, speed: 600,
        path: [[336, 318], [340, 230], [322, 140], [274, 82], [200, 58], [128, 74], [86, 122], [72, 190], [68, 300], [62, 400], [62, 486]],
        exit: { x: 62, y: 488, vx: 0, vy: 160 },
      },
      { id: "skyCastle", type: "saucer", x: 290, y: 176, r: 12, hold: 0.9, eject: [-190, 310] },
    ],
  },

];

// What seals which ramp: a gate the story opens (or a clockwork one that
// ticks open and shut), or "@bank", drop targets standing in its mouth.
const DOORS = { bridge: "drawbridge", stairs: "@stones", conveyor: "clockDoor" };
for (const t of TABLES) {
  for (const e of t.upper) if (e.type === "ramp" && DOORS[e.id]) e.door = DOORS[e.id];
  t.elements = [...baseElements(), ...t.upper];
  t.byId = {};
  for (const e of t.elements) t.byId[e.id] = e;
  t.flippers = FLIPPERS;
  t.plunger = PLUNGER;
}

if (typeof module !== "undefined") module.exports = { TABLES, TABLE_W, TABLE_H, CX, FLIPPERS, PLUNGER, arcPts };
