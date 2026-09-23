"use strict";
// Collision primitives and the real engine's handling of walls, circles,
// flippers and speed. The tunnelling cases fire balls far faster than play
// ever produces and assert they can never end up on the wrong side.

const { test } = require("node:test");
const assert = require("node:assert");
const G = require("./load.js");
const { PHYS, Physics, Sim, TABLES } = G;
const R = PHYS.BALL_R;

// A bare table: one element list and the standard flippers, so a test can
// build exactly the geometry it is about.
function bare(elements, extra = {}) {
  const t = Object.assign({ id: "test", elements, flippers: [], plunger: { x: -100, y: -100, lane: [9999, 9999], ready: 9999 } }, extra);
  t.byId = {};
  for (const e of t.elements) t.byId[e.id] = e;
  return t;
}
const NEEDED = [
  { id: "savePost", type: "post", x: -500, y: -500, r: 1 },
  { id: "kickL", type: "kickback", x: -500, y: -500, r: 1 },
  { id: "kickR", type: "kickback", x: -600, y: -500, r: 1 },
];
function simWith(elements, extra) {
  const sim = new Sim(bare([...NEEDED, ...elements], extra), { mode: "free", balls: 3, objectives: [], state: { kickback: "off" } });
  sim.S.queue = [];
  return sim;
}
function ball(sim, x, y, vx, vy) {
  const b = sim.serve(false);
  Object.assign(b, { x, y, vx, vy });
  return b;
}

test("closest point and crossing are exact on simple cases", () => {
  const q = Physics.closest(5, 5, 0, 0, 10, 0);
  assert.deepStrictEqual([q.x, q.y, q.t], [5, 0, 0.5]);
  assert.strictEqual(Physics.closest(-4, 3, 0, 0, 10, 0).t, 0);
  assert.notStrictEqual(Physics.crossed(5, -1, 5, 1, 0, 0, 10, 0), 0);
  assert.strictEqual(Physics.crossed(15, -1, 15, 1, 0, 0, 10, 0), 0, "outside the segment");
  assert.strictEqual(Physics.crossed(5, -2, 5, -1, 0, 0, 10, 0), 0, "same side");
});

test("capsule contact: normal points at the ball, penetration is exact", () => {
  const c = Physics.capsule({ x: 5, y: -10 }, R, 0, 0, 10, 0, 3);
  assert.ok(c);
  assert.ok(Math.abs(c.ny + 1) < 1e-9 && Math.abs(c.nx) < 1e-9);
  assert.ok(Math.abs(c.pen - 2) < 1e-9);
  assert.strictEqual(Physics.capsule({ x: 5, y: -12.1 }, R, 0, 0, 10, 0, 3), null);
});

test("resolve reflects with restitution and only when approaching", () => {
  const b = { x: 0, y: 0, vx: 0, vy: 300 };
  Physics.resolve(b, 0, -1, 1, 0, 0, 0.5, 0, 0);
  assert.strictEqual(b.vy, -150);
  const away = { x: 0, y: 0, vx: 0, vy: -300 };
  assert.strictEqual(Physics.resolve(away, 0, -1, 1, 0, 0, 0.5, 0, 0), 0);
  assert.strictEqual(away.vy, -300);
  const kicked = { x: 0, y: 0, vx: 0, vy: 50 };
  Physics.resolve(kicked, 0, -1, 1, 0, 0, 0.5, 0, 500);
  assert.strictEqual(kicked.vy, -500, "a kick sets a minimum exit speed");
});

test("a ball dropped on a floor comes to rest on it, never through it", () => {
  const sim = simWith([{ id: "floor", type: "wall", r: 3, pts: [[0, 400], [400, 400]] }]);
  const b = ball(sim, 200, 300, 0, 0);
  for (let i = 0; i < 480 * 2.5; i++) sim.step();   // inside the 3 s stuck window
  assert.ok(Math.abs(b.y - (400 - 3 - R)) < 0.6, `rests on the rail (y=${b.y.toFixed(2)})`);
  assert.ok(Math.abs(b.vy) < 20, "and has stopped bouncing");
});

