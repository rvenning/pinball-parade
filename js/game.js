// The game engine: one chapter (or free-play / daily game) on one table.
//
// DOM-free and RNG-free. `new Sim(table, cfg)` holds all mutable state in
// `this.S`, a plain object, so `clone()` is a structured copy — the predictive
// bot plans by cloning the real game and trying things. Time advances only in
// `step()`, exactly PHYS.DT per call; the renderer runs as many steps as real
// time demands, a bot runs as many as it likes.
//
// Input is three booleans the caller sets: input.left, input.right,
// input.launch. Output is `this.S` (read it) and `this.events` (drain it) —
// sounds, particles and floating scores are the renderer's business.

const LOCK_N = 2;
const PARADE = { perBumper: 0.1, perSling: 0.025, decay: 0.03, duration: 10, mult: 2 };
const PTS = {
  bumper: 100, sling: 10, target: 250, drop: 400, bank: 2500, rollover: 200, lanes: 2000,
  spin: 30, ramp: 1500, saucer: 750, lock: 2500, multiball: 5000, orbit: 600, objective: 5000, spell: 3000,
  phase: 5000, bonus: 5000, ballBonus: 5000,
};
const LAUNCH = { vMin: 1020, vMax: 1480, tapPower: 0.85, tapTime: 0.16, chargeTime: 0.9 };
const STUCK = { window: 3.0, radius: 12, nudges: 2 };
const KICK_RELIGHT = { gentle: 1.0, auto: 2.5, slow: 20 };
// Effects that change what the table IS (replayed when a chapter resumes from
// a checkpoint) versus one-off gifts that belong to the moment (not replayed).
const TRANSIENT_FX = ["save", "extra", "kick"];

// A mover's offset from its authored position, and its velocity. Its clock
// `mt` only advances while it is moving, so stopping one freezes it in place
// rather than snapping it home through the ball.
function moverOffset(e, st) {
  const m = e.move;
  if (!m) return [0, 0, 0, 0];
  const w = (2 * Math.PI) / m.period, ph = w * (st.mt || 0) + (m.phase || 0);
  const k = Math.sin(ph), v = st.moving ? Math.cos(ph) * w : 0;
  return [m.dx * k, m.dy * k, m.dx * v, m.dy * v];
}

// ---- compile a table into collision primitives, once --------------------
function compileTable(t) {
  if (t._prims) return t;
  const R = PHYS.BALL_R;
  const prims = [], sensors = [];
  const box = (p) => {
    p.x0 = Math.min(p.ax, p.bx) - p.r - R; p.x1 = Math.max(p.ax, p.bx) + p.r + R;
    p.y0 = Math.min(p.ay, p.by) - p.r - R; p.y1 = Math.max(p.ay, p.by) + p.r + R;
    return p;
  };
  // A mover's box covers its whole sweep; collide() shifts it to where it is now.
  const sweep = (el, p) => {
    if (!el.move) return p;
    const ax = Math.abs(el.move.dx), ay = Math.abs(el.move.dy);
    p.mv = el; p.x0 -= ax; p.x1 += ax; p.y0 -= ay; p.y1 += ay;
    return p;
  };
  const cap = (el, a, b, r, extra) => prims.push(sweep(el, box(Object.assign({ k: "cap", el: el.id, type: el.type, ax: a[0], ay: a[1], bx: b[0], by: b[1], r }, extra))));
  const circ = (el, extra) => prims.push(sweep(el, box(Object.assign({ k: "circ", el: el.id, type: el.type, ax: el.x, ay: el.y, bx: el.x, by: el.y, r: el.r }, extra))));
  for (const el of t.elements) {
    switch (el.type) {
      case "wall": for (let i = 0; i + 1 < el.pts.length; i++) cap(el, el.pts[i], el.pts[i + 1], el.r); break;
      case "post": circ(el); break;
      case "bumper": circ(el, { kick: el.kick }); break;
      case "sling": {
        const P = el.pts;
        for (let i = 0; i < 3; i++) {
          const j = (i + 1) % 3;
          const face = (el.face[0] === i && el.face[1] === j) || (el.face[0] === j && el.face[1] === i);
          cap(el, P[i], P[j], 3, { face, kick: face ? el.kick : 0 });
        }
        break;
      }
      case "target": case "drop": cap(el, el.a, el.b, el.r); break;
      case "gate": cap(el, el.a, el.b, el.r, { oneWay: el.oneWay || null }); break;
      default: sensors.push(el);
    }
  }
  t._prims = prims;
  t._sensors = sensors;
  t._arms = t.elements.filter((e) => e.type === "arm");
  t._fields = t.elements.filter((e) => e.type === "field");
  t._movers = t.elements.filter((e) => e.move || e.type === "arm" || e.timed);
  for (const e of t.elements) if (e.type === "ramp") {
    let L = 0; e._seg = [];
    for (let i = 0; i + 1 < e.path.length; i++) {
      const d = Math.hypot(e.path[i + 1][0] - e.path[i][0], e.path[i + 1][1] - e.path[i][1]);
      e._seg.push(d); L += d;
    }
    e._len = L;
  }
  return t;
}

function rampPoint(ramp, s) {
  let i = 0;
  while (i < ramp._seg.length - 1 && s > ramp._seg[i]) { s -= ramp._seg[i]; i++; }
  const u = Math.min(1, s / (ramp._seg[i] || 1));
  const a = ramp.path[i], b = ramp.path[i + 1];
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
}

// Pendulums and clockwork doors keep time on their element's own clock, which
// only runs while the story has them "moving": a chapter can start the
// pendulum swinging, or stop the clockwork door, and nothing jumps.
function armAngle(arm, st) { return arm.a0 + arm.amp * Math.sin((2 * Math.PI * (st.mt || 0)) / arm.period); }
function armOmega(arm, st) { return st.moving ? arm.amp * ((2 * Math.PI) / arm.period) * Math.cos((2 * Math.PI * (st.mt || 0)) / arm.period) : 0; }
function timedClosed(gate, st) { return gate.timed && st.moving ? ((st.mt || 0) % gate.timed.period) < gate.timed.closed : false; }
// A gate is shut when the story closed it — or, while its clockwork is
// running, whenever its timer says so.
function gateShut(gate, st) { return gate.timed && st.moving ? timedClosed(gate, st) : !!st.closed; }
function fieldOn(f, t) { return !f.pulse || (t % f.pulse.period) < f.pulse.on; }

