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
};
const LAUNCH = { vMin: 1020, vMax: 1480, tapPower: 0.85, tapTime: 0.16, chargeTime: 0.9 };
const STUCK = { window: 3.0, radius: 12, nudges: 2 };
const KICK_RELIGHT = { gentle: 1.0, auto: 2.5, slow: 20 };
// A forgiving table can keep a ball alive for a long time, so a chapter whose
// story is already told wraps itself up rather than running forever.
const AFTER_PRIMARY = 180;

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
  const cap = (el, a, b, r, extra) => prims.push(box(Object.assign({ k: "cap", el: el.id, type: el.type, ax: a[0], ay: a[1], bx: b[0], by: b[1], r }, extra)));
  const circ = (el, extra) => prims.push(box(Object.assign({ k: "circ", el: el.id, type: el.type, ax: el.x, ay: el.y, bx: el.x, by: el.y, r: el.r }, extra)));
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

function armAngle(arm, t) { return arm.a0 + arm.amp * Math.sin((2 * Math.PI * t) / arm.period); }
function armOmega(arm, t) { return arm.amp * ((2 * Math.PI) / arm.period) * Math.cos((2 * Math.PI * t) / arm.period); }
function timedClosed(gate, t) { return gate.timed ? (t % gate.timed.period) < gate.timed.closed : false; }
function fieldOn(f, t) { return !f.pulse || (t % f.pulse.period) < f.pulse.on; }

// ---- the simulation -------------------------------------------------------
function Sim(table, cfg, S) {
  this.table = compileTable(table);
  this.cfg = cfg;
  this.input = { left: false, right: false, launch: false };
  this.events = [];
  this.objEls = (cfg.objectives || []).map((o) => this.membersOf(o));
  this.S = S || this.fresh();
}

Sim.prototype.membersOf = function (o) {
  const t = this.table;
  if (o.id) return t.byId[o.id] ? [o.id] : [];
  if (o.group) return t.elements.filter((e) => e.group === o.group).map((e) => e.id);
  if (o.kind === "lock" || o.kind === "multiball") return (this.cfg.state.lock || []).concat(t.elements.filter((e) => e.type === "saucer").map((e) => e.id)).filter((v, i, a) => a.indexOf(v) === i);
  if (o.kind === "parade") return t.elements.filter((e) => e.type === "bumper").map((e) => e.id);
  return [];
};

Sim.prototype.fresh = function () {
  const st = this.cfg.state || {};
  const el = {};
  for (const e of this.table.elements) {
    el[e.id] = { hidden: false, down: false, closed: false, lit: false, flash: -9, cool: 0, hits: 0, awake: false, spin: 0, spinV: 0, lock: false };
  }
  for (const id of st.hidden || []) if (el[id]) el[id].hidden = true;
  for (const id of st.closed || []) if (el[id]) el[id].closed = true;
  for (const id of st.lock || []) if (el[id]) el[id].lock = true;
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
    obj: (this.cfg.objectives || []).map(() => ({ n: 0, done: false, seen: {}, at: 0 })),
    spell: {},
    charge: -1,
    over: false, won: false, endAt: 0,
    stats: { bumpers: 0, targets: 0, ramps: 0, locks: 0, multiballs: 0, parades: 0, drains: 0, saves: 0, spins: 0, rescues: 0, launches: 0 },
  };
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

// Objective bookkeeping. `key` is the element that fired; amount the count.
Sim.prototype.progress = function (kind, key, amount) {
  const S = this.S, objs = this.cfg.objectives || [];
  for (let i = 0; i < objs.length; i++) {
    const o = objs[i], st = S.obj[i];
    if (st.done || o.kind !== kind) continue;
    if (kind === "score") {
      if (S.score >= o.points) this.complete(i);
      continue;
    }
    if (key) {
      const el = this.table.byId[key];
      if (o.id && o.id !== key) continue;
      if (o.group && (!el || el.group !== o.group)) continue;
    }
    if (kind === "all") {
      st.seen[key] = 1;
      const members = this.objEls[i].filter((id) => !S.el[id].hidden);
      if (members.every((id) => st.seen[id])) { st.n++; st.seen = {}; this.emit("allLit", { idx: i }); }
    } else {
      st.n += amount;
    }
    if (st.n >= (o.count || 1)) this.complete(i);
  }
};