test("tunnelling: even at the speed cap a ball never crosses a thin rail", () => {
  const fails = [];
  for (const ang of [0, 0.3, 0.7, 1.1, 1.4, -0.4, -0.9]) {
    const sim = simWith([{ id: "w", type: "wall", r: 2, pts: [[200, 0], [200, 720]] }]);
    const sp = 20000;   // ten times the cap: the engine must clamp it and still catch the rail
    const b = ball(sim, 150, 360, Math.cos(ang) * sp, Math.sin(ang) * sp * 0.2);
    for (let i = 0; i < 480; i++) { sim.step(); if (b.x > 200) { fails.push(ang); break; } }
    assert.ok(Math.hypot(b.vx, b.vy) <= PHYS.MAX_SPEED + 1e-6);
  }
  assert.deepStrictEqual(fails, []);
});

test("tunnelling: a fast ball cannot slip between two touching rails at a corner", () => {
  const sim = simWith([
    { id: "a", type: "wall", r: 3, pts: [[100, 100], [300, 300]] },
    { id: "b", type: "wall", r: 3, pts: [[300, 300], [100, 500]] },
  ]);
  const b = ball(sim, 180, 300, 1900, 0);
  for (let i = 0; i < 480; i++) { sim.step(); assert.ok(b.x < 300, "ball escaped through the joint"); }
});

test("bumpers kick: a slow touch leaves at kick speed and counts once per cooldown", () => {
  const sim = simWith([{ id: "bmp", type: "bumper", group: "g", x: 200, y: 300, r: 20, kick: 520, look: "bell" }]);
  const b = ball(sim, 200, 300 - 20 - R - 1, 0, 60);
  for (let i = 0; i < 20; i++) sim.step();
  assert.ok(Math.hypot(b.vx, b.vy) > 480, "kicked away");
  assert.strictEqual(sim.S.el.bmp.hits, 1);
  assert.strictEqual(sim.S.stats.bumpers, 1);
});

test("one-way gate: passes from behind, blocks from the front", () => {
  const gate = { id: "g", type: "gate", r: 3, a: [150, 300], b: [250, 300], oneWay: [0, -1] };
  const up = simWith([gate]);
  const b1 = ball(up, 200, 340, 0, -900);
  for (let i = 0; i < 120; i++) up.step();
  assert.ok(b1.y < 290, "went up through it");
  const down = simWith([gate]);
  const b2 = ball(down, 200, 250, 0, 700);
  for (let i = 0; i < 60; i++) down.step();
  assert.ok(b2.y < 300, "bounced off the top");
});

// The real table's flippers from here on.
function onTable(id = "castle") {
  const t = TABLES.find((x) => x.id === id);
  const sim = new Sim(t, { mode: "free", balls: 3, objectives: [], state: { kickback: "off", ballSave: 0 } });
  sim.S.queue = [];
  return sim;
}

test("flipper: a ball resting on a raised flipper is fired up the table hard", () => {
  const sim = onTable();
  sim.input.left = true;
  for (let i = 0; i < 60; i++) sim.step();                         // flipper up
  const f = sim.table.flippers[0];
  const b = ball(sim, f.x + 30, f.y - 50, 0, 0);
  for (let i = 0; i < 480 * 1.5; i++) sim.step();                  // it rolls down to the base
  assert.ok(b.mode === "play" && b.y < f.y && b.x < f.x + 40, `cradled at the base (${b.x.toFixed(0)},${b.y.toFixed(0)})`);
  sim.input.left = false;
  for (let i = 0; i < 240; i++) sim.step();                        // drop; it rolls out toward the tip
  sim.input.left = true;
  let best = 0;
  for (let i = 0; i < 90; i++) { sim.step(); best = Math.max(best, -b.vy); }
  assert.ok(best > 900, `flipped up at ${best.toFixed(0)} px/s`);
});

