"use strict";
// Pacing is designed, so it is tested. Every chapter is played the way the
// family plays it — a game that runs out of balls carries on from its
// checkpoint — and the total time across those games is what "how long is a
// chapter" means.
//
//   - The Rosalie bot (the book's reference player) takes 2–4 minutes on a
//     world's intro chapter, 4–7 on the middle chapters and 6–10 on the
//     world's finale (median over its seeds).
//   - The Isabelle bot finishes every chapter of the first two worlds, and
//     never takes more than half as long again as the band allows.
//   - Nobody finishes chapter 1 in under a minute — not even the planner.
//   - The time comes from the story, not from one grind: no single phase
//     takes more than half of a chapter's time.
//
// PP_REPORT=1 prints the per-chapter table. PP_WORLDS=0,1 limits the run.

const { test } = require("node:test");
const assert = require("node:assert");
const G = require("./load.js");
const B = require("./bots.js");
const REPORT = !!process.env.PP_REPORT;
const WORLDS_ON = process.env.PP_WORLDS ? process.env.PP_WORLDS.split(",").map(Number) : [0, 1, 2, 3, 4];
const chapters = G.CHAPTERS.filter((c) => WORLDS_ON.includes(c.world));
const median = (a) => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const mins = (s) => (s / 60).toFixed(1);

function measure(make, seeds, list) {
  return list.map((c) => {
    const runs = seeds.map((s) => B.story(G, c, make, s));
    return { c, runs, med: median(runs.map((r) => r.total)) };
  });
}

const ROSALIE_SEEDS = [1, 2, 3, 4, 5];
const rosalie = measure((s) => B.rosalieBrain(s), ROSALIE_SEEDS, chapters);

if (REPORT) {
  console.log("\nRosalie bot, minutes per chapter (median of " + ROSALIE_SEEDS.length + ", games in brackets) · seconds per phase");
  for (const { c, runs, med } of rosalie) {
    const band = G.PACE[c.pace];
    const pt = c.phases.map((_, i) => Math.round(runs.reduce((a, r) => a + r.phaseTime[i], 0) / runs.length));
    console.log(`  ch${String(c.idx + 1).padStart(2)} ${c.title.padEnd(24)} ${mins(med).padStart(4)}m  [${band[0]}–${band[1]}]  ` +
      `games ${runs.map((r) => r.tries).join(",").padEnd(10)} ★ ${runs.map((r) => r.stars).join(",")}  phases ${pt.join("/")}`);
  }
}

test("the Rosalie bot's chapters land in their pacing band", () => {
  const fails = [];
  for (const { c, runs, med } of rosalie) {
    const [lo, hi] = G.PACE[c.pace];
    if (runs.some((r) => !r.told)) fails.push(`ch${c.idx + 1} ${c.title}: not told in ${runs.find((r) => !r.told).tries} games`);
    if (med < lo * 60 || med > hi * 60) fails.push(`ch${c.idx + 1} ${c.title}: ${mins(med)} min, wants ${lo}–${hi} (${c.pace})`);
  }
  assert.deepStrictEqual(fails, []);
});

test("the time comes from the story, not one grind: no phase takes over half a chapter", () => {
  const fails = [];
  for (const { c, runs } of rosalie) {
    const tot = runs.reduce((a, r) => a + r.total, 0);
    c.phases.forEach((p, i) => {
      const share = runs.reduce((a, r) => a + r.phaseTime[i], 0) / tot;
      if (share > 0.5) fails.push(`ch${c.idx + 1} ${c.title}: “${p.title}” is ${Math.round(share * 100)}% of the chapter`);
    });
  }
  assert.deepStrictEqual(fails, []);
});

test("every star is earnable and none is free (Rosalie bot, five seeds)", () => {
  // The bonus and the score target are each earned on at least one seed; three
  // stars do not come on every seed. The runs record the last game's bonus.
  const fails = [];
  for (const { c, runs } of rosalie) {
    if (!runs.some((r) => r.bonus)) fails.push(`ch${c.idx + 1} ${c.title}: nobody got the bonus “${c.bonus.label}”`);
    if (!runs.some((r) => r.score >= c.scoreTarget)) fails.push(`ch${c.idx + 1} ${c.title}: nobody reached ${c.scoreTarget}`);
    if (runs.every((r) => r.stars === 3)) fails.push(`ch${c.idx + 1} ${c.title}: three stars on every seed`);
  }
  assert.deepStrictEqual(fails, []);
});

test("the Isabelle bot tells every story of the first two worlds, within half as long again", () => {
  const list = chapters.filter((c) => c.world <= 1);
  const got = measure((s) => B.childBrain(s), [1, 2, 3, 4], list);
  const fails = [];
  for (const { c, runs, med } of got) {
    const hi = G.PACE[c.pace][1];
    if (REPORT) console.log(`  child ch${c.idx + 1} ${c.title.padEnd(24)} ${mins(med)}m games ${runs.map((r) => r.tries).join(",")}`);
    for (const r of runs) if (!r.told) fails.push(`ch${c.idx + 1} ${c.title}: not told in ${r.tries} games`);
    if (med > hi * 60 * 1.5) fails.push(`ch${c.idx + 1} ${c.title}: ${mins(med)} min for Isabelle (cap ${hi * 1.5})`);
  }
  assert.deepStrictEqual(fails, []);
});

test("nobody finishes chapter 1 in under a minute — not even the planner", () => {
  if (!WORLDS_ON.includes(0)) return;
  const fails = [];
  for (const [name, make] of [["planner", (s) => B.plannerBrain({ seed: s })], ["rosalie", (s) => B.rosalieBrain(s)], ["child", (s) => B.childBrain(s)]]) {
    for (const s of [1, 2, 3]) {
      const r = B.story(G, G.CHAPTERS[0], make, s);
      if (REPORT) console.log(`  ch1 ${name} seed ${s}: ${r.total}s in ${r.tries} game(s)`);
      if (r.told && r.total < 60) fails.push(`${name} seed ${s} told chapter 1 in ${r.total}s`);
    }
  }
  assert.deepStrictEqual(fails, []);
});