Sim.prototype.complete = function (i) {
  const S = this.S, o = this.cfg.objectives[i], st = S.obj[i];
  if (st.done) return;
  st.done = true; st.n = Math.max(st.n, o.count || 1); st.at = S.t;
  this.add(PTS.objective, undefined, undefined);
  for (const fx of o.effect || []) this.effect(fx);
  this.emit("objective", { idx: i, effect: o.effect || [] });
  const done = S.obj.map((x) => x.done);
  if (starsFor(this.cfg, done, S.score) === 3 && this.cfg.mode !== "daily") this.finish(true, 1.6);
};

Sim.prototype.effect = function (fx) {
  const [kind, id] = fx.split(":");
  const el = this.S.el[id];
  if (!el) return;
  if (kind === "open") el.closed = false;
  if (kind === "close") el.closed = true;
  if (kind === "show") el.hidden = false;
  if (kind === "wake") el.awake = true;
  if (kind === "lightLock") el.lock = true;
  this.emit("effect", { kind, id });
};

Sim.prototype.finish = function (won, delay) {
  const S = this.S;
  if (S.endAt) return;
  S.won = won;
  S.endAt = S.t + delay;
  this.emit(won ? "chapterWon" : "chapterOver", {});
};

Sim.prototype.result = function () {
  const S = this.S, done = S.obj.map((x) => x.done);
  const primary = this.cfg.mode === "free" ? true : !!done[0];
  return {
    mode: this.cfg.mode || "chapter",
    won: primary && (this.cfg.mode !== "free"),
    score: S.score,
    done,
    stars: this.cfg.mode === "free" ? 0 : starsFor(this.cfg, done, S.score),
    seconds: Math.round(S.t),
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
    const primary = this.cfg.mode === "free" || (S.obj[0] && S.obj[0].done);
    this.finish(!!primary && this.cfg.mode !== "free", 1.2);
  }
};

