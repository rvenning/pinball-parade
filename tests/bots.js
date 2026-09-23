// Headless players. Every one of them drives the REAL engine through the same
// three booleans the touch controls set — no shortcuts into game state.
//
//   idle       launches and never flips: the control. Must earn little.
//   masher     an enthusiastic random flipper (seeded): Isabelle having fun.
//   child      reacts to where the ball WAS a moment ago, sometimes looks
//              away (attention is a state with durations, not a per-step coin
//              flip), holds too long, flips a bit early. The claim that the
//              early campaign is finishable is a claim about this bot.
//   planner    the competent player: at each approach it clones the game and
//              tries a handful of flip timings, keeping the one that makes
//              the most objective progress without draining. It sees exactly
//              what is on screen and nothing more — it simply thinks faster.

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const STEP = 1 / 480;
const TICK = 4;                     // brains decide at 120 Hz
const ZONE_Y = 560;                 // the band above the flippers

// ------------------------------------------------------------------ brains --
function idleBrain() {
  return { name: "idle", decide(sim) { launcher(sim, this, () => 0.05); } };
}

// Plunger habit shared by the brains: press when a ball is waiting, hold for
// however long the brain likes, let go.
function launcher(sim, br, holdFn) {
  if (br._hold === undefined) br._hold = -1;
  if (br._hold < 0 && sim.readyBall() && !sim.readyBall().auto) br._hold = holdFn();
  if (br._hold >= 0) {
    sim.input.launch = true;
    br._hold -= STEP * TICK;
    if (br._hold < 0) { sim.input.launch = false; br._hold = -2; }
  } else if (br._hold === -2) { sim.input.launch = false; br._hold = -1; }
}

function masherBrain(seed) {
  const r = rng(seed);
  const hold = [0, 0], rest = [0, 0];
  return {
    name: "masher",
    decide(sim) {
      launcher(sim, this, () => r() * 1.1);
      for (let i = 0; i < 2; i++) {
        if (hold[i] > 0) { hold[i] -= STEP * TICK; if (hold[i] <= 0) rest[i] = 0.05 + r() * 0.5; continue; }
        if (rest[i] > 0) { rest[i] -= STEP * TICK; continue; }
        if (r() < 0.06) hold[i] = 0.08 + r() * 0.45;
      }
      sim.input.left = hold[0] > 0;
      sim.input.right = hold[1] > 0;
    },
  };
}

function childBrain(seed, opts = {}) {
  const r = rng(seed);
  const delay = opts.delay ?? 0.22;          // seconds behind the real ball
  const lapseEvery = opts.lapseEvery ?? 7;   // mean seconds between looking away
  const lapseFor = opts.lapseFor ?? 1.2;     // mean seconds spent looking away
  const hist = [];
  let attentive = true, flipT = lapseEvery * (0.5 + r());
  const hold = [0, 0], cool = [0, 0];
  return {
    name: "child",
    decide(sim) {
      launcher(sim, this, () => 0.02 + r() * 0.9);
      const t = sim.S.t;
      const ball = sim.S.balls.filter((b) => b.mode === "play").sort((a, b) => b.y - a.y)[0];
      hist.push(ball ? [t, ball.x, ball.y, ball.vy] : [t, 0, 0, 0]);
      while (hist.length && hist[0][0] < t - delay - 0.05) hist.shift();
      flipT -= STEP * TICK;
      if (flipT <= 0) {
        attentive = !attentive;
        flipT = (attentive ? lapseEvery : lapseFor) * (0.4 + r() * 1.2);
      }
      const seen = hist.find((h) => h[0] >= t - delay) || hist[0];
      const fl = sim.table.flippers;
      for (let i = 0; i < 2; i++) {
        if (hold[i] > 0) { hold[i] -= STEP * TICK; if (hold[i] <= 0) cool[i] = 0.18 + r() * 0.2; continue; }
        if (cool[i] > 0) { cool[i] -= STEP * TICK; continue; }
        if (!attentive || !seen) continue;
        const [, x, y, vy] = seen;
        const f = fl[i];
        const near = y > ZONE_Y - 40 && y < f.y + 30 && Math.abs(x - (f.x + (i ? -30 : 30))) < 55;
        if (near && vy > -50 && r() < 0.5) hold[i] = 0.2 + r() * 0.35;
        else if (r() < 0.004) hold[i] = 0.15 + r() * 0.2;   // the odd excited flap
      }
      sim.input.left = hold[0] > 0;
      sim.input.right = hold[1] > 0;
    },
  };
}