// ---- the simulation -------------------------------------------------------
function Sim(table, cfg, S) {
  this.table = compileTable(table);
  this.cfg = cfg;
  this.input = { left: false, right: false, launch: false };
  this.events = [];
  this.phases = cfg.phases || [];
  this.phaseEls = this.phases.map((p) => this.membersOf(p));
  this.bonusEls = cfg.bonus ? this.membersOf(cfg.bonus) : [];
  if (S) this.S = S;
  else { this.S = this.fresh(); this.beginStory(); }
}

Sim.prototype.membersOf = function (o) {
  const t = this.table;
  if (o.id) return t.byId[o.id] ? [o.id] : [];
  if (o.group) return t.elements.filter((e) => e.group === o.group).map((e) => e.id);
  if (o.kind === "lock" || o.kind === "multiball") return t.elements.filter((e) => e.type === "saucer").map((e) => e.id);
  if (o.kind === "parade") return t.elements.filter((e) => e.type === "bumper").map((e) => e.id);
  return [];
};

Sim.prototype.fresh = function () {
  const st = this.cfg.state || {};
  const el = {};
  for (const e of this.table.elements) {
    el[e.id] = { hidden: false, down: false, closed: false, lit: false, flash: -9, cool: 0, hits: 0, awake: false, spin: 0, spinV: 0, lock: false, moving: false, mt: 0 };
  }
  for (const id of st.hidden || []) this.ids(id).forEach((k) => { el[k].hidden = true; });
  for (const id of st.closed || []) this.ids(id).forEach((k) => { el[k].closed = true; });
  for (const id of st.lock || []) this.ids(id).forEach((k) => { el[k].lock = true; });
  for (const id of st.moving || []) this.ids(id).forEach((k) => { el[k].moving = true; });
  for (const id of st.awake || []) this.ids(id).forEach((k) => { el[k].awake = true; });
  for (const id of st.down || []) this.ids(id).forEach((k) => { el[k].down = true; });
  el.savePost.hidden = !st.savePost;
  const kb = st.kickback || "auto";
  el.kickL.lit = el.kickR.lit = kb !== "off";
  return {
    t: 0, steps: 0,
    balls: [], nextId: 1,
    flip: this.table.flippers.map((f) => ({ ang: f.rest, omega: 0, held: false })),
    el,
    score: 0,
    ballsLeft: this.cfg.balls || 3,
    ballNo: 1,
    saveUntil: 0, saveGranted: false,
    queue: [{ at: 0.35, what: "serve" }],
    locked: 0,
    parade: { meter: 0, until: 0, count: 0 },
    // the story: which phase is current, and its own progress
    phase: 0, ph: null, told: false, reached: 0,
    bonus: { n: 0, seen: {}, done: false },
    spell: {},
    charge: -1,
    over: false, won: false, endAt: 0,
    stats: { bumpers: 0, targets: 0, ramps: 0, locks: 0, multiballs: 0, parades: 0, drains: 0, saves: 0, spins: 0, rescues: 0, launches: 0 },
    pace: [],        // seconds at which each phase was finished (the pacing instrument)
    phaseTime: [],   // seconds spent in each phase, so a slow phase shows up by name
  };
};

// "id" or "@group" → element ids.
Sim.prototype.ids = function (ref) {
  if (ref[0] === "@") return this.table.elements.filter((e) => e.group === ref.slice(1)).map((e) => e.id);
  return this.table.byId[ref] ? [ref] : [];
};

Sim.prototype.clone = function () {
  const c = new Sim(this.table, this.cfg, structuredClone(this.S));
  c.input = Object.assign({}, this.input);
  c.events = null;
  return c;
};

Sim.prototype.emit = function (type, data) {
  if (!this.events) return;
  if (this.events.length > 400) this.events.shift();
  this.events.push(Object.assign({ type, t: this.S.t }, data));
};

// ---------------------------------------------------------------- scoring --
Sim.prototype.add = function (pts, x, y, why) {
  const S = this.S;
  const mult = (S.t < S.parade.until ? PARADE.mult : 1);
  const v = Math.round(pts * mult);
  S.score += v;
  if (x !== undefined) this.emit("points", { x, y, v, why });
  this.progress("score", null, 0);
  return v;
};

Sim.prototype.feedParade = function (amt) {
  const S = this.S;
  if (S.t < S.parade.until || S.over) return;
  S.parade.meter += amt * ((this.cfg.twist && this.cfg.twist.paradeFill) || 1);
  if (S.parade.meter >= 1) {
    S.parade.meter = 0;
    S.parade.until = S.t + PARADE.duration;
    S.parade.count++;
    S.stats.parades++;
    this.emit("paradeStart", {});
    this.progress("parade", null, 1);
  }
};

// ------------------------------------------------------------------ story --
// A chapter is a short story told in PHASES. Only the current phase counts
// and only its mechanisms are lit; finishing one changes the table (a gate
// opens, a dragon takes off) and starts the next. The last phase is the
// finale. Alongside runs one BONUS side quest, and the score target.
Sim.prototype.phaseSpec = function () { return this.phases[this.S.phase] || null; };

Sim.prototype.beginStory = function () {
  const S = this.S, r = this.cfg.resume;
  if (!this.phases.length) return;
  if (r && r.phase > 0 && r.phase < this.phases.length) {
    // Resume at a checkpoint: the table is put back the way the story left it.
    for (let i = 0; i < r.phase; i++) {
      const p = this.phases[i];
      for (const fx of p.start || []) if (!TRANSIENT_FX.includes(fx.split(":")[0])) this.effect(fx, true);
      // a door of keep-down stones that this phase toppled is still down
      if (p.kind === "bank") for (const e of this.table.elements) if (e.group === p.group && e.type === "drop" && e.keep) S.el[e.id].down = true;
      for (const fx of p.effect || []) if (!TRANSIENT_FX.includes(fx.split(":")[0])) this.effect(fx, true);
    }
    S.phase = r.phase; S.reached = r.phase;
    S.score = r.score || 0;
    if (r.bonus) S.bonus.done = true;
  }
  this.startPhase();
};

