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
