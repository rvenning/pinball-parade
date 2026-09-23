// Balance report: every chapter, every bot, several seeds. Prints the table
// the tests assert on, so tuning reads the same numbers the suite does.
//   node tools/balance.js [fromCh] [toCh] [seeds]
const G = require("../tests/load.js");
const B = require("../tests/bots.js");
const from = +(process.argv[2] || 1) - 1, to = +(process.argv[3] || 20), seeds = +(process.argv[4] || 3);
const only = (process.env.BOTS || "idle,masher,child,planner").split(",");
const make = { idle: () => B.idleBrain(), masher: (s) => B.masherBrain(s), child: (s) => B.childBrain(s), rosalie: (s) => B.rosalieBrain(s), planner: () => B.plannerBrain() };
const pad = (s, n) => String(s).padEnd(n);
console.log(pad("ch", 26) + only.map((b) => pad(b + " win% ★ score t", 30)).join(""));
for (let c = from; c < to; c++) {
  const cfg = G.CHAPTERS[c];
  let line = pad(`${c + 1} ${cfg.title}`, 26);
  for (const name of only) {
    const n = name === "planner" || name === "idle" ? 1 : seeds;
    let wins = 0, stars = 0, score = 0, tt = 0, to2 = 0;
    const t0 = Date.now();
    for (let s = 0; s < n; s++) {
      const r = B.play(G, cfg, make[name](1000 + s * 77 + c));
      wins += r.won ? 1 : 0; stars += r.stars; score += r.score; tt += r.seconds; to2 += r.timedOut ? 1 : 0;
    }
    line += pad(`${Math.round(100 * wins / n)}% ${(stars / n).toFixed(1)} ${Math.round(score / n)} ${Math.round(tt / n)}s${to2 ? " TO" + to2 : ""} [${((Date.now() - t0) / 1000).toFixed(0)}]`, 30);
  }
  console.log(line);
}