Sim.prototype.startPhase = function () {
  const S = this.S, p = this.phaseSpec();
  S.ph = { n: 0, seen: {}, at: S.t, clock: 0, score0: S.score };
  S.spell = {};
  for (const fx of p.start || []) this.effect(fx);
  // Every new phase is a fresh start: a little ball save and the kickbacks
  // lit again, so a long chapter never grinds a child down.
  const st = this.cfg.state || {};
  const save = p.save !== undefined ? p.save : (st.phaseSave || 0);
  if (save > 0 && S.phase > 0) S.saveUntil = Math.max(S.saveUntil, S.t + save);
  if (S.phase > 0 && (st.kickback || "auto") !== "off") for (const id of ["kickL", "kickR"]) { S.el[id].lit = true; S.el[id].relight = 0; }
  this.emit("phaseStart", { idx: S.phase, final: S.phase === this.phases.length - 1 });
  if (p.kind === "score") this.progress("score", null, 0);
};

// The value a hurry-up phase is worth right now: it counts down from `from`
// to `to` over the phase timer, then waits there. It is never lost.
Sim.prototype.jackpotValue = function () {
  const p = this.phaseSpec(), S = this.S;
  if (!p || !p.jackpot) return 0;
  const secs = (p.timer && p.timer.secs) || 20;
  const u = Math.min(1, S.ph.clock / secs);
  return Math.round((p.jackpot.from + (p.jackpot.to - p.jackpot.from) * u) / 10) * 10;
};

Sim.prototype.completePhase = function () {
  const S = this.S, p = this.phaseSpec();
  if (!p || S.told) return;
  const final = S.phase === this.phases.length - 1;
  const v = p.jackpot ? this.jackpotValue() : PTS.phase;
  this.add(v, CX, 330, p.jackpot ? "jackpot" : "phase");
  for (const fx of p.effect || []) this.effect(fx);
  S.pace.push(Math.round(S.t));
  this.emit("phaseDone", { idx: S.phase, final, value: v, jackpot: !!p.jackpot });
  S.phase++;
  S.reached = S.phase;
  if (!final) { this.startPhase(); return; }
  // The story is told: bank a bonus for every ball still in hand, and end
  // on the high note rather than playing on to a drain.
  S.told = true; S.ph = null;
  const bb = PTS.ballBonus * Math.max(0, S.ballsLeft);
  if (bb) { S.score += bb; this.emit("ballBonus", { v: bb, balls: S.ballsLeft }); }
  this.emit("storyTold", {});
  if (this.cfg.mode !== "free") this.finish(true, 3.2);
};

// Goal bookkeeping for the current phase and the bonus. `key` is the element
// that fired; `amount` the count.
Sim.prototype.progress = function (kind, key, amount) {
  const S = this.S;
  const p = this.phaseSpec();
  if (p && S.ph && !S.told && this.goalStep(p, S.ph, this.phaseEls[S.phase], kind, key, amount)) this.completePhase();
  const b = this.cfg.bonus;
  if (b && !S.bonus.done && this.goalStep(b, S.bonus, this.bonusEls, kind, key, amount)) {
    S.bonus.done = true;
    this.add(PTS.bonus, undefined, undefined);
    for (const fx of b.effect || []) this.effect(fx);
    this.emit("bonusDone", {});
  }
};

// One goal, one event: returns true when the goal is now complete.
Sim.prototype.goalStep = function (o, st, members, kind, key, amount) {
  const k = o.kind === "frenzy" ? (o.on || "hit") : o.kind;
  if (k !== kind) return false;
  // a frenzy with no count simply runs its clock: the hits are the score
  if (o.kind === "frenzy" && !o.count) { if (key && (this.table.byId[key].group === o.group || o.id === key)) st.n += amount; return false; }
  if (kind === "score") return this.S.score - (o.fromPhase ? st.score0 || 0 : 0) >= o.points;
  if (key) {
    const el = this.table.byId[key];
    if (o.id && o.id !== key) return false;
    if (o.group && (!el || el.group !== o.group)) return false;
  }
  if (kind === "all") {
    st.seen[key] = 1;
    const live = members.filter((id) => !this.S.el[id].hidden);
    if (live.every((id) => st.seen[id])) { st.n++; st.seen = {}; this.emit("allLit", {}); }
  } else st.n += amount;
  return st.n >= (o.count || 1);
};

// What the current phase multiplies (a frenzy makes its group worth more).
Sim.prototype.boost = function (id) {
  const p = this.phaseSpec();
  if (!p || p.kind !== "frenzy" || !this.S.ph) return 1;
  const el = this.table.byId[id];
  return el && (p.group ? el.group === p.group : p.id === id) ? (p.mult || 5) : 1;
};

Sim.prototype.effect = function (fx, quiet) {
  const [kind, ref] = fx.split(":");
  const S = this.S;
  if (kind === "save") { S.saveUntil = Math.max(S.saveUntil, S.t + (+ref || 10)); if (!quiet) this.emit("effect", { kind }); return; }
  if (kind === "extra") { S.ballsLeft++; if (!quiet) this.emit("extraBall", {}); return; }
  if (kind === "kick") { for (const id of ["kickL", "kickR"]) { S.el[id].lit = true; S.el[id].relight = 0; } return; }
  for (const id of this.ids(ref || "")) {
    const el = S.el[id];
    if (kind === "open") el.closed = false;
    if (kind === "close") el.closed = true;
    if (kind === "show") el.hidden = false;
    if (kind === "hide") el.hidden = true;
    if (kind === "wake") el.awake = true;
    if (kind === "sleep") el.awake = false;
    if (kind === "lightLock") el.lock = true;
    if (kind === "unlock") el.lock = false;
    if (kind === "move") el.moving = true;
    if (kind === "still") el.moving = false;
    if (kind === "raise") this.raiseDrop(id);
    if (!quiet) this.emit("effect", { kind, id });
  }
};

