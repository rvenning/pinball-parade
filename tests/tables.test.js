"use strict";
// Table and chapter lint. Every table must be sound as GEOMETRY (no pinch
// gaps, no overlapping solids, a working launch, a drain reachable from every
// free region, ramp exits that land in play) and every chapter must be sound
// as CONTENT (objectives point at real mechanisms of the right kind, nothing
// depends on a mechanism that nothing opens, and concepts arrive in order).
//
// Failures are collected into arrays so one run names every offender.

const { test } = require("node:test");
const assert = require("node:assert");
const G = require("./load.js");
const { PHYS, Physics, TABLES, CHAPTERS, WORLDS, OBJ_KINDS, EFFECT_KINDS, PACE, Sim, compileTable } = G;
const R = PHYS.BALL_R;
const PASS = 2 * R + 1;

const KNOWN = ["wall", "post", "bumper", "sling", "target", "drop", "rollover", "spinner", "orbit", "ramp", "saucer", "gate", "arm", "field", "kickback", "toy"];

// Static solids as simple shapes, including each flipper's pivot boss. A
// mover is sampled at `u` of its sweep (-1…1); by default it sits at home.
function solids(t, u = 0) {
  compileTable(t);
  const out = t._prims.map((p) => {
    const ox = p.mv ? p.mv.move.dx * u : 0, oy = p.mv ? p.mv.move.dy * u : 0;
    return { el: p.el, type: p.type, a: [p.ax + ox, p.ay + oy], b: [p.bx + ox, p.by + oy], r: p.r, circ: p.k === "circ", mv: !!p.mv };
  });
  for (const f of t.flippers) out.push({ el: "flipper" + f.id, type: "pivot", a: [f.x, f.y], b: [f.x, f.y], r: f.r0, circ: true });
  for (const a of t._arms) out.push({ el: a.id + "Pin", type: "pivot", a: [a.x, a.y], b: [a.x, a.y], r: a.r, circ: true });
  return out;
}
const isEnd = (p, s) => Math.hypot(p[0] - s.a[0], p[1] - s.a[1]) < 1e-6 || Math.hypot(p[0] - s.b[0], p[1] - s.b[1]) < 1e-6;

test("every element is known, ids are unique, groups are non-empty", () => {
  const fails = [];
  for (const t of TABLES) {
    const seen = new Set();
    for (const e of t.elements) {
      if (!KNOWN.includes(e.type)) fails.push(`${t.id}/${e.id}: unknown type ${e.type}`);
      if (seen.has(e.id)) fails.push(`${t.id}: duplicate id ${e.id}`);
      seen.add(e.id);
      for (const k of ["x", "y"]) if (k in e && !Number.isFinite(e[k])) fails.push(`${t.id}/${e.id}: ${k} not finite`);
    }
  }
  assert.deepStrictEqual(fails, []);
});

