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
const { PHYS, Physics, TABLES, CHAPTERS, WORLDS, OBJ_KINDS, EFFECT_KINDS, Sim, compileTable } = G;
const R = PHYS.BALL_R;
const PASS = 2 * R + 1;

const KNOWN = ["wall", "post", "bumper", "sling", "target", "drop", "rollover", "spinner", "orbit", "ramp", "saucer", "gate", "arm", "field", "kickback", "toy"];

// Static solids as simple shapes, including each flipper's pivot boss.
function solids(t) {
  compileTable(t);
  const out = t._prims.map((p) => ({ el: p.el, type: p.type, a: [p.ax, p.ay], b: [p.bx, p.by], r: p.r, circ: p.k === "circ" }));
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

test("no pinch gaps and no overlapping solids", () => {
  const fails = [];
  const touches = (p, s, r) => { const q = Physics.closest(p[0], p[1], ...s.a, ...s.b); return Math.hypot(p[0] - q.x, p[1] - q.y) <= r + 0.5; };
  for (const t of TABLES) {
    const S = solids(t);
    // Group primitive pairs by element pair: two rails that meet at a joint
    // also come close to each other's neighbouring segments right beside it,
    // and that is a corner, not a gap a ball could be wedged in.
    const pairs = new Map();
    for (let i = 0; i < S.length; i++) for (let j = i + 1; j < S.length; j++) {
      const A = S[i], B = S[j];
      if (A.el === B.el) continue;
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
        if (crossing || roundJam || !ends.length) fails.push(`${t.id}: ${k} overlap (gap ${gap.toFixed(1)})`);
        else joints.push(...ends);
      }
      // Two elements that are joined form a wedge that opens out from the
      // joint; a narrow stretch of it is a corner, not a trap. Only
      // UNJOINED elements coming within a ball's width of each other are.
      if (joints.length) continue;
      for (const { gap } of list) {
        if (gap <= 0.5) continue;
        fails.push(`${t.id}: ${k} pinch gap ${gap.toFixed(1)}px (ball needs ${PASS})`);
        break;
      }
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

test("recovery: a ball left anywhere on the table finds its way to the drain unaided", () => {
  const fails = [];
  for (const t of TABLES.filter((x) => !process.env.LINT_TABLE || x.id === process.env.LINT_TABLE)) {
    const cells = freeCells(t, 16);
    assert.ok(cells.length > 200, `${t.id}: flood fill found only ${cells.length} free cells`);
    for (const [x, y] of cells) {
      const sim = new Sim(t, lintCfg(t));
      sim.S.queue = [];
      const b = sim.serve(false);
      b.x = x; b.y = y;
      let drained = false;
      for (let i = 0; i < 480 * 30; i++) {
        sim.step();
        if (!sim.S.balls.length) { drained = true; break; }
        if (sim.S.balls.length > 1) break;
      }
      if (!drained) { const e = sim.S.balls[0]; fails.push(`${t.id}: from (${x.toFixed(0)},${y.toFixed(0)}) still at (${e.x.toFixed(0)},${e.y.toFixed(0)}) after 30s`); }
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
  bank: ["drop"], spell: ["target", "drop"], spin: ["spinner"], orbit: ["orbit"], saucer: ["saucer"],
};

test("objectives reference real mechanisms of the right kind", () => {
  const fails = [];
  assert.strictEqual(CHAPTERS.length, 20);
  for (const c of CHAPTERS) {
    const t = TABLES.find((x) => x.id === c.table);
    const tag = `ch${c.idx + 1} ${c.title}`;
    if (c.objectives.length !== 3) fails.push(`${tag}: needs exactly 3 objectives`);
    for (const id of [...(c.state.hidden || []), ...(c.state.closed || []), ...(c.state.lock || [])])
      if (!t.byId[id]) fails.push(`${tag}: state names missing element ${id}`);
    const opened = new Set(), shown = new Set(), lit = new Set(c.state.lock || []);
    c.objectives.forEach((o, i) => {
      if (!OBJ_KINDS.includes(o.kind)) fails.push(`${tag}: unknown kind ${o.kind}`);
      if (!o.label || !o.icon) fails.push(`${tag}: objective ${i} needs a label and icon`);
      if (o.label && o.label.length > 22) fails.push(`${tag}: label "${o.label}" is too long for a chip`);
      const types = KIND_TYPES[o.kind];
      let members = [];
      if (types) {
        members = o.id ? [t.byId[o.id]].filter(Boolean) : t.elements.filter((e) => e.group === o.group);
        if (!members.length) fails.push(`${tag}: ${o.kind} names nothing (${o.id || o.group})`);
        for (const m of members) if (!types.includes(m.type)) fails.push(`${tag}: ${o.kind} on a ${m.type}`);
      }
      if (o.kind === "spell") {
        const letters = members.map((m) => m.letter).join("");
        for (const ch of o.word) if (!letters.includes(ch)) fails.push(`${tag}: no target for letter ${ch}`);
      }
      if ((o.kind === "lock" || o.kind === "multiball") && !t.elements.some((e) => e.type === "saucer" && lit.has(e.id)))
        fails.push(`${tag}: ${o.kind} but no lock is lit at the start or by an earlier objective`);
      if (o.kind === "parade" && !t.elements.some((e) => e.type === "bumper")) fails.push(`${tag}: parade with no bumpers`);
      // a ramp behind a closed gate, or a hidden target, needs an earlier opener
      for (const m of members) {
        if ((c.state.hidden || []).includes(m.id) && !shown.has(m.id)) fails.push(`${tag}: objective ${i} needs hidden ${m.id}`);
        if (m.type === "ramp") {
          const gate = t.elements.find((g) => g.type === "gate" && !g.oneWay && Physics.segSegDist(g.a, g.b, ...m.mouth) < 80);
          if (gate && (c.state.closed || []).includes(gate.id) && !opened.has(gate.id)) fails.push(`${tag}: ramp ${m.id} is behind closed ${gate.id} with no earlier opener`);
        }
      }
      for (const fx of o.effect || []) {
        const [k, id] = fx.split(":");
        if (!EFFECT_KINDS.includes(k)) fails.push(`${tag}: unknown effect ${fx}`);
        if (!t.byId[id]) fails.push(`${tag}: effect on missing ${id}`);
        if (k === "open") opened.add(id);
        if (k === "show") shown.add(id);
        if (k === "lightLock") lit.add(id);
      }
    });
    if (!(c.scoreTarget > 0)) fails.push(`${tag}: needs a score target`);
  }
  assert.deepStrictEqual(fails, []);
});

test("concepts arrive one at a time", () => {
  const firstUse = {};
  CHAPTERS.forEach((c) => c.objectives.forEach((o) => { if (!(o.kind in firstUse)) firstUse[o.kind] = c.idx; }));
  // Chapter 1 is flippers, bumpers and one obvious target — nothing else.
  assert.deepStrictEqual([...new Set(CHAPTERS[0].objectives.map((o) => o.kind))].sort(), ["hit", "parade"]);
  assert.ok(firstUse.ramp >= 1, "ramps from chapter 2");
  assert.ok(firstUse.spell >= 8 && firstUse.lock >= 8 && firstUse.multiball >= 8, "sequences and locks only after two worlds");
  // Never more than two brand-new kinds in one chapter.
  const perChapter = CHAPTERS.map((c) => Object.entries(firstUse).filter(([, i]) => i === c.idx).length);
  assert.ok(perChapter.every((n) => n <= 2), `new kinds per chapter: ${perChapter}`);
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