Sim.prototype.finish = function (won, delay) {
  const S = this.S;
  if (S.endAt) return;
  S.won = won;
  S.endAt = S.t + delay;
  this.emit(won ? "chapterWon" : "chapterOver", {});
};

Sim.prototype.result = function () {
  const S = this.S, free = this.cfg.mode === "free";
  const told = free ? true : S.told;
  return {
    mode: this.cfg.mode || "chapter",
    won: !free && told,
    told,
    score: S.score,
    phase: S.reached, phases: this.phases.length,
    bonus: S.bonus.done,
    stars: free ? 0 : starsFor(this.cfg, { told, bonus: S.bonus.done }, S.score),
    seconds: Math.round(S.t),
    pace: S.pace.slice(),
    phaseTime: Array.from({ length: this.phases.length }, (_, i) => Math.round(S.phaseTime[i] || 0)),
    // where to pick the story up if this game ended part-way through it
    checkpoint: !told && S.ph ? { phase: S.phase, score: S.ph.score0, bonus: S.bonus.done } : null,
    stats: Object.assign({}, S.stats),
  };
};

// ------------------------------------------------------------- lifecycle --
Sim.prototype.serve = function (auto) {
  const S = this.S, P = this.table.plunger;
  const b = { id: S.nextId++, x: P.x, y: P.y, vx: 0, vy: 0, mode: "play", inside: {}, anchor: [P.x, P.y, S.t], nudges: 0, cradle: -9, lastThud: 0, auto: auto ? S.t + 0.55 : 0 };
  S.balls.push(b);
  this.emit("serve", { auto: !!auto });
  return b;
};

Sim.prototype.readyBall = function () {
  const P = this.table.plunger;
  for (const b of this.S.balls) {
    if (b.mode === "play" && b.x > P.lane[0] && b.y > P.ready && Math.abs(b.vy) < 90) return b;
  }
  return null;
};

Sim.prototype.launch = function (b, power) {
  const v = LAUNCH.vMin + (LAUNCH.vMax - LAUNCH.vMin) * Physics.clamp(power, 0, 1);
  b.vy = -v; b.vx = 0;
  b.auto = 0;
  const S = this.S, save = (this.cfg.state && this.cfg.state.ballSave) || 0;
  // One ball save per ball, starting when it is plunged. A saved ball is
  // re-served and auto-launched, but does not earn a second window.
  if (!S.saveGranted && save > 0) { S.saveGranted = true; S.saveUntil = S.t + save; }
  S.stats.launches++;
  this.emit("launch", { power });
};

Sim.prototype.inPlayCount = function () {
  return this.S.balls.filter((b) => b.mode !== "locked").length;
};

Sim.prototype.drain = function (b) {
  const S = this.S;
  S.balls.splice(S.balls.indexOf(b), 1);
  S.stats.drains++;
  if (S.over || S.endAt) return;
  if (S.t < S.saveUntil) {
    S.stats.saves++;
    this.emit("saved", { x: b.x });
    S.queue.push({ at: S.t + 0.5, what: "serveAuto" });
    return;
  }
  if (this.inPlayCount() > 0 || S.queue.some((q) => q.what.startsWith("serve"))) {
    this.emit("drainQuiet", { x: b.x });
    return;
  }
  S.ballsLeft--;
  this.emit("ballLost", { left: S.ballsLeft, x: b.x });
  if (S.ballsLeft > 0) {
    S.ballNo++;
    S.saveGranted = false;
    S.queue.push({ at: S.t + 0.9, what: "serve" });
  } else {
    this.finish(false, 1.2);
  }
};

// Is a ball actually out on the table? A phase timer only runs while one is,
// so a drain, a serve or a slow plunge never eats into a hurry-up.
Sim.prototype.ballInPlay = function () {
  const P = this.table.plunger;
  return this.S.balls.some((b) => b.mode === "ride" || b.mode === "held" || (b.mode === "play" && !(b.x > P.lane[0] && b.y > 240)));
};

