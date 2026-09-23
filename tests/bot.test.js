"use strict";
// Balance claims, each tested with the bot it is about (see tests/bots.js).
//
//   - Isabelle: the delayed, distractible child finishes the first two worlds
//     on every seed, retrying as a child would, without a skill wall.
//   - Rosalie: the quicker child finishes the whole book the same way.
//   - Skill matters: the planner scores far above both children.
//   - The idle control never earns a real result.
//   - The same inputs replay the same game, bit for bit.
//
// PP_REPORT=1 prints the per-chapter tables these assertions read.

const { test } = require("node:test");
const assert = require("node:assert");
const G = require("./load.js");
const B = require("./bots.js");
const REPORT = !!process.env.PP_REPORT;

// Play chapter after chapter as a child does: retry until the primary is done.
function campaign(make, seed, from, to, maxTries) {
  const rows = [];
  let stars = 0;
  for (let c = from; c < to; c++) {
    let tries = 0, r;
    do { r = B.play(G, G.CHAPTERS[c], make(seed * 1009 + c * 31 + tries * 7)); tries++; } while (!r.won && tries < maxTries);
    stars += r.stars;
    rows.push({ c, tries, won: r.won, stars: r.stars, score: r.score, t: r.seconds, timedOut: r.timedOut });
  }
  return { rows, stars };
}

function check(name, make, seeds, from, to, maxTries, meanCap) {
  const fails = [], all = [];
  let starTotal = 0;
  for (const s of seeds) {
    const { rows, stars } = campaign(make, s, from, to, maxTries);
    starTotal += stars;
    for (const r of rows) {
      all.push(r);
      if (!r.won) fails.push(`${name} seed ${s}: stuck on ch${r.c + 1} ${G.CHAPTERS[r.c].title} after ${r.tries} tries`);
      if (r.timedOut) fails.push(`${name} seed ${s}: ch${r.c + 1} never ended`);
    }
    // world gates: at each world's first chapter, did stars suffice?
    let acc = 0;
    for (const r of rows) {
      const w = G.CHAPTERS[r.c].world;
      if (G.CHAPTERS[r.c].n === 1 && acc < G.WORLDS[w].stars) fails.push(`${name} seed ${s}: only ${acc} stars at world ${w + 1} (needs ${G.WORLDS[w].stars})`);
      acc += r.stars;
    }
  }
  const mean = all.reduce((a, r) => a + r.tries, 0) / all.length;
  if (REPORT) {
    console.log(`\n${name}: mean tries ${mean.toFixed(2)}, stars/seed ${(starTotal / seeds.length).toFixed(1)}`);
    for (let c = from; c < to; c++) {
      const rs = all.filter((r) => r.c === c);
      console.log(`  ch${String(c + 1).padStart(2)} ${G.CHAPTERS[c].title.padEnd(22)} tries ${rs.map((r) => r.tries).join(",").padEnd(12)} ★ ${rs.map((r) => r.stars).join(",")}`);
    }
  }
  assert.deepStrictEqual(fails, []);
  assert.ok(mean <= meanCap, `${name}: mean tries ${mean.toFixed(2)} > ${meanCap}`);
  return { mean, starTotal };
}

test("Isabelle's bot finishes the first two worlds on every seed", () => {
  check("child", (s) => B.childBrain(s), [1, 2, 3, 4], 0, 8, 8, 2.6);
});

test("Rosalie's bot finishes the whole book on every seed", () => {
  check("rosalie", (s) => B.rosalieBrain(s), [1, 2, 3], 0, 20, 8, 2.2);
});

test("the planner clears every chapter it tries, averaging well over two stars", () => {
  // The guardrail: nothing in the book is beyond a competent player. It gets
  // a retry, like anyone; PP_FULL=1 checks all twenty (slow).
  const picks = process.env.PP_FULL ? G.CHAPTERS.map((c) => c.idx) : [3, 7, 10, 14, 17, 19];
  const fails = [];
  let stars = 0;
  for (const c of picks) {
    let r, k = 0;
    do { r = B.play(G, G.CHAPTERS[c], B.plannerBrain({ seed: 1 + k })); k++; } while (!r.won && k < 3);
    stars += r.stars;
    if (!r.won) fails.push(`ch${c + 1}: not cleared in 3 tries`);
  }
  assert.deepStrictEqual(fails, []);
  assert.ok(stars / picks.length >= 2.3, `planner averaged ${(stars / picks.length).toFixed(2)} stars`);
});