test("no pinch gaps and no overlapping solids — movers checked all along their sweep", () => {
  const fails = [];
  const touches = (p, s, r) => { const q = Physics.closest(p[0], p[1], ...s.a, ...s.b); return Math.hypot(p[0] - q.x, p[1] - q.y) <= r + 0.5; };
  const sweeps = [0, -1, -0.75, -0.5, -0.25, 0.25, 0.5, 0.75, 1];
  for (const t of TABLES) for (const u of sweeps) {
    if (u !== 0 && !t.elements.some((e) => e.move)) continue;
    // at other sweep positions only pairs involving a mover can have changed
    const S = solids(t, u);
    // Group primitive pairs by element pair: two rails that meet at a joint
    // also come close to each other's neighbouring segments right beside it,
    // and that is a corner, not a gap a ball could be wedged in.
    const pairs = new Map();
    for (let i = 0; i < S.length; i++) for (let j = i + 1; j < S.length; j++) {
      const A = S[i], B = S[j];
      if (A.el === B.el) continue;
      if (u !== 0 && !A.mv && !B.mv) continue;
      const gap = Physics.segSegDist(A.a, A.b, B.a, B.b) - A.r - B.r;
      if (gap >= PASS) continue;
      const k = A.el + "~" + B.el;
      if (!pairs.has(k)) pairs.set(k, []);
      pairs.get(k).push({ A, B, gap });
    }
    for (const [k, list] of pairs) {
      const joints = [];
      for (const { A, B, gap } of list) {
        if (gap > 0.5) continue;
        const ends = [A.a, A.b].filter((p) => touches(p, B, A.r + B.r)).concat([B.a, B.b].filter((p) => touches(p, A, A.r + B.r)));
        const crossing = !A.circ && !B.circ && Physics.segsCross(A.a, A.b, B.a, B.b) && !isEnd(A.a, B) && !isEnd(A.b, B);
        const roundJam = A.type === "bumper" || B.type === "bumper";
        if (crossing || roundJam || !ends.length) fails.push(`${t.id}: ${k} overlap (gap ${gap.toFixed(1)})${u ? ` with the mover at ${u}` : ""}`);
        else joints.push(...ends);
      }
      // Two elements that are joined form a wedge that opens out from the
      // joint; a narrow stretch of it is a corner, not a trap. Only
      // UNJOINED elements coming within a ball's width of each other are.
      if (joints.length) continue;
      for (const { gap } of list) {
        if (gap <= 0.5) continue;
        fails.push(`${t.id}: ${k} pinch gap ${gap.toFixed(1)}px (ball needs ${PASS})${u ? ` with the mover at ${u}` : ""}`);
        break;
      }
    }
  }
  assert.deepStrictEqual(fails, []);
});

test("movers with their own rhythm never come within a ball's width of each other", () => {
  // Movers sharing a motion keep their spacing; ones with different periods
  // can meet at ANY pair of positions, so sample the pairs independently.
  const fails = [];
  const us = [-1, -0.5, 0, 0.5, 1];
  for (const t of TABLES) {
    const ms = t.elements.filter((e) => e.move && e.type === "bumper");
    for (let i = 0; i < ms.length; i++) for (let j = i + 1; j < ms.length; j++) {
      const A = ms[i], B = ms[j];
      if (A.move.dx === B.move.dx && A.move.dy === B.move.dy && A.move.period === B.move.period && (A.move.phase || 0) === (B.move.phase || 0)) continue;
      let worst = Infinity;
      for (const u of us) for (const v of us) {
        const d = Math.hypot(A.x + A.move.dx * u - B.x - B.move.dx * v, A.y + A.move.dy * u - B.y - B.move.dy * v) - A.r - B.r;
        worst = Math.min(worst, d);
      }
      if (worst < PASS) fails.push(`${t.id}: ${A.id} and ${B.id} can drift to ${worst.toFixed(1)}px apart`);
    }
  }
  assert.deepStrictEqual(fails, []);
});

test("no saucer juggles a ball by itself, wherever the movers have stopped", () => {
  // Left alone, an ejected ball must never be caught again by the same
  // saucer: a bumper sitting in the eject path would otherwise hand it
  // straight back, forever. Checked with every mover frozen at each point of
  // its sweep, because the story can stop one anywhere.
  const fails = [];
  for (const t of TABLES) for (const s of t.elements.filter((e) => e.type === "saucer")) {
    for (const u of [-1, -0.5, 0, 0.5, 1]) {
      const sim = new Sim(t, lintCfg(t));
      sim.S.queue = [];
      for (const m of t._movers) if (m.move) sim.S.el[m.id].mt = (Math.asin(u) / (2 * Math.PI)) * m.move.period;
      const b = sim.serve(false);
      Object.assign(b, { x: s.x, y: s.y + 0.1, vx: 0, vy: 0 });
      let caught = 0;
      for (let i = 0; i < 480 * 20 && sim.S.balls.length; i++) {
        sim.step();
        for (const e of sim.events) if ((e.type === "saucer" || e.type === "lock") && e.id === s.id) caught++;
        sim.events.length = 0;
      }
      if (caught > 1) fails.push(`${t.id}: ${s.id} caught its own eject ${caught - 1} time(s) with movers at ${u}`);
    }
  }
  assert.deepStrictEqual(fails, []);
});