// --------------------------------------------------------------- the step --
Sim.prototype.step = function () {
  const S = this.S;
  if (S.over) return;
  const dt = PHYS.DT;
  S.t += dt; S.steps++;
  const t = S.t;

  if (S.endAt && t >= S.endAt) { S.over = true; this.emit("gameOver", {}); return; }

  // the phase clock: timed modes and hurry-ups
  const ph = this.phaseSpec();
  if (ph && !S.told) S.phaseTime[S.phase] = (S.phaseTime[S.phase] || 0) + dt;
  if (ph && S.ph && !S.told && !S.endAt && this.ballInPlay()) {
    S.ph.clock += dt;
    if (ph.timer && S.ph.clock >= ph.timer.secs && ph.timer.end === "complete") this.completePhase();
  }
  // movers advance their own clocks
  for (const m of this.table._movers) { const e = S.el[m.id]; if (e.moving) e.mt += dt; }

  // queued serves
  for (let i = S.queue.length - 1; i >= 0; i--) {
    const q = S.queue[i];
    if (t < q.at) continue;
    S.queue.splice(i, 1);
    if (q.what === "serve") this.serve(false);
    else if (q.what === "serveAuto") this.serve(true);
  }

  // timers on elements
  const st = this.cfg.state || {};
  for (const id of ["kickL", "kickR"]) {
    const k = S.el[id];
    if (!k.lit && k.relight && t >= k.relight) { k.lit = true; k.relight = 0; this.emit("kickLit", { id }); }
  }
  if (S.parade.meter > 0 && t >= S.parade.until) S.parade.meter = Math.max(0, S.parade.meter - PARADE.decay * dt);
  if (S.parade.until && t >= S.parade.until && t - dt < S.parade.until) this.emit("paradeEnd", {});
  for (const id in S.el) {
    const e = S.el[id];
    if (e.resetAt && t >= e.resetAt) { e.resetAt = 0; this.resetGroup(id); }
    if (e.retryRaise && t >= e.retryRaise) { e.retryRaise = 0; this.raiseDrop(id); }
    if (e.relockAt && t >= e.relockAt) { e.relockAt = 0; e.lock = true; this.emit("effect", { kind: "lightLock", id }); }
    if (e.spinV) { e.spin += e.spinV * dt; e.spinV *= Math.exp(-2.2 * dt); if (Math.abs(e.spinV) < 0.3) e.spinV = 0; }
  }

  // flippers (and lane change on each fresh press)
  const fl = this.table.flippers;
  const want = [this.input.left, this.input.right];
  for (let i = 0; i < fl.length; i++) {
    const f = S.flip[i];
    if (want[i] && !f.held) { this.emit("flip", { side: i }); this.laneChange(i ? 1 : -1); }
    if (!want[i] && f.held) this.emit("unflip", { side: i });
    f.held = want[i];
    Physics.stepFlipper(fl[i], f, dt);
  }

  // plunger
  const ready = this.readyBall();
  if (ready && ready.auto && t >= ready.auto) this.launch(ready, 0.8);
  if (this.input.launch) {
    if (S.charge < 0 && ready) S.charge = t;
  } else if (S.charge >= 0) {
    const held = t - S.charge;
    S.charge = -1;
    const r = this.readyBall();
    if (r) this.launch(r, held < LAUNCH.tapTime ? LAUNCH.tapPower : 0.5 + 0.5 * Math.min(1, held / LAUNCH.chargeTime));
  }

  // balls
  for (let i = S.balls.length - 1; i >= 0; i--) {
    const b = S.balls[i];
    if (b.mode === "play") this.moveBall(b, dt);
    else if (b.mode === "ride") this.ride(b, dt);
    else if (b.mode === "held" && t >= b.until) this.eject(b);
    if (b.mode === "play" && b.y > PHYS.H + 16) { this.drain(b); continue; }
    if (b.mode === "play") this.stuckCheck(b);
  }
  const live = S.balls.filter((b) => b.mode === "play");
  for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
    if (Physics.ballBall(live[i], live[j], PHYS.BALL_R)) this.emit("clack", { x: (live[i].x + live[j].x) / 2, y: (live[i].y + live[j].y) / 2 });
  }
};

// Is a ramp's way in shut? Its door is a gate (shut unless open or ticking
// open and shut on its clock) or "@bank", a row of drop targets standing in
// the mouth — shut while any of them is still up.
Sim.prototype.doorShut = function (e) {
  const d = e.door;
  if (!d) return false;
  const S = this.S;
  if (d[0] === "@") return this.ids(d).some((id) => !S.el[id].down && !S.el[id].hidden);
  return S.el[d].closed && !(this.table.byId[d].timed && S.el[d].moving);
};

Sim.prototype.solid = function (p) {
  const e = this.S.el[p.el];
  if (e.hidden) return false;
  if (p.type === "drop") return !e.down;
  if (p.type === "gate") {
    if (p.oneWay) return true;
    const g = this.table.byId[p.el];
    return gateShut(g, e);
  }
  return true;
};

Sim.prototype.moveBall = function (b, dt) {
  const R = PHYS.BALL_R, S = this.S, t = S.t;
  const sp = Math.hypot(b.vx, b.vy);
  const n = Math.max(1, Math.ceil((sp * dt) / (R * PHYS.SUB_FRAC)));
  const h = dt / n;
  let ax = 0, ay = PHYS.G;
  for (const f of this.table._fields) {
    if (S.el[f.id].hidden || !fieldOn(f, t)) continue;
    if (f.pull) {
      // a whirlpool: a pull toward its eye, strongest near the middle
      const { x, y, r, k } = f.pull, dx = x - b.x, dy = y - b.y, d = Math.hypot(dx, dy);
      if (d < r && d > 1) { const a = k * (1 - d / r) / d; ax += dx * a; ay += dy * a; }
      continue;
    }
    const [x0, y0, x1, y1] = f.rect;
    if (b.x >= x0 && b.x <= x1 && b.y >= y0 && b.y <= y1) { ax += f.ax; ay += f.ay; }
  }
  for (let s = 0; s < n; s++) {
    b.vx += ax * h; b.vy += ay * h;
    const k = 1 - PHYS.DRAG * h;
    b.vx *= k; b.vy *= k;
    const px = b.x, py = b.y;
    b.x += b.vx * h; b.y += b.vy * h;
    for (let pass = 0; pass < 2; pass++) this.collide(b);
    this.flipperCollide(b);
    Physics.capSpeed(b);
    this.sensors(b, px, py);
    if (b.mode !== "play") return;
  }
};

