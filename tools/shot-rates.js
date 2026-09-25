// How often does each kind of player hit each shot? The pacing instrument.
//
// Plays a table with everything open (no story, so no bot chases anything)
// and counts, per minute of ball-in-play time, every bumper hit, target hit,
// ramp ride, saucer visit, orbit pass, spinner turn and lane. A phase that
// asks for k of a shot the reference bot makes r times a minute costs about
// k / r minutes — which is how the chapters' lengths are designed, and then
// checked end to end by tests/pacing.test.js.
//
//   node tools/shot-rates.js [table] [minutes] [bots]
//   node tools/shot-rates.js castle 20 child,rosalie,planner
const G = require("../tests/load.js");
const B = require("../tests/bots.js");

const tableId = process.argv[2] || "castle";
const minutes = +(process.argv[3] || 15);
const bots = (process.argv[4] || "child,rosalie,planner").split(",");
const mk = { child: (s) => B.childBrain(s), rosalie: (s) => B.rosalieBrain(s), planner: (s) => B.plannerBrain({ seed: s }), masher: (s) => B.masherBrain(s) };

function rates(bot) {
  const table = G.TABLES.find((t) => t.id === tableId);
  const counts = {};
  let secs = 0, games = 0, balls = 0;
  const bump = (k, n = 1) => { counts[k] = (counts[k] || 0) + n; };
  for (let seed = 1; secs < minutes * 60 && games < 200; seed++) {
    const base = G.freePlayConfig(tableId).state;
    // STILL=1 measures with every mover parked at home (a sleeping dragon)
    const cfg = Object.assign(G.freePlayConfig(tableId), { mode: "chapter", balls: 3, phases: [], state: Object.assign({}, base, { savePost: true, kickback: "auto", ballSave: 12 }, process.env.STILL ? { moving: [] } : {}) });
    const sim = new G.Sim(table, cfg);
    const brain = mk[bot](seed * 13);
    games++;
    for (let i = 0; i < 900 * 480 && !sim.S.over; i++) {
      if (i % 4 === 0) brain.decide(sim);
      sim.step();
      if (sim.ballInPlay()) secs += G.PHYS.DT;
      for (const e of sim.events) {
        if (e.type === "bumper" || e.type === "target" || e.type === "drop" || e.type === "saucer" || e.type === "lock" || e.type === "orbit" || e.type === "ramp") bump(e.id + " " + e.type);
        if (e.type === "spin") bump(e.id + " spin", e.turns);
        if (e.type === "lanes") bump(e.group + " lanes");
        if (e.type === "rollover") bump(e.id + " rollover");
        if (e.type === "rampEnter") bump(e.id + " rampEnter");
        if (e.type === "bank") bump(e.group + " bank");
        if (e.type === "rampShort") bump(e.id + " short");
        if (e.type === "ballLost") balls++;
      }
      sim.events.length = 0;
    }
  }
  const out = {};
  for (const [k, v] of Object.entries(counts)) out[k] = v / (secs / 60);
  return { out, secs, games, ballLife: secs / Math.max(1, balls) };
}

const res = {};
for (const b of bots) res[b] = rates(b);
const keys = [...new Set(bots.flatMap((b) => Object.keys(res[b].out)))].sort();
console.log(`${tableId}: hits per minute of ball-in-play time (${minutes} min per bot)`);
console.log("".padEnd(24) + bots.map((b) => b.padStart(10)).join(""));
for (const k of keys) console.log(k.padEnd(24) + bots.map((b) => (res[b].out[k] || 0).toFixed(2).padStart(10)).join(""));
console.log("ball life (s)".padEnd(24) + bots.map((b) => res[b].ballLife.toFixed(0).padStart(10)).join(""));