// A clean config for geometry checks: everything open and awake, no mercy.
function lintCfg(t, extra) {
  return Object.assign({ mode: "free", balls: 3, objectives: [], noRescue: true, state: { kickback: "off", ballSave: 0, savePost: false } }, extra);
}

test("launch: every plunger strength clears the lane flap and reaches the playfield", () => {
  const fails = [];
  for (const t of TABLES) for (const hold of [0.02, 0.3, 0.6, 1.2]) {
    const sim = new Sim(t, lintCfg(t));
    let i = 0, pressed = -1, reached = false;
    for (; i < 480 * 6; i++) {
      if (pressed < 0 && sim.readyBall()) pressed = i;
      sim.input.launch = pressed >= 0 && (i - pressed) < hold * 480;
      sim.step();
      const b = sim.S.balls[0];
      if (b && b.x < 340 && b.y < 520) { reached = true; break; }
    }
    if (!reached) fails.push(`${t.id}: a ${hold}s press never reached the playfield`);
  }
  assert.deepStrictEqual(fails, []);
});

// Free cells a ball could occupy, flood-filled from mid-table, excluding the
// plunger lane. Every one of them must drain with nobody touching anything.
function freeCells(t, step) {
  const S = solids(t);
  const free = (x, y) => {
    for (const s of S) {
      const q = Physics.closest(x, y, ...s.a, ...s.b);
      if (Math.hypot(x - q.x, y - q.y) < s.r + R + 0.5) return false;
    }
    return true;
  };
  const key = (x, y) => x.toFixed(1) + "," + y.toFixed(1);
  const seen = new Set(), out = [];
  const start = [184.37, 450.21];   // off-grid: never balanced exactly on a vertex
  const q = [start];
  seen.add(key(...start));
  while (q.length) {
    const [x, y] = q.shift();
    if (!free(x, y)) continue;
    out.push([x, y]);
    for (const [dx, dy] of [[step, 0], [-step, 0], [0, step], [0, -step]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 14 || nx > 386 || ny < 20 || ny > 700 || (nx > 350 && ny > 250)) continue;
      const k = key(nx, ny);
      if (!seen.has(k)) { seen.add(k); q.push([nx, ny]); }
    }
  }
  return out;
}

// The table as the story can leave it at its most open: every gate open,
// every drop bank down, every mover, pendulum and clockwork door running.
function openUp(sim) {
  for (const e of sim.table.elements) {
    const st = sim.S.el[e.id];
    if (e.type === "gate" && !e.oneWay) st.closed = false;
    if (e.type === "drop") st.down = true;
    if (e.move || e.type === "arm" || e.timed) st.moving = true;
  }
}

test("recovery: a ball left anywhere on the table finds its way to the drain unaided", () => {
  const fails = [];
  for (const t of TABLES.filter((x) => !process.env.LINT_TABLE || x.id === process.env.LINT_TABLE)) for (const open of [false, true]) {
    // the open pass floods with drops and doors out of the way (as solids(t) sees them hidden)
    const cells = open ? freeCells(Object.assign({}, t, { _prims: t._prims.filter((p) => p.type !== "drop" && !(p.type === "gate" && !p.oneWay)), _arms: t._arms }), 16) : freeCells(t, 16);
    assert.ok(cells.length > 200, `${t.id}: flood fill found only ${cells.length} free cells`);
    for (const [x, y] of cells) {
      const sim = new Sim(t, lintCfg(t));
      if (open) openUp(sim);
      sim.S.queue = [];
      const b = sim.serve(false);
      b.x = x; b.y = y;
      let drained = false;
      for (let i = 0; i < 480 * 30; i++) {
        sim.step();
        if (!sim.S.balls.length) { drained = true; break; }
        if (sim.S.balls.length > 1) break;
      }
      if (!drained) { const e = sim.S.balls[0]; fails.push(`${t.id}${open ? " (all open)" : ""}: from (${x.toFixed(0)},${y.toFixed(0)}) still at (${e.x.toFixed(0)},${e.y.toFixed(0)}) after 30s`); }
    }
  }
  assert.deepStrictEqual(fails, []);
});