Sim.prototype.collide = function (b) {
  const R = PHYS.BALL_R, S = this.S, t = S.t;
  for (const p of this.table._prims) {
    if (b.x < p.x0 || b.x > p.x1 || b.y < p.y0 || b.y > p.y1) continue;
    if (!this.solid(p)) continue;
    let ox = 0, oy = 0, svx = 0, svy = 0;
    if (p.mv) [ox, oy, svx, svy] = moverOffset(p.mv, S.el[p.el]);
    const c = p.k === "circ" ? Physics.circle(b, R, p.ax + ox, p.ay + oy, p.r) : Physics.capsule(b, R, p.ax + ox, p.ay + oy, p.bx + ox, p.by + oy, p.r);
    if (!c) continue;
    if (p.oneWay) {
      const side = (b.x - p.ax) * p.oneWay[0] + (b.y - p.ay) * p.oneWay[1];
      if (side <= 0) continue;
    }
    const el = S.el[p.el];
    switch (p.type) {
      case "bumper": {
        Physics.resolve(b, c.nx, c.ny, c.pen, svx, svy, 0.5, 0, p.kick);
        if (t >= el.cool) { el.cool = t + 0.09; this.hit(p.el, b, "bumper"); }
        break;
      }
      case "sling": {
        const imp = Physics.resolve(b, c.nx, c.ny, c.pen, 0, 0, p.face ? 0.5 : PHYS.WALL_E, PHYS.WALL_F, (p.face && t >= el.cool) ? p.kick : 0);
        if (p.face && imp > 40 && t >= el.cool) { el.cool = t + 0.12; el.flash = t; this.add(PTS.sling, b.x, b.y); this.feedParade(PARADE.perSling); this.emit("sling", { id: p.el, x: b.x, y: b.y }); }
        break;
      }
      case "target": case "drop": {
        const imp = Physics.resolve(b, c.nx, c.ny, c.pen, svx, svy, 0.5, PHYS.WALL_F, 0);
        if (imp > 45 && t >= el.cool) { el.cool = t + 0.15; this.hit(p.el, b, p.type); }
        break;
      }
      default: {
        const imp = Physics.resolve(b, c.nx, c.ny, c.pen, svx, svy, PHYS.WALL_E, PHYS.WALL_F, 0);
        if (imp > 320 && t - b.lastThud > 0.12) { b.lastThud = t; this.emit("thud", { x: b.x, y: b.y, v: imp }); }
      }
    }
  }
  // moving diverters
  for (const arm of this.table._arms) {
    const ast = S.el[arm.id], ang = armAngle(arm, ast), om = armOmega(arm, ast);
    const c = Physics.flipperContact(b, R, { x: arm.x, y: arm.y, len: arm.len, r0: arm.r, r1: arm.r }, ang, om);
    if (c) {
      const imp = Physics.resolve(b, c.nx, c.ny, c.pen, c.svx, c.svy, 0.45, 0.02, 0);
      if (imp > 200 && t - b.lastThud > 0.12) { b.lastThud = t; this.emit("thud", { x: b.x, y: b.y, v: imp }); }
    }
  }
};

Sim.prototype.flipperCollide = function (b) {
  const R = PHYS.BALL_R, S = this.S, fl = this.table.flippers;
  for (let i = 0; i < fl.length; i++) {
    const f = S.flip[i];
    const c = Physics.flipperContact(b, R, fl[i], f.ang, f.omega);
    if (!c) continue;
    const imp = Physics.resolve(b, c.nx, c.ny, c.pen, c.svx, c.svy, PHYS.FLIP_E, 0.02, 0);
    if (f.held) b.cradle = S.t;
    if (imp > 380 && Math.abs(f.omega) > 1) this.emit("whack", { x: b.x, y: b.y, v: imp, side: i });
  }
};

// Everything a ball can PASS over or through.
Sim.prototype.sensors = function (b, px, py) {
  const S = this.S, t = S.t, R = PHYS.BALL_R;
  for (const e of this.table._sensors) {
    const st = S.el[e.id];
    if (st.hidden) continue;
    switch (e.type) {
      case "rollover": case "kickback": case "saucer": {
        const inside = (b.x - e.x) ** 2 + (b.y - e.y) ** 2 < e.r * e.r;
        const was = b.inside[e.id];
        b.inside[e.id] = inside;
        if (!inside || was) break;
        if (e.type === "rollover") this.rollover(e, b);
        else if (e.type === "kickback") {
          if (st.lit) {
            st.lit = false;
            const mode = (this.cfg.state && this.cfg.state.kickback) || "auto";
            st.relight = KICK_RELIGHT[mode] ? t + KICK_RELIGHT[mode] : 0;
            b.x = e.x; b.vx = 0; b.vy = -1180;
            this.emit("kickback", { id: e.id, x: e.x, y: e.y });
          }
        } else if (t >= st.cool) this.capture(e, b);
        break;
      }
      case "spinner": {
        if (Physics.crossed(px, py, b.x, b.y, e.a[0], e.a[1], e.b[0], e.b[1])) {
          const turns = 1 + Math.floor(Math.hypot(b.vx, b.vy) / 240);
          st.spinV = (st.spinV || 0) + turns * 9;
          S.stats.spins += turns;
          this.add(PTS.spin * turns * this.boost(e.id), (e.a[0] + e.b[0]) / 2, (e.a[1] + e.b[1]) / 2);
          this.emit("spin", { id: e.id, turns });
          this.progress("spin", e.id, turns);
        }
        break;
      }
      case "orbit": {
        if (Physics.crossed(px, py, b.x, b.y, e.a[0], e.a[1], e.b[0], e.b[1]) && b.vx * e.dir[0] + b.vy * e.dir[1] > 0) {
          st.flash = t;
          this.add(PTS.orbit * this.boost(e.id), b.x, b.y);
          this.emit("orbit", { id: e.id, x: b.x, y: b.y });
          this.progress("orbit", e.id, 1);
        }
        break;
      }
      case "ramp": {
        const m = e.mouth;
        if (!Physics.crossed(px, py, b.x, b.y, m[0][0], m[0][1], m[1][0], m[1][1])) break;
        const sp = Math.hypot(b.vx, b.vy);
        if (b.vx * e.enter[0] + b.vy * e.enter[1] <= 0) break;
        if (sp < e.minSpeed) { this.emit("rampShort", { id: e.id }); break; }
        b.mode = "ride";
        b.ride = { id: e.id, s: 0, v: Physics.clamp(sp * 0.75, 380, e.speed) };
        this.emit("rampEnter", { id: e.id, x: b.x, y: b.y });
        return;
      }
    }
    if (b.mode !== "play") return;
  }
};

Sim.prototype.rollover = function (e, b) {
  const S = this.S, st = S.el[e.id];
  st.flash = S.t;
  const first = !st.lit;
  st.lit = true;
  this.add(PTS.rollover, e.x, e.y);
  this.emit("rollover", { id: e.id, x: e.x, y: e.y, first });
  const members = this.table.elements.filter((x) => x.group === e.group && x.type === "rollover");
  if (members.every((m) => S.el[m.id].lit)) {
    for (const m of members) S.el[m.id].lit = false;
    this.add(PTS.lanes, e.x, e.y + 20, "lanes");
    this.emit("lanes", { group: e.group, x: e.x, y: e.y });
    this.progress("lanes", e.id, 1);
  }
};

