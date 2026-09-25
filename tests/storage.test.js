"use strict";
// The progress merge and the progression rules. Every merge property is
// asserted in both argument orders — which device syncs first is a coin toss.

const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const { loadScripts } = require("../lib/tools/test-harness.js");

const S = loadScripts({
  baseDir: path.join(__dirname, ".."),
  files: ["lib/gk-util.js", "lib/gk-audio.js", "lib/gk-storage.js", "tests/fake-firebase.js",
    "js/physics.js", "js/tables.js", "js/chapters.js", "js/storage.js"],
  exports: ["PROGRESS", "Progress", "Storage", "CHAPTERS", "WORLDS", "freePlayConfig", "dailyConfig"],
  browser: true,
  globals: { structuredClone },
});
const { PROGRESS, Progress, CHAPTERS, WORLDS } = S;
const blank = () => PROGRESS.blank();
const bothWays = (a, b, check) => { check(PROGRESS.merge(a, b)); check(PROGRESS.merge(b, a)); };

test("a blank save has every field the game reads", () => {
  const p = blank();
  for (const k of ["chapters", "tables", "worldsOpen", "dailyDate", "dailyScore", "dailyDone", "stats", "updated"]) assert.ok(k in p, k);
  assert.strictEqual(Progress.nextChapter(p), 0);
  assert.ok(Progress.chapterOpen(p, 0) && !Progress.chapterOpen(p, 1));
});

test("merge keeps the best of each chapter and table, never loses one", () => {
  const phone = { ...blank(), chapters: { 0: { stars: 3, best: 9000 }, 1: { stars: 1, best: 20000 } }, tables: { castle: 50000 } };
  const pad = { ...blank(), chapters: { 1: { stars: 2, best: 12000 }, 2: { stars: 1, best: 5000 } }, tables: { castle: 30000, temple: 8000 } };
  bothWays(phone, pad, (m) => {
    assert.deepStrictEqual({ ...m.chapters[0] }, { stars: 3, best: 9000 });
    assert.deepStrictEqual({ ...m.chapters[1] }, { stars: 2, best: 20000 });
    assert.ok(m.chapters[2]);
    assert.strictEqual(m.tables.castle, 50000);
    assert.strictEqual(m.tables.temple, 8000);
  });
});

test("merge moves the daily date and score together", () => {
  const old = { ...blank(), dailyDate: "2026-09-22", dailyScore: 90000, dailyDone: 3 };
  const today = { ...blank(), dailyDate: "2026-09-23", dailyScore: 1000, dailyDone: 4 };
  bothWays(old, today, (m) => {
    assert.strictEqual(m.dailyDate, "2026-09-23");
    assert.strictEqual(m.dailyScore, 1000, "yesterday's score leaked onto today");
    assert.strictEqual(m.dailyDone, 4);
  });
});

test("merge keeps fields a newer build added", () => {
  bothWays({ ...blank(), futureThing: 7 }, blank(), (m) => assert.strictEqual(m.futureThing, 7));
});

test("record: only a cleared primary records a chapter; stars never go down", () => {
  const p = blank();
  const cfg = CHAPTERS[0];
  Progress.record(p, cfg, { stars: 0, score: 5000, seconds: 30, stats: {} });
  assert.ok(!p.chapters[0], "a lost chapter must not unlock the next");
  Progress.record(p, cfg, { stars: 3, score: 9000, seconds: 30, stats: { bumpers: 5 } });
  Progress.record(p, cfg, { stars: 1, score: 12000, seconds: 30, stats: {} });
  assert.deepStrictEqual({ ...p.chapters[0] }, { stars: 3, best: 12000 });
  assert.strictEqual(p.stats.games, 3);
  assert.strictEqual(p.stats.bumpers, 5);
  assert.ok(Progress.chapterOpen(p, 1));
});