test("flipper: a rising flipper never lets a ball pass through it", () => {
  const fails = [];
  for (let dx = 12; dx <= 60; dx += 6) {
    const sim = onTable();
    const f = sim.table.flippers[0];
    const tipAng = f.rest;
    const x = f.x + Math.cos(tipAng) * dx, y = f.y + Math.sin(tipAng) * dx - 12 - R;
    const b = ball(sim, x, y, 0, 0);
    sim.input.left = true;
    for (let i = 0; i < 120; i++) {
      sim.step();
      // ball centre must stay on the upper side of the flipper line
      const st = sim.S.flip[0];
      const nx = -Math.sin(st.ang), ny = Math.cos(st.ang);
      const side = (b.x - f.x) * nx + (b.y - f.y) * ny;
      const along = (b.x - f.x) * Math.cos(st.ang) + (b.y - f.y) * Math.sin(st.ang);
      if (along > 0 && along < f.len && side > 0) { fails.push(dx); break; }
    }
  }
  assert.deepStrictEqual(fails, []);
});

test("flipper: a ball dropped on a resting flipper rolls off the tip, not through it", () => {
  const sim = onTable();
  const f = sim.table.flippers[1];
  const b = ball(sim, f.x - 20, f.y - 40, 0, 0);
  let minY = 0;
  for (let i = 0; i < 480 * 3 && b.mode === "play" && sim.S.balls.includes(b); i++) { sim.step(); minY = Math.max(minY, b.y); }
  assert.ok(!sim.S.balls.includes(b), "it drained between the flippers");
});

test("drag and gravity: a free ball falls with G", () => {
  const sim = simWith([]);
  const b = ball(sim, 200, 100, 0, 0);
  for (let i = 0; i < 240; i++) sim.step();      // 0.5 s
  const expect = 0.5 * PHYS.G * 0.25;
  assert.ok(Math.abs((b.y - 100) - expect) < expect * 0.03, `fell ${(b.y - 100).toFixed(1)} vs ${expect.toFixed(1)}`);
});

test("stuck ball: nudged twice, then returned to the plunger — slow rolling is left alone", () => {
  // A cup the ball cannot leave by itself.
  const cup = [{ id: "cupL", type: "wall", r: 3, pts: [[160, 60], [200, 300]] }, { id: "cupR", type: "wall", r: 3, pts: [[200, 300], [240, 60]] }];
  const sim = simWith(cup, { plunger: { x: 370, y: 700, lane: [354, 386], ready: 660 } });
  const b = ball(sim, 200, 240, 0, 0);
  const seen = [];
  sim.events = [];
  for (let i = 0; i < 480 * 14; i++) { sim.step(); }
  for (const e of sim.events) if (e.type === "nudge" || e.type === "rescue") seen.push(e.type);
  assert.deepStrictEqual(seen.slice(0, 3), ["nudge", "nudge", "rescue"]);

  // A ball rolling slowly along a long shallow slope is never "rescued".
  const slope = simWith([{ id: "s", type: "wall", r: 3, pts: [[20, 300], [390, 318]] }]);
  const b2 = ball(slope, 30, 285, 0, 0);
  slope.events = [];
  for (let i = 0; i < 480 * 5; i++) slope.step();
  assert.ok(!slope.events.some((e) => e.type === "nudge" || e.type === "rescue"));
  assert.ok(b2.x > 60, "it did roll");
});

test("the fixed step rejects nothing: identical runs are byte-identical", () => {
  const run = () => {
    const sim = onTable("workshop");
    sim.S.queue = [];
    ball(sim, 120, 120, 300, 100);
    ball(sim, 250, 200, -200, 0);
    for (let i = 0; i < 480 * 8; i++) { sim.input.left = (i % 700) < 90; sim.input.right = (i % 530) < 80; sim.step(); }
    return JSON.stringify(sim.S);
  };
  assert.strictEqual(run(), run());
});