// Flipper presses rotate which lanes are lit — the classic lane change, so
// a player who notices can steer the last unlit lane under the ball.
Sim.prototype.laneChange = function (dir) {
  const g = this.table.laneChange;
  if (!g) return;
  const ids = this.table.elements.filter((e) => e.group === g && e.type === "rollover").map((e) => e.id);
  const lit = ids.map((id) => this.S.el[id].lit);
  if (lit.every((v) => v) || lit.every((v) => !v)) return;
  for (let i = 0; i < ids.length; i++) this.S.el[ids[i]].lit = lit[(i - dir + ids.length) % ids.length];
};

// The spelling goal a lettered group is serving right now: the current
// phase first, then the bonus.
Sim.prototype.spellGroup = function (group) {
  const p = this.phaseSpec();
  if (p && this.S.ph && p.kind === "spell" && p.group === group) return p;
  const b = this.cfg.bonus;
  if (b && !this.S.bonus.done && b.kind === "spell" && b.group === group) return b;
  return null;
};

// Where an element is drawn and hit NOW (movers travel).
Sim.prototype.pos = function (id) {
  const e = this.table.byId[id];
  const [ox, oy] = moverOffset(e, this.S.el[id]);
  if (e.a) return [(e.a[0] + e.b[0]) / 2 + ox, (e.a[1] + e.b[1]) / 2 + oy];
  return [e.x + ox, e.y + oy];
};

Sim.prototype.nextLetter = function (group) {
  const o = this.spellGroup(group);
  if (!o) return null;
  return o.word[this.S.spell[group] || 0];
};

Sim.prototype.hit = function (id, b, kind) {
  const S = this.S, el = this.table.byId[id], st = S.el[id];
  st.flash = S.t; st.hits++;
  if (kind === "bumper") {
    S.stats.bumpers++;
    const mult = ((this.cfg.twist && this.cfg.twist.bumperMult) || 1) * this.boost(id);
    const [bx, by] = this.pos(id);
    this.add(PTS.bumper * mult, bx, by - el.r - 6);
    this.feedParade(PARADE.perBumper);
    this.emit("bumper", { id, x: bx, y: by, look: el.look, n: st.hits, boost: mult > 1 });
    this.progress("hit", id, 1);
    this.progress("all", id, 1);
    return;
  }
  S.stats.targets++;
  const [mx, my] = this.pos(id), boost = this.boost(id);
  // Spelling: only the lit letter counts (and only it drops).
  const sp = el.letter ? this.spellGroup(el.group) : null;
  if (sp) {
    const want = sp.word[S.spell[el.group] || 0];
    if (el.letter !== want) {
      this.add(PTS.target / 5, mx, my);
      this.emit("wrongLetter", { id, x: mx, y: my });
      return;
    }
    S.spell[el.group] = (S.spell[el.group] || 0) + 1;
    this.emit("letter", { id, x: mx, y: my, letter: el.letter });
    if (kind === "drop") st.down = true;
    this.add(PTS.target, mx, my);
    if (S.spell[el.group] >= sp.word.length) {
      S.spell[el.group] = 0;
      this.add(PTS.spell, mx, my - 16, "spell");
      this.emit("spelled", { group: el.group, word: sp.word });
      this.progress("spell", id, 1);
      if (kind === "drop") this.scheduleReset(el.group, 1.2);
    }
    this.progress("hit", id, 1);
    this.progress("all", id, 1);
    return;
  }
  if (kind === "drop") {
    st.down = true;
    this.add(PTS.drop, mx, my);
    this.emit("drop", { id, x: mx, y: my });
    const bank = this.table.elements.filter((e) => e.type === "drop" && e.group === el.group);
    if (bank.every((d) => S.el[d.id].down)) {
      this.add(PTS.bank, mx, my - 16, "bank");
      this.emit("bank", { group: el.group, x: mx, y: my });
      this.progress("bank", id, 1);
      // a bank that is a DOOR (keep) stays down until the story raises it
      if (!el.keep) this.scheduleReset(el.group, 1.5);
    }
  } else {
    this.add(PTS.target * boost, mx, my);
    this.emit("target", { id, x: mx, y: my });
  }
  this.progress("hit", id, 1);
  this.progress("all", id, 1);
};

Sim.prototype.scheduleReset = function (group, delay) {
  const first = this.table.elements.find((e) => e.group === group);
  this.S.el[first.id].resetAt = this.S.t + delay;
};
Sim.prototype.resetGroup = function (id) {
  const g = this.table.byId[id].group;
  for (const e of this.table.elements) if (e.group === g && e.type === "drop") this.raiseDrop(e.id);
  this.emit("reset", { group: g });
};

// Stand a drop target back up — but never through a ball: if one is in the
// way, try again a moment later, when it has rolled clear.
Sim.prototype.raiseDrop = function (id) {
  const S = this.S, e = this.table.byId[id], R = PHYS.BALL_R;
  if (!e || e.type !== "drop" || !S.el[id].down) return;
  const under = S.balls.some((b) => { if (b.mode !== "play") return false; const q = Physics.closest(b.x, b.y, e.a[0], e.a[1], e.b[0], e.b[1]); return Math.hypot(b.x - q.x, b.y - q.y) < R + e.r + 2; });
  if (under) S.el[id].retryRaise = S.t + 0.3; else S.el[id].down = false;
};