test("skill matters: planner ≫ Rosalie > child, and mashing is not a strategy", () => {
  const picks = [1, 5, 9, 13, 17];
  const mean = (make, n) => {
    let s = 0, k = 0;
    for (const c of picks) for (let i = 0; i < n; i++) { s += B.play(G, G.CHAPTERS[c], make(500 + i * 13 + c)).score; k++; }
    return s / k;
  };
  const planner = mean(() => B.plannerBrain(), 1);
  const rosalie = mean((s) => B.rosalieBrain(s), 3);
  const child = mean((s) => B.childBrain(s), 3);
  const masher = mean((s) => B.masherBrain(s), 3);
  if (REPORT) console.log({ planner, rosalie, child, masher });
  assert.ok(planner > 1.6 * rosalie, `planner ${planner} vs rosalie ${rosalie}`);
  assert.ok(rosalie > 1.1 * child, `rosalie ${rosalie} vs child ${child}`);
  assert.ok(child > masher, `child ${child} vs masher ${masher}`);
});

test("the idle control never earns a real result", () => {
  // It launches and never flips. With the save post up it can loop for a
  // long time, so the claim is about RESULTS, not about draining: it never
  // takes a second star and clears almost nothing.
  let wins = 0;
  const fails = [];
  for (const c of G.CHAPTERS) {
    const r = B.play(G, c, B.idleBrain(), { cap: 300 });
    if (r.won) wins++;
    if (r.stars > 1) fails.push(`ch${c.idx + 1}: idle took ${r.stars} stars`);
  }
  assert.deepStrictEqual(fails, []);
  assert.ok(wins <= 2, `idle cleared ${wins} chapters`);
});

test("replay: the same inputs give the same game, and a clone runs identically", () => {
  const cfg = G.CHAPTERS[10];
  const table = G.TABLES.find((t) => t.id === cfg.table);
  const brain = B.masherBrain(42);
  const rec = new G.Sim(table, cfg);
  rec.events = null;
  const trace = [];
  let fork = null;
  for (let i = 0; i < 480 * 90 && !rec.S.over; i++) {
    if (i % 4 === 0) brain.decide(rec);
    trace.push((rec.input.left ? 1 : 0) | (rec.input.right ? 2 : 0) | (rec.input.launch ? 4 : 0));
    if (i === 480 * 30) fork = { at: i, sim: rec.clone() };
    rec.step();
  }
  const play = (sim, from) => {
    for (let i = from; i < trace.length; i++) {
      const b = trace[i];
      sim.input.left = !!(b & 1); sim.input.right = !!(b & 2); sim.input.launch = !!(b & 4);
      sim.step();
    }
    return JSON.stringify(sim.S);
  };
  const again = new G.Sim(table, cfg);
  again.events = null;
  const want = JSON.stringify(rec.S);
  assert.strictEqual(play(again, 0), want, "fresh replay diverged");
  assert.strictEqual(play(fork.sim, fork.at), want, "clone diverged");
  assert.ok(rec.S.score > 0 && rec.S.stats.launches > 0, "the trace actually played");
});

test("the engine has no randomness and no DOM", () => {
  const fs = require("node:fs"), path = require("node:path");
  for (const f of ["physics.js", "tables.js", "chapters.js", "game.js"]) {
    const src = fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    assert.ok(!/Math\.random\s*\(/.test(src), `${f} calls Math.random`);
    assert.ok(!/\bdocument\.|\bwindow\.|getContext\s*\(/.test(src), `${f} touches the DOM`);
  }
});

test("bad frame times cannot move the simulation backwards", () => {
  // The engine only ever advances by its own fixed step; the frame loop owns
  // the accumulator. Stepping is the only way time passes.
  const sim = new G.Sim(G.TABLES[0], G.CHAPTERS[0]);
  const t0 = sim.S.t;
  sim.step();
  assert.ok(Math.abs(sim.S.t - t0 - G.PHYS.DT) < 1e-12);
});