// Value of a game state for the planner.
function progressValue(sim) {
  const S = sim.S, objs = sim.cfg.objectives || [];
  let v = 0;
  objs.forEach((o, i) => {
    const st = S.obj[i];
    const w = [3, 2, 1][i] || 1;
    v += w * (st.done ? 1.4 : Math.min(1, st.n / (o.count || 1)) + (o.kind === "all" ? Object.keys(st.seen).length * 0.2 : 0) + (o.kind === "spell" ? (S.spell[o.group] || 0) * 0.2 : 0));
  });
  return v * 6000 + S.score;
}

function plannerBrain(opts = {}) {
  const horizon = opts.horizon ?? 0.8;
  // A seed shifts the timing grid a few milliseconds, so a retry is a
  // different game rather than the same mistake again.
  const jit = opts.seed ? (rng(opts.seed)() - 0.5) * 0.02 : 0;
  const delays = (opts.delays ?? [0, 0.03, 0.06, 0.1, 0.14]).map((d) => Math.max(0, d + jit));
  let plan = null;   // { until, left, right }
  let quietUntil = 0;
  const lost = (s) => s.S.ballsLeft;
  function rollout(base, act) {
    const s = base.clone();
    const L0 = lost(s), start = s.S.t;
    let minY = 999;
    const n = Math.round(horizon / STEP);
    for (let k = 0; k < n && !s.S.over; k++) {
      const el = s.S.t - start;
      const on = el >= act.at && el < act.at + act.hold;
      s.input.left = on && act.left;
      s.input.right = on && act.right;
      s.step();
      for (const b of s.S.balls) if (b.mode === "play") minY = Math.min(minY, b.y);
    }
    let v = progressValue(s) - progressValue(base);
    if (lost(s) < L0) v -= 60000;
    v += Math.max(0, 600 - minY) * 4;           // prefer sending the ball up the table
    const low = s.S.balls.some((b) => b.mode === "play" && b.y > 640 && Math.abs(b.x - 184) < 30);
    if (low) v -= 8000;
    return v;
  }
  return {
    name: "planner",
    decide(sim) {
      launcher(sim, this, () => 0.02);
      const t = sim.S.t;
      if (plan) {
        const el = t - plan.t0;
        const on = el >= plan.at && el < plan.at + plan.hold;
        sim.input.left = on && plan.left;
        sim.input.right = on && plan.right;
        if (el >= plan.at + plan.hold) { plan = null; quietUntil = t + 0.12; }
        return;
      }
      sim.input.left = sim.input.right = false;
      if (t < quietUntil) return;
      const threat = sim.S.balls.some((b) => b.mode === "play" && b.y > ZONE_Y - 50 && b.x < 350 && (b.vy > -80 || b.y > 600));
      if (!threat) return;
      const acts = [{ left: false, right: false, at: 0, hold: 0 }];
      for (const d of delays) {
        acts.push({ left: true, right: false, at: d, hold: 0.28 });
        acts.push({ left: false, right: true, at: d, hold: 0.28 });
      }
      acts.push({ left: true, right: true, at: 0.04, hold: 0.28 });
      let best = null, bv = -Infinity;
      for (const a of acts) { const v = rollout(sim, a); if (v > bv) { bv = v; best = a; } }
      if (!best.left && !best.right) { quietUntil = t + 0.04; return; }
      plan = Object.assign({ t0: t }, best);
      this.decide(sim);
    },
  };
}

// --------------------------------------------------------------- running --
function play(G, cfg, brain, opts = {}) {
  const table = G.TABLES.find((x) => x.id === cfg.table);
  const sim = new G.Sim(table, cfg);
  sim.events = null;
  const cap = (opts.cap ?? 420) / STEP;
  let i = 0;
  for (; i < cap && !sim.S.over; i++) {
    if (i % TICK === 0) brain.decide(sim);
    sim.step();
  }
  const r = sim.result();
  r.timedOut = !sim.S.over;
  r.brain = brain.name;
  return r;
}

module.exports = { rng, idleBrain, masherBrain, childBrain, plannerBrain, play, progressValue };

// The older child: the same reactive player with quicker eyes and fewer
// lapses. Isabelle's claim is about the early campaign; this one's is the
// whole book.
function rosalieBrain(seed) {
  const b = childBrain(seed, { delay: 0.15, lapseEvery: 14, lapseFor: 0.8 });
  b.name = "rosalie";
  return b;
}
module.exports.rosalieBrain = rosalieBrain;
