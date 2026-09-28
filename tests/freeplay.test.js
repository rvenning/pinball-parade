"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { loadScripts } = require("../lib/tools/test-harness.js");

const { Sim, TABLES, WORLDS, freePlayConfig } = loadScripts({
  baseDir: path.join(__dirname, ".."),
  files: ["js/physics.js", "js/tables.js", "js/chapters.js", "js/game.js"],
  exports: ["Sim", "TABLES", "WORLDS", "freePlayConfig"],
  globals: { structuredClone },
});

test("every table is directly playable with three balls and its mechanisms awake", () => {
  for (const world of WORLDS) {
    const cfg = freePlayConfig(world.table);
    const sim = new Sim(TABLES.find((t) => t.id === world.table), cfg);
    assert.equal(cfg.title, world.name);
    assert.equal(sim.S.ballsLeft, 3);
    assert.equal(sim.S.el[Object.keys(sim.S.el).find((id) => sim.S.el[id].lock)].lock, true);
    assert.equal(cfg.state.ballSave, 10);
  }
});

test("alternating shots build a capped jackpot and repeat or timeout resets it", () => {
  const sim = new Sim(TABLES[0], freePlayConfig("castle"));
  sim.featureShot("bridge", 100, 100);
  sim.featureShot("keep", 100, 100);
  assert.equal(sim.S.combo.chain, 2);
  assert.equal(sim.S.score, 3000);
  sim.featureShot("keep", 100, 100);
  assert.equal(sim.S.combo.chain, 1);
  sim.S.t += 9;
  sim.featureShot("bridge", 100, 100);
  assert.equal(sim.S.combo.chain, 1);
});