Sim.prototype.capture = function (e, b) {
  const S = this.S, st = S.el[e.id];
  b.x = e.x; b.y = e.y; b.vx = 0; b.vy = 0;
  st.flash = S.t;
  this.progress("saucer", e.id, 1);
  if (st.lock) {
    S.stats.locks++;
    this.progress("lock", e.id, 1);
    if (S.locked + 1 < LOCK_N) {
      S.locked++;
      b.mode = "locked"; b.lockAt = e.id;
      this.add(PTS.lock, e.x, e.y - 18, "lock");
      this.emit("lock", { id: e.id, x: e.x, y: e.y, n: S.locked });
      S.queue.push({ at: S.t + 0.8, what: "serveAuto" });
      return;
    }
    // the second lock releases everyone: multiball
    let k = 0;
    for (const o of S.balls) if (o.mode === "locked" && o.lockAt === e.id) { o.mode = "held"; o.until = S.t + 0.5 + 0.45 * k++; o.x = e.x; o.y = e.y; }
    S.locked = 0;
    S.stats.multiballs++;
    // Outside a story nothing unlights a lock, and every multiball brings a
    // ball save — so the lock rests a while, or multiball would never end.
    if (!this.phases.length) { st.lock = false; st.relockAt = S.t + 45; }
    b.mode = "held"; b.until = S.t + 0.5 + 0.45 * k; b.heldAt = e.id;
    S.saveUntil = Math.max(S.saveUntil, S.t + 10);
    this.add(PTS.multiball, e.x, e.y - 18, "multiball");
    this.emit("multiball", { id: e.id, x: e.x, y: e.y });
    this.progress("multiball", e.id, 1);
    return;
  }
  b.mode = "held"; b.until = S.t + (e.hold || 0.8); b.heldAt = e.id;
  this.add(PTS.saucer * this.boost(e.id), e.x, e.y - 18);
  this.emit("saucer", { id: e.id, x: e.x, y: e.y });
};

Sim.prototype.eject = function (b) {
  const S = this.S;
  const id = b.heldAt || b.lockAt;
  const e = this.table.byId[id];
  b.mode = "play";
  b.vx = e.eject[0]; b.vy = e.eject[1];
  b.heldAt = b.lockAt = null;
  b.inside[id] = true;
  // A saucer never re-catches the ball it has just thrown: an eject that
  // bounces straight back off a bumper would otherwise juggle forever.
  S.el[id].cool = S.t + 2.5;
  b.anchor = [b.x, b.y, S.t]; b.nudges = 0;
  this.emit("eject", { id, x: b.x, y: b.y });
};

Sim.prototype.ride = function (b, dt) {
  const ramp = this.table.byId[b.ride.id];
  b.ride.s += b.ride.v * dt;
  if (b.ride.s >= ramp._len) {
    b.mode = "play";
    b.x = ramp.exit.x; b.y = ramp.exit.y; b.vx = ramp.exit.vx; b.vy = ramp.exit.vy;
    b.ride = null; b.inside = {};
    b.anchor = [b.x, b.y, this.S.t]; b.nudges = 0;
    this.S.stats.ramps++;
    const mult = (this.cfg.twist && this.cfg.twist.rampMult) || 1;
    this.add(PTS.ramp * mult * this.boost(ramp.id), b.x + 20, b.y, "ramp");
    this.emit("ramp", { id: ramp.id, x: b.x, y: b.y });
    this.progress("ramp", ramp.id, 1);
    return;
  }
  const [x, y] = rampPoint(ramp, b.ride.s);
  b.x = x; b.y = y;
};

// A genuinely stuck ball — one that has stayed within a 12px circle for three
// seconds while nobody is cradling it — gets two nudges, then a free trip back
// to the plunger. A ball rolling slowly anywhere leaves the circle and is
// never touched. The plunger lane is exempt: a ball sitting there is waiting.
Sim.prototype.stuckCheck = function (b) {
  if (this.cfg.noRescue) return;
  const S = this.S, t = S.t, P = this.table.plunger;
  const [ax, ay, at] = b.anchor;
  // Leaving the circle restarts the clock, but the nudge count only forgets
  // after a long stretch of free play — otherwise the bounce a nudge causes
  // would reset it, and a trapped ball would be nudged forever.
  if ((b.x - ax) ** 2 + (b.y - ay) ** 2 > STUCK.radius * STUCK.radius) {
    b.anchor = [b.x, b.y, t];
    if (t - (b.lastNudge || -99) > 8) b.nudges = 0;
    return;
  }
  if (t - at < STUCK.window) return;
  if (t - b.cradle < 0.4 || (b.x > P.lane[0] && b.y > 240)) { b.anchor = [b.x, b.y, t]; return; }
  if (b.nudges < STUCK.nudges) {
    b.nudges++;
    b.lastNudge = t;
    b.vy -= 420; b.vx += b.x < CX ? 180 : -180;
    b.anchor = [b.x, b.y, t];
    this.emit("nudge", { x: b.x, y: b.y });
    return;
  }
  S.stats.rescues++;
  b.x = P.x; b.y = P.y; b.vx = 0; b.vy = 0; b.auto = t + 0.6; b.nudges = 0; b.anchor = [b.x, b.y, t];
  this.emit("rescue", {});
};

// --------------------------------------------------------- read helpers --
// Which elements the renderer should light, and why: "phase" for what the
// story wants now (the bright ring), "bonus" for the side quest (a quiet one).
Sim.prototype.objectiveLights = function () {
  const S = this.S, out = {};
  const light = (o, st, members, tag) => {
    if (o.kind === "spell") {
      const want = o.word[S.spell[o.group] || 0];
      const el = this.table.elements.find((e) => e.group === o.group && e.letter === want);
      if (el && !(el.id in out)) out[el.id] = tag;
      return;
    }
    for (const id of members) {
      if (S.el[id].hidden) continue;
      if (this.doorShut(this.table.byId[id])) continue;        // never light a ramp you cannot get into yet
      if (o.kind === "all" && st.seen[id]) continue;
      if (o.kind === "bank" && S.el[id].down) continue;
      if ((o.kind === "lock" || o.kind === "multiball") && !S.el[id].lock) continue;
      if (!(id in out)) out[id] = tag;
    }
  };
  const p = this.phaseSpec();
  if (p && S.ph && !S.told) light(p, S.ph, this.phaseEls[S.phase], "phase");
  if (this.cfg.bonus && !S.bonus.done) light(this.cfg.bonus, S.bonus, this.bonusEls, "bonus");
  return out;
};

if (typeof module !== "undefined") module.exports = { Sim, compileTable, rampPoint, armAngle, gateShut, LAUNCH, PTS, PARADE, LOCK_N, STUCK, moverOffset };