// --------------------------------------------------------------- the step --
Sim.prototype.step = function () {
  const S = this.S;
  if (S.over) return;
  const dt = PHYS.DT;
  S.t += dt; S.steps++;
  const t = S.t;

  if (S.endAt && t >= S.endAt) { S.over = true; this.emit("gameOver", {}); return; }
  if (!S.endAt && S.obj[0] && S.obj[0].done && this.cfg.mode !== "daily" && t - S.obj[0].at > AFTER_PRIMARY) this.finish(true, 0.4);

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

Sim.prototype.solid = function (p) {
  const e = this.S.el[p.el];
  if (e.hidden) return false;
  if (p.type === "drop") return !e.down;
  if (p.type === "gate") {
    if (p.oneWay) return true;
    const g = this.table.byId[p.el];
    return e.closed || timedClosed(g, this.S.t);
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
    const c = p.k === "circ" ? Physics.circle(b, R, p.ax, p.ay, p.r) : Physics.capsule(b, R, p.ax, p.ay, p.bx, p.by, p.r);
    if (!c) continue;
    if (p.oneWay) {
      const side = (b.x - p.ax) * p.oneWay[0] + (b.y - p.ay) * p.oneWay[1];
      if (side <= 0) continue;
    }
    const el = S.el[p.el];
    switch (p.type) {
      case "bumper": {
        Physics.resolve(b, c.nx, c.ny, c.pen, 0, 0, 0.5, 0, p.kick);
        if (t >= el.cool) { el.cool = t + 0.09; this.hit(p.el, b, "bumper"); }
        break;
      }
      case "sling": {
        const imp = Physics.resolve(b, c.nx, c.ny, c.pen, 0, 0, p.face ? 0.5 : PHYS.WALL_E, PHYS.WALL_F, (p.face && t >= el.cool) ? p.kick : 0);
        if (p.face && imp > 40 && t >= el.cool) { el.cool = t + 0.12; el.flash = t; this.add(PTS.sling, b.x, b.y); this.feedParade(PARADE.perSling); this.emit("sling", { id: p.el, x: b.x, y: b.y }); }
        break;
      }
      case "target": case "drop": {
        const imp = Physics.resolve(b, c.nx, c.ny, c.pen, 0, 0, 0.5, PHYS.WALL_F, 0);
        if (imp > 45 && t >= el.cool) { el.cool = t + 0.15; this.hit(p.el, b, p.type); }
        break;
      }
      default: {
        const imp = Physics.resolve(b, c.nx, c.ny, c.pen, 0, 0, PHYS.WALL_E, PHYS.WALL_F, 0);
        if (imp > 320 && t - b.lastThud > 0.12) { b.lastThud = t; this.emit("thud", { x: b.x, y: b.y, v: imp }); }
      }
    }
  }
  // moving diverters
  for (const arm of this.table._arms) {
    const ang = armAngle(arm, t), om = armOmega(arm, t);
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
          this.add(PTS.spin * turns, (e.a[0] + e.b[0]) / 2, (e.a[1] + e.b[1]) / 2);
          this.emit("spin", { id: e.id, turns });
          this.progress("spin", e.id, turns);
        }
        break;
      }
      case "orbit": {
        if (Physics.crossed(px, py, b.x, b.y, e.a[0], e.a[1], e.b[0], e.b[1]) && b.vx * e.dir[0] + b.vy * e.dir[1] > 0) {
          st.flash = t;
          this.add(PTS.orbit, b.x, b.y);
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

Sim.prototype.spellGroup = function (group) {
  const o = (this.cfg.objectives || []).find((x, i) => x.kind === "spell" && x.group === group && !this.S.obj[i].done);
  return o || null;
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
    const mult = (this.cfg.twist && this.cfg.twist.bumperMult) || 1;
    this.add(PTS.bumper * mult, el.x, el.y - el.r - 6);
    this.feedParade(PARADE.perBumper);
    this.emit("bumper", { id, x: el.x, y: el.y, look: el.look, n: st.hits });
    this.progress("hit", id, 1);
    this.progress("all", id, 1);
    return;
  }
  S.stats.targets++;
  const mx = (el.a[0] + el.b[0]) / 2, my = (el.a[1] + el.b[1]) / 2;
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
      this.scheduleReset(el.group, 1.5);
    }
  } else {
    this.add(PTS.target, mx, my);
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
  for (const e of this.table.elements) if (e.group === g && e.type === "drop") this.S.el[e.id].down = false;
  this.emit("reset", { group: g });
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
    b.mode = "held"; b.until = S.t + 0.5 + 0.45 * k; b.heldAt = e.id;
    S.saveUntil = Math.max(S.saveUntil, S.t + 10);
    this.add(PTS.multiball, e.x, e.y - 18, "multiball");
    this.emit("multiball", { id: e.id, x: e.x, y: e.y });
    this.progress("multiball", e.id, 1);
    return;
  }
  b.mode = "held"; b.until = S.t + (e.hold || 0.8); b.heldAt = e.id;
  this.add(PTS.saucer, e.x, e.y - 18);
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
  S.el[id].cool = S.t + 0.5;
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
    this.add(PTS.ramp * mult, b.x + 20, b.y, "ramp");
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
// Which elements the renderer should ring as "go here" right now.
Sim.prototype.objectiveLights = function () {
  const S = this.S, out = {};
  (this.cfg.objectives || []).forEach((o, i) => {
    if (S.obj[i].done) return;
    if (o.kind === "spell") {
      const want = o.word[S.spell[o.group] || 0];
      const el = this.table.elements.find((e) => e.group === o.group && e.letter === want);
      if (el) out[el.id] = i;
      return;
    }
    for (const id of this.objEls[i]) {
      if (S.el[id].hidden) continue;
      const door = this.table.byId[id].door;
      if (door && S.el[door].closed) continue;        // never light a ramp you cannot get into yet
      if (o.kind === "all" && S.obj[i].seen[id]) continue;
      if (o.kind === "bank" && S.el[id].down) continue;
      if ((o.kind === "lock" || o.kind === "multiball") && !S.el[id].lock) continue;
      if (!(id in out)) out[id] = i;
    }
  });
  return out;
};

if (typeof module !== "undefined") module.exports = { Sim, compileTable, rampPoint, armAngle, LAUNCH, PTS, PARADE, LOCK_N, STUCK, AFTER_PRIMARY };