test("ramps: exits are clear of solids and deliver the ball to a flipper", () => {
  const fails = [];
  for (const t of TABLES) for (const r of t.elements.filter((e) => e.type === "ramp")) {
    const sim = new Sim(t, lintCfg(t));
    sim.S.queue = [];
    const b = sim.serve(false);
    Object.assign(b, { x: r.exit.x, y: r.exit.y, vx: r.exit.vx, vy: r.exit.vy });
    let ok = false;
    for (let i = 0; i < 480 * 4; i++) {
      sim.step();
      const f = sim.S.balls[0];
      if (!f) break;
      if (f.y > 600 && Math.abs(f.x - 184) < 90) { ok = true; break; }
    }
    if (!ok) fails.push(`${t.id}/${r.id}: exit does not feed a flipper`);
    // entry mouth must lie across its own channel
    if (!(r.minSpeed > 0 && r.speed > 0 && r.path.length >= 3)) fails.push(`${t.id}/${r.id}: malformed`);
  }
  assert.deepStrictEqual(fails, []);
});

test("ramps: a hard shot rides, a weak one rolls back out", () => {
  const fails = [];
  for (const t of TABLES) for (const r of t.elements.filter((e) => e.type === "ramp")) {
    const mid = [(r.mouth[0][0] + r.mouth[1][0]) / 2, (r.mouth[0][1] + r.mouth[1][1]) / 2];
    for (const [sp, want] of [[900, true], [180, false]]) {
      const sim = new Sim(t, lintCfg(t));
      sim.S.queue = [];
      // with its door open: the drawbridge down, the stones toppled
      if (r.door) for (const id of sim.ids(r.door)) { sim.S.el[id].closed = false; sim.S.el[id].down = true; }
      const b = sim.serve(false);
      Object.assign(b, { x: mid[0] - r.enter[0] * 40, y: mid[1] - r.enter[1] * 40, vx: r.enter[0] * sp, vy: r.enter[1] * sp });
      let rode = false;
      for (let i = 0; i < 480 * 3; i++) { sim.step(); if (sim.S.balls[0] && sim.S.balls[0].mode === "ride") { rode = true; break; } }
      if (rode !== want) fails.push(`${t.id}/${r.id}: ${sp}px/s shot ${rode ? "rode" : "did not ride"}`);
    }
  }
  assert.deepStrictEqual(fails, []);
});

// ------------------------------------------------------------- chapters ---
const KIND_TYPES = {
  hit: ["bumper", "target", "drop"], all: ["bumper", "target", "drop"], ramp: ["ramp"], lanes: ["rollover"],
  bank: ["drop"], spell: ["target", "drop"], spin: ["spinner"], orbit: ["orbit"], saucer: ["saucer"], frenzy: ["bumper", "target", "drop", "ramp", "saucer", "orbit", "spinner"],
};
const TRANSIENT = ["save", "extra", "kick"];
const SPECIAL_FINALE = (p) => !!(p.timer || p.jackpot || ["frenzy", "lock", "multiball", "parade"].includes(p.kind));
// Largest count a phase may ask for, by what it counts: a story phase is a
// new shot to find, not the same one again and again.
const MAX_COUNT = (p, t) => {
  if (p.kind === "frenzy" || p.kind === "spin" || p.kind === "score") return Infinity;
  const members = p.id ? [t.byId[p.id]] : t.elements.filter((e) => e.group === p.group);
  return members.length && members.every((m) => m && m.type === "bumper") && p.kind === "hit" ? 15 : 3;
};
const goalKey = (o) => `${o.kind}:${o.id || o.group || ""}`;