test("worlds open on the last chapter of the previous world plus the star gate", () => {
  const p = blank();
  for (let i = 0; i < 4; i++) p.chapters[i] = { stars: 1, best: 1 };
  assert.ok(Progress.worldOpen(p, 1), "4 one-star chapters open world 2 (gate is 4)");
  for (let i = 4; i < 8; i++) p.chapters[i] = { stars: 1, best: 1 };
  assert.ok(!Progress.worldOpen(p, 2), "8 stars is short of world 3's 9");
  assert.match(Progress.worldNeeds(p, 2), /1 more star/);
  p.chapters[0].stars = 2;
  assert.ok(Progress.worldOpen(p, 2));
  assert.strictEqual(Progress.nextChapter(p), 8);
});

test("free play and daily record their own bests", () => {
  const p = blank();
  Progress.record(p, S.freePlayConfig("sea"), { score: 4000, seconds: 10, stats: {} });
  Progress.record(p, S.freePlayConfig("sea"), { score: 3000, seconds: 10, stats: {} });
  assert.strictEqual(p.tables.sea, 4000);
  const d = S.dailyConfig("2026-09-23");
  Progress.record(p, d, { score: 700, seconds: 10, stats: {} });
  Progress.record(p, d, { score: 500, seconds: 10, stats: {} });
  assert.deepStrictEqual([p.dailyDate, p.dailyScore, p.dailyDone], ["2026-09-23", 700, 1]);
  assert.ok(!Object.keys(p.chapters).length, "a daily must not record a chapter");
});

test("real play is logged for pacing: time and games until the first clear, then frozen", () => {
  const p = blank();
  const cfg = Object.assign({ mode: "chapter" }, CHAPTERS[1]);
  Progress.record(p, cfg, { told: false, stars: 0, score: 5000, seconds: 140, checkpoint: { phase: 2, score: 4000, bonus: false }, stats: {} }, 1000);
  assert.deepStrictEqual({ ...p.paceRun[1] }, { secs: 140, games: 1 });
  assert.deepStrictEqual({ ...p.resume }, { idx: 1, at: 1000, phase: 2, score: 4000, bonus: false }, "an unfinished story leaves a checkpoint");
  assert.strictEqual(Progress.resumeFor(p, 1).phase, 2);
  assert.strictEqual(Progress.resumeFor(p, 0), null);
  Progress.record(p, cfg, { told: true, stars: 2, score: 60000, seconds: 200, checkpoint: null, stats: {} }, 2000);
  assert.deepStrictEqual({ ...p.pace[1] }, { secs: 340, games: 2 });
  assert.ok(!p.paceRun[1], "the running tally moves into the log");
  assert.strictEqual(Progress.resumeFor(p, 1), null, "a told story clears its checkpoint");
  Progress.record(p, cfg, { told: true, stars: 3, score: 90000, seconds: 50, checkpoint: null, stats: {} }, 3000);
  assert.deepStrictEqual({ ...p.pace[1] }, { secs: 340, games: 2 }, "a replay never rewrites the first-clear time");
});

test("merge keeps the first-clear pace, the longest running tally, and the newest checkpoint", () => {
  const phone = { ...blank(), pace: { 0: { secs: 150, games: 1 } }, paceRun: { 1: { secs: 90, games: 1 } }, resume: { idx: 1, phase: 2, score: 1, at: 50 } };
  const pad = { ...blank(), pace: { 1: { secs: 400, games: 3 } }, paceRun: { 1: { secs: 300, games: 2 }, 2: { secs: 60, games: 1 } }, resume: { idx: 2, phase: 1, score: 2, at: 90 } };
  bothWays(phone, pad, (m) => {
    assert.deepStrictEqual({ ...m.pace[0] }, { secs: 150, games: 1 });
    assert.deepStrictEqual({ ...m.pace[1] }, { secs: 400, games: 3 });
    assert.ok(!m.paceRun[1], "a chapter cleared on either device is no longer running");
    assert.deepStrictEqual({ ...m.paceRun[2] }, { secs: 60, games: 1 });
    assert.strictEqual(m.resume.idx, 2, "the newer checkpoint wins");
  });
});
