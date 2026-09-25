"use strict";
// Balance claims, each tested with the bot it is about (see tests/bots.js).
// Chapters are played the way the family plays them: a game that runs out of
// balls part-way carries on from its checkpoint (B.story).
//
//   - Isabelle: the delayed, distractible child tells every story of the
//     first two worlds on every seed, with the star gates met.
//   - Rosalie: the quicker child tells the whole book the same way.
//   - Skill matters: better players tell the same stories faster, and a
//     random masher is no strategy.
//   - The idle control never tells a story.
//   - The same inputs replay the same game, bit for bit.
// Pacing (how long each chapter takes) is tests/pacing.test.js.
//
// PP_REPORT=1 prints the per-chapter tables these assertions read.

const { test } = require("node:test");
const assert = require("node:assert");
const G = require("./load.js");
const B = require("./bots.js");
const REPORT = !!process.env.PP_REPORT;

// Play chapter after chapter as a child does, checking each world's star gate.
function campaign(name, make, seed, from, to) {
  const rows = [], fails = [];
  let stars = 0;
  for (let c = from; c < to; c++) {
    const ch = G.CHAPTERS[c];
    if (ch.n === 1 && stars < G.WORLDS[ch.world].stars) fails.push(`${name} seed ${seed}: only ${stars} stars at world ${ch.world + 1} (needs ${G.WORLDS[ch.world].stars})`);
    const r = B.story(G, ch, make, seed, 14);
    if (!r.told) fails.push(`${name} seed ${seed}: ch${c + 1} ${ch.title} not told in ${r.tries} games`);
    if (r.timedOut) fails.push(`${name} seed ${seed}: ch${c + 1} a game never ended`);
    stars += r.stars;
    rows.push({ c, games: r.tries, stars: r.stars, secs: r.total });
  }
  return { rows, stars, fails };
}

function check(name, make, seeds, from, to) {
  const fails = [], all = [];
  for (const s of seeds) {
    const got = campaign(name, make, s, from, to);
    fails.push(...got.fails);
    all.push(...got.rows);
  }
  if (REPORT) {
    console.log(`\n${name}:`);
    for (let c = from; c < to; c++) {
      const rs = all.filter((r) => r.c === c);
      console.log(`  ch${String(c + 1).padStart(2)} ${G.CHAPTERS[c].title.padEnd(22)} games ${rs.map((r) => r.games).join(",").padEnd(10)} ★ ${rs.map((r) => r.stars).join(",")}`);
    }
  }
  assert.deepStrictEqual(fails, []);
}

test("Isabelle's bot tells every story of the first two worlds on every seed", () => {
  check("child", (s) => B.childBrain(s), [1, 2, 3], 0, 8);
});

test("Rosalie's bot tells the whole book on every seed, meeting every star gate", () => {
  check("rosalie", (s) => B.rosalieBrain(s), [1, 2], 0, 20);
});

test("the planner tells every story it tries — nothing in the book is beyond a competent player", () => {
  // The guardrail: nothing in the book is beyond a competent player.
  // PP_FULL=1 checks all twenty (slow).
  const picks = process.env.PP_FULL ? G.CHAPTERS.map((c) => c.idx) : [0, 7, 13];
  // (It rushes the story, so it is no judge of the stars: the pacing suite
  // checks those are earnable, with the Rosalie bot.)
  const fails = [];
  for (const c of picks) {
    const r = B.story(G, G.CHAPTERS[c], (s) => B.plannerBrain({ seed: s }), 1, 4);
    if (REPORT) console.log(`  planner ch${c + 1}: ${r.total}s, ${r.tries} game(s), ★${r.stars}`);
    if (!r.told) fails.push(`ch${c + 1}: not told in ${r.tries} games`);
    if (r.total > 20 * 60) fails.push(`ch${c + 1}: took the planner ${Math.round(r.total / 60)} minutes`);
  }
  assert.deepStrictEqual(fails, []);
});