// Walk a chapter phase by phase, applying every table change in order, and
// report anything a phase asks for that the table cannot offer at that moment.
function walkChapter(c, t, fails) {
  const tag = `ch${c.idx + 1} ${c.title}`;
  const ids = (ref) => ref[0] === "@" ? t.elements.filter((e) => e.group === ref.slice(1)).map((e) => e.id) : (t.byId[ref] ? [ref] : []);
  const st = {};
  for (const e of t.elements) st[e.id] = { hidden: false, closed: false, lock: false, moving: false, down: false };
  for (const [k, list] of [["hidden", c.state.hidden], ["closed", c.state.closed], ["lock", c.state.lock], ["moving", c.state.moving], ["down", c.state.down]]) {
    for (const ref of list || []) { const got = ids(ref); if (!got.length) fails.push(`${tag}: state names missing ${ref}`); got.forEach((id) => { st[id][k] = true; }); }
  }
  const apply = (fx, where) => {
    const [k, ref] = fx.split(":");
    if (!EFFECT_KINDS.includes(k)) { fails.push(`${tag}: unknown effect ${fx} (${where})`); return false; }
    if (TRANSIENT.includes(k)) return false;
    const got = ids(ref || "");
    if (!got.length) { fails.push(`${tag}: effect ${fx} names nothing (${where})`); return false; }
    for (const id of got) {
      if (k === "open") st[id].closed = false; if (k === "close") st[id].closed = true;
      if (k === "show") st[id].hidden = false; if (k === "hide") st[id].hidden = true;
      if (k === "lightLock") st[id].lock = true; if (k === "unlock") st[id].lock = false;
      if (k === "move") st[id].moving = true; if (k === "still") st[id].moving = false;
      if (k === "raise") st[id].down = false;
    }
    return true;
  };
  const check = (o, where) => {
    if (!OBJ_KINDS.includes(o.kind)) fails.push(`${tag}: unknown kind ${o.kind} (${where})`);
    if (!o.label || !o.icon) fails.push(`${tag}: ${where} needs a label and icon`);
    if (o.label && o.label.length > 22) fails.push(`${tag}: label "${o.label}" is too long for the HUD`);
    const types = KIND_TYPES[o.kind];
    let members = [];
    if (types) {
      members = o.id ? [t.byId[o.id]].filter(Boolean) : t.elements.filter((e) => e.group === o.group);
      if (!members.length) fails.push(`${tag}: ${where} ${o.kind} names nothing (${o.id || o.group})`);
      for (const m of members) if (!types.includes(m.type)) fails.push(`${tag}: ${where} ${o.kind} on a ${m.type}`);
      if (members.length && members.every((m) => st[m.id].hidden)) fails.push(`${tag}: ${where} aims at hidden ${o.id || o.group}`);
    }
    if (o.kind === "spell") for (const ch of o.word) if (!members.some((m) => m.letter === ch)) fails.push(`${tag}: no target for letter ${ch}`);
    if ((o.kind === "lock" || o.kind === "multiball") && !t.elements.some((e) => e.type === "saucer" && st[e.id].lock && !st[e.id].hidden))
      fails.push(`${tag}: ${where} ${o.kind} but no lock is lit then`);
    const shut = (d) => d[0] === "@" ? ids(d).some((id) => !st[id].down && !st[id].hidden) : st[d].closed && !(t.byId[d].timed && st[d].moving);
    for (const m of members) if (m.type === "ramp" && m.door && shut(m.door)) fails.push(`${tag}: ${where} rides ${m.id} behind its shut door ${m.door}`);
    if (o.count > MAX_COUNT(o, t) && where !== "bonus") fails.push(`${tag}: ${where} asks for ${o.count} — a phase is a new shot, not a padded count`);
  };
  let changes = 0;
  c.phases.forEach((p, i) => {
    const where = `phase ${i + 1}`;
    if (!p.title || p.title.length > 28) fails.push(`${tag}: ${where} needs a short title`);
    for (const fx of p.start || []) if (apply(fx, where + " start")) changes++;
    check(p, where);
    // The same shot twice running is padding — unless the phase before
    // transformed it (the dragon that was asleep is now flying).
    const prev = c.phases[i - 1];
    const changedIt = prev && (prev.effect || []).some((fx) => { const ref = fx.split(":")[1] || ""; return ref === p.id || ref === "@" + p.group; });
    if (prev && goalKey(p) === goalKey(prev) && !p.jackpot && !p.timer && !changedIt) fails.push(`${tag}: ${where} repeats the phase before it`);
    // a bank of keep-down drops stays down once the phase has toppled it —
    // itself a visible change: the way is open
    if (p.kind === "bank") { const bank = t.elements.filter((e) => e.group === p.group); if (bank.every((e) => e.keep)) { bank.forEach((e) => { st[e.id].down = true; }); changes++; } }
    for (const fx of p.effect || []) if (apply(fx, where)) changes++;
  });
  if (c.bonus) check(c.bonus, "bonus");
  if (c.phases.length < 3) fails.push(`${tag}: a story needs at least three phases`);
  if (changes < 2) fails.push(`${tag}: only ${changes} visible table change(s) — the story must change the table`);
  if (!SPECIAL_FINALE(c.phases[c.phases.length - 1])) fails.push(`${tag}: the finale is an ordinary phase (needs a timer, jackpot, frenzy, lock or multiball)`);
  if (!(c.scoreTarget > 0)) fails.push(`${tag}: needs a score target`);
  if (!PACE[c.pace]) fails.push(`${tag}: unknown pace ${c.pace}`);
}

