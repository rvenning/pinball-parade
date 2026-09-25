// Balance report: every chapter played the way the family plays it (carry on
// from the checkpoint until the story is told), by the child and Rosalie bots
// over several seeds. Prints minutes, games, final scores and stars, and a
// suggested score target — the third star should need a GOOD game, so the
// suggestion is about 1.1 × Rosalie's median final score.
//   node tools/balance.js [fromCh] [toCh] [seeds]
const G = require("../tests/load.js");
const B = require("../tests/bots.js");
const from = +(process.argv[2] || 1) - 1, to = +(process.argv[3] || 20), seeds = +(process.argv[4] || 5);
const med = (a) => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const pad = (s, n) => String(s).padEnd(n);
console.log(pad("ch", 26) + pad("band", 8) + pad("rosalie min", 13) + pad("games", 12) + pad("score med", 11) + pad("★ now", 12) + pad("target", 9) + pad("suggest", 9) + "child min");
for (let c = from; c < to; c++) {
  const ch = G.CHAPTERS[c];
  const ro = Array.from({ length: seeds }, (_, s) => B.story(G, ch, (x) => B.rosalieBrain(x), s + 1));
  const ki = ch.world <= 1 ? Array.from({ length: Math.min(4, seeds) }, (_, s) => B.story(G, ch, (x) => B.childBrain(x), s + 1)) : [];
  const score = med(ro.map((r) => r.score));
  const suggest = Math.round((score * 1.1) / 5000) * 5000;
  console.log(pad(`${c + 1} ${ch.title}`, 26) + pad(G.PACE[ch.pace].join("–"), 8) + pad((med(ro.map((r) => r.total)) / 60).toFixed(1), 13) +
    pad(ro.map((r) => r.tries).join(","), 12) + pad(score, 11) + pad(ro.map((r) => r.stars).join(","), 12) + pad(ch.scoreTarget, 9) + pad(suggest, 9) +
    (ki.length ? (med(ki.map((r) => r.total)) / 60).toFixed(1) : "–"));
}
