// Shared loader for the suites and the tools: runs the REAL engine sources in
// a vm sandbox, in index.html order. render/input/main are deliberately
// absent — if game.js ever reaches for the DOM, these suites fail to load.
const path = require("node:path");
const { loadScripts } = require("../lib/tools/test-harness.js");

const ROOT = path.join(__dirname, "..");
module.exports = loadScripts({
  baseDir: ROOT,
  files: ["js/physics.js", "js/tables.js", "js/chapters.js", "js/game.js"],
  exports: ["PHYS", "Physics", "TABLES", "TABLE_W", "TABLE_H", "CX", "CHAPTERS", "WORLDS", "OBJ_KINDS", "EFFECT_KINDS",
    "freePlayConfig", "dailyConfig", "starsFor", "TWISTS", "PACE", "Sim", "compileTable", "rampPoint", "armAngle", "gateShut", "moverOffset", "LAUNCH", "PTS", "LOCK_N", "STUCK"],
  globals: { structuredClone },
});