test("every chapter is a story the table can actually tell, phase by phase", () => {
  const fails = [];
  assert.strictEqual(CHAPTERS.length, 20);
  // PP_WORLDS=0,1 lints only those worlds while one is being written
  const only = process.env.PP_WORLDS ? process.env.PP_WORLDS.split(",").map(Number) : null;
  for (const c of CHAPTERS) if (!only || only.includes(c.world)) walkChapter(c, TABLES.find((x) => x.id === c.table), fails);
  assert.deepStrictEqual(fails, []);
});

test("pacing labels: each world opens with an intro and ends with its finale", () => {
  for (let w = 0; w < WORLDS.length; w++) {
    const chs = CHAPTERS.filter((c) => c.world === w);
    assert.strictEqual(chs[0].pace, "intro", `${WORLDS[w].name} opens with an intro chapter`);
    assert.strictEqual(chs[chs.length - 1].pace, "finale", `${WORLDS[w].name} ends with a finale`);
  }
});

test("concepts arrive one at a time", () => {
  const firstUse = {};
  const kinds = (c) => [...c.phases, ...(c.bonus ? [c.bonus] : [])].map((o) => o.kind);
  CHAPTERS.forEach((c) => kinds(c).forEach((k) => { if (!(k in firstUse)) firstUse[k] = c.idx; }));
  // Chapter 1 is flippers, bumpers, one target, one saucer and a timed chime.
  assert.ok(new Set(kinds(CHAPTERS[0])).size <= 5, `chapter 1 uses ${[...new Set(kinds(CHAPTERS[0]))]}`);
  assert.ok(!kinds(CHAPTERS[0]).includes("ramp"), "ramps from chapter 2");
  assert.ok(firstUse.spell >= 4, "spelling after the first world");
  // two-ball play first arrives as the climax of a world, never before it
  assert.strictEqual(CHAPTERS[firstUse.lock].pace, "finale", "locks first appear in a world finale");
  assert.ok((firstUse.multiball ?? 99) >= firstUse.lock, "multiball only after locks");
  const perChapter = CHAPTERS.map((c) => Object.entries(firstUse).filter(([, i]) => i === c.idx).length);
  // chapter 1 introduces what it uses (capped above); after that, a few at a time
  assert.ok(perChapter.slice(1).every((n) => n <= 3), `new kinds per chapter: ${perChapter}`);
});