test("skill matters: better players tell the same story faster, and mashing is not a strategy", () => {
  const picks = [1, 5, 9];
  const time = (make, seeds) => {
    let s = 0, n = 0;
    for (const c of picks) for (const seed of seeds) { s += B.story(G, G.CHAPTERS[c], make, seed, 14).total; n++; }
    return s / n;
  };
  const planner = time((s) => B.plannerBrain({ seed: s }), [1]);
  const rosalie = time((s) => B.rosalieBrain(s), [11, 12, 13]);
  const child = time((s) => B.childBrain(s), [11, 12, 13]);
  // the masher gets a fixed number of games per chapter; count stories told
  let mashed = 0, childTold = 0;
  for (const c of picks) for (const s of [11, 12, 13]) {
    if (B.story(G, G.CHAPTERS[c], (x) => B.masherBrain(x), s, 3).told) mashed++;
    if (B.story(G, G.CHAPTERS[c], (x) => B.childBrain(x), s, 3).told) childTold++;
  }
  if (REPORT) console.log({ planner, rosalie, child, mashed, childTold });
  assert.ok(planner < rosalie, `planner ${planner}s vs rosalie ${rosalie}s`);
  assert.ok(rosalie < child * 1.05, `rosalie ${rosalie}s vs child ${child}s`);
  assert.ok(childTold > mashed, `in three games: child told ${childTold}, masher ${mashed}`);
});

test("the idle control never tells a story", () => {
  // It launches and never flips. With the save post up it can loop for a
  // long time, so the claim is about RESULTS: no story, no stars.
  const fails = [];
  for (const c of G.CHAPTERS) {
    const r = B.play(G, Object.assign({ mode: "chapter" }, c), B.idleBrain(), { cap: 300 });
    if (r.told || r.stars) fails.push(`ch${c.idx + 1}: idle told the story (★${r.stars})`);
  }
  assert.deepStrictEqual(fails, []);
});

test("replay: the same inputs give the same game, and a clone runs identically", () => {
  const cfg = Object.assign({ mode: "chapter" }, G.CHAPTERS[2]);   // the flying dragon: movers too
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

test("a checkpoint puts the table back exactly as the story left it", () => {
  // Resuming at phase k must give the same table state as playing phases
  // 0…k-1 for real: gates, hidden things, movers and banks.
  const fails = [];
  for (const ch of G.CHAPTERS) {
    const t = G.TABLES.find((x) => x.id === ch.table);
    const live = new G.Sim(t, Object.assign({ mode: "chapter" }, ch));
    live.events = null;
    for (let k = 1; k < ch.phases.length; k++) {
      // play the phase out as a player would: a bank phase knocks its drops down
      const p = ch.phases[k - 1];
      if (p.kind === "bank") for (const e of t.elements) if (e.group === p.group && e.type === "drop") live.S.el[e.id].down = true;
      live.completePhase();
      const res = new G.Sim(t, Object.assign({ mode: "chapter" }, ch, { resume: { phase: k, score: 0 } }));
      for (const id in live.S.el) {
        const a = live.S.el[id], b = res.S.el[id];
        const keepDrop = t.byId[id].type === "drop" && t.byId[id].keep;
        for (const f of ["hidden", "closed", "lock", "moving", "awake", ...(keepDrop ? ["down"] : [])]) if (a[f] !== b[f]) fails.push(`ch${ch.idx + 1} phase ${k + 1}: ${id}.${f} is ${b[f]} on resume, ${a[f]} in play`);
      }
    }
  }
  assert.deepStrictEqual(fails.slice(0, 20), []);
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
  const sim = new G.Sim(G.TABLES[0], Object.assign({ mode: "chapter" }, G.CHAPTERS[0]));
  const t0 = sim.S.t;
  sim.step();
  assert.ok(Math.abs(sim.S.t - t0 - G.PHYS.DT) < 1e-12);
});