test("world star gates rise and stay below one star a chapter plus a little", () => {
  for (let w = 1; w < WORLDS.length; w++) {
    assert.ok(WORLDS[w].stars > WORLDS[w - 1].stars);
    // chapters before world w, at 1.5 stars each (primary plus half the secondaries)
    assert.ok(WORLDS[w].stars <= Math.floor(w * 4 * 1.25), `world ${w + 1} asks for ${WORLDS[w].stars}`);
  }
});

test("daily parade: a date always gives the same table and twist", () => {
  const a = G.dailyConfig("2026-09-23"), b = G.dailyConfig("2026-09-23"), c = G.dailyConfig("2026-09-24");
  assert.deepStrictEqual([a.table, a.twist.id, a.chapterIdx], [b.table, b.twist.id, b.chapterIdx]);
  const seen = new Set();
  for (let d = 1; d <= 60; d++) seen.add(G.dailyConfig(`2026-10-${String(d).padStart(2, "0")}`).table);
  assert.ok(seen.size >= 4, "sixty days visit most of the tables");
  assert.ok(c);
});

test("the art brief lists every asset the renderer can load, at its real size", () => {
  const fs = require("node:fs"), path = require("node:path");
  const brief = fs.readFileSync(path.join(__dirname, "..", "assets", "ART-BRIEF.md"), "utf8");
  const { ASSET_SPECS } = require("../js/assets.js");
  const fails = [];
  for (const s of ASSET_SPECS) {
    const rel = s.file.replace(/^assets\//, "");
    const row = brief.split("\n").find((l) => l.includes("`" + rel + "`"));
    if (!row) { fails.push(`brief does not mention ${rel}`); continue; }
    if (!row.includes(`${s.w} × ${s.h}`)) fails.push(`${rel}: brief size disagrees with ${s.w} × ${s.h}`);
  }
  // and the toys' boxes in the brief match the table data
  for (const t of TABLES) for (const e of t.elements.filter((x) => x.type === "toy")) {
    if (!brief.includes(`(${e.x}, ${e.y}), ${e.w} × ${e.h}`)) fails.push(`brief box for ${e.id} is stale`);
  }
  assert.deepStrictEqual(fails, []);
});

test("the service worker's install never depends on optional art", () => {
  // addAll() is all-or-nothing: one failed image in the shell and the game
  // never becomes available offline. Art is cached afterwards, best effort.
  const fs = require("node:fs"), path = require("node:path");
  const sw = fs.readFileSync(path.join(__dirname, "..", "sw.js"), "utf8");
  const shell = sw.slice(sw.indexOf("const SHELL = ["), sw.indexOf("];", sw.indexOf("const SHELL = [")));
  const art = [...shell.matchAll(/"(assets\/[^"]+)"/g)].map((m) => m[1]).filter((f) => f !== "assets/available.json");
  assert.deepStrictEqual(art, [], "art in the install shell");
  assert.match(sw, /allSettled/, "art is cached one file at a time after install");
  // and every listed art file really exists at its listed path
  const listed = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "assets", "available.json"), "utf8")).files;
  for (const f of listed) assert.ok(fs.existsSync(path.join(__dirname, "..", f)), `${f} is listed but missing`);
});

test("every icon a chapter names is one the renderer draws", () => {
  const fs = require("node:fs"), path = require("node:path");
  const src = fs.readFileSync(path.join(__dirname, "..", "js", "render.js"), "utf8");
  const body = src.slice(src.indexOf("  icon(kind, px, world) {"));
  const drawn = new Set([...body.matchAll(/case "([a-z]+)"/g)].map((m) => m[1]));
  const fails = [];
  for (const c of CHAPTERS) for (const o of [...c.phases, c.bonus].filter(Boolean)) if (!drawn.has(o.icon)) fails.push(`ch${c.idx + 1}: no icon "${o.icon}"`);
  assert.deepStrictEqual(fails, []);
});
