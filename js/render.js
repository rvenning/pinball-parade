// Canvas renderer. Draws the SAME element data the physics collides with, in
// explicit layers so an illustration pass can replace the decoration without
// touching anything the player reads:
//
//   1 bg       base material (table-backgrounds/<id>.jpg, else painted felt)
//   2 scenery  non-interactive motif + story characters (characters/*.png)
//   3 rails    walls, slings, posts, gates, ramps, flippers — always code
//   4 mech     bumpers, targets, drops, lanes, spinners, saucers, kickback
//              lights and objective rings — always code
//   5 ball     the ball, particles, floating scores, flashes
//   6 fg       frame/occlusion outside the safe region (table-foregrounds)
//   7 hud      DOM, toggled by a class on the game screen
//
// Layers 1–3 that never change are baked to offscreen canvases per table and
// size; everything with state is drawn live. No ctx.filter and no per-frame
// shadowBlur: soft shadows are baked or faked with alpha fills.
//
// ?layers=bg,rails,…  or  ?hide=ball,fx,hud,mech  choose layers for
// registration screenshots; GK.Debug (?debug=1) has a toggle for each.

const LAYERS = ["bg", "scenery", "rails", "mech", "ball", "fx", "fg", "hud"];

const ART = {
  castle:   { felt: ["#223463", "#121c3a"], rail: "#c9973c", railHi: "#f3d58c", enamel: "#d9534a", enamel2: "#f08c6a", accent: "#e0604f", glow: "#72e6f2", scene: "#3a4f86", ink: "#0b1226", wood: ["#4a2f1d", "#2a1a10"] },
  temple:   { felt: ["#23452f", "#10261a"], rail: "#c9a24a", railHi: "#f1dc93", enamel: "#d7a83c", enamel2: "#f3d479", accent: "#e0604f", glow: "#72e6f2", scene: "#355f40", ink: "#0a1a10", wood: ["#4b3620", "#2a1d10"] },
  sea:      { felt: ["#14485e", "#082333"], rail: "#c9a24a", railHi: "#f1dc93", enamel: "#e8735e", enamel2: "#f6ad8c", accent: "#f08a6a", glow: "#8af2ff", scene: "#1e6680", ink: "#051620", wood: ["#3d3122", "#221b12"] },
  workshop: { felt: ["#4a3020", "#24170d"], rail: "#d9a441", railHi: "#fbe3a1", enamel: "#b8663a", enamel2: "#e39a63", accent: "#e0604f", glow: "#72e6f2", scene: "#6a4a30", ink: "#170e07", wood: ["#2f2a2a", "#1a1616"] },
  clouds:   { felt: ["#435a98", "#1f2b5a"], rail: "#d4ab52", railHi: "#fbe3a1", enamel: "#f2ece0", enamel2: "#ffffff", accent: "#e0604f", glow: "#8af2ff", scene: "#6a80bd", ink: "#0f1736", wood: ["#4a3b5e", "#2a2138"] },
};
const CREAM = "#f6ecd6", CORAL = "#e0604f", BRASS = "#d9a441";

const Render = {
  cv: null, ctx: null, stage: null,
  W: 360, H: 640, dpr: 1, s: 1, ox: 0, oy: 0,
  table: null, art: ART.castle,
  bakes: { base: null, rails: null, key: "" },
  layers: Object.fromEntries(LAYERS.map((l) => [l, true])),
  reduced: false,
  clock: 0,

  boot(cv) {
    this.cv = cv;
    this.stage = cv.parentElement;
    this.ctx = cv.getContext("2d");
    this.reduced = !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);
    if (window.matchMedia) matchMedia("(prefers-reduced-motion: reduce)").addEventListener?.("change", (e) => { this.reduced = e.matches; });
    const q = new URLSearchParams(location.search);
    if (q.get("layers")) for (const l of LAYERS) this.layers[l] = q.get("layers").split(",").includes(l);
    if (q.get("hide")) for (const l of q.get("hide").split(",")) if (l in this.layers) this.layers[l] = false;
    // Watch the canvas's own box: the stage resizes when fonts land, the HUD
    // fills or the toolbar settles, and none of that fires window resize.
    if (window.ResizeObserver) new ResizeObserver(() => this.resize()).observe(this.stage);
    window.addEventListener("resize", () => this.resize());
    window.addEventListener("orientationchange", () => setTimeout(() => this.resize(), 350));
    Assets.onChange(() => { this.bakes.key = ""; });
    this.resize();
  },

  resize() {
    const r = this.stage.getBoundingClientRect();
    if (r.width < 50 || r.height < 50) return;
    this.dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.W = r.width; this.H = r.height;
    this.cv.width = Math.round(r.width * this.dpr);
    this.cv.height = Math.round(r.height * this.dpr);
    this.s = Math.min(r.width / TABLE_W, r.height / TABLE_H);
    this.ox = (r.width - TABLE_W * this.s) / 2;
    // anchor low: the flippers belong near the thumbs
    this.oy = (r.height - TABLE_H * this.s) * 0.85;
    this.bakes.key = "";
    if (this.onResize) this.onResize();
  },

  toLogical(clientX, clientY) {
    const r = this.cv.getBoundingClientRect();
    return { x: (clientX - r.left - this.ox) / this.s, y: (clientY - r.top - this.oy) / this.s };
  },
  toScreen(x, y) {
    const r = this.cv.getBoundingClientRect();
    return { x: r.left + this.ox + x * this.s, y: r.top + this.oy + y * this.s };
  },

  setTable(table) {
    this.table = compileTable(table);
    this.art = ART[table.id] || ART.castle;
    this.bakes.key = "";
  },

  setLayer(name, on) { this.layers[name] = on; this.bakes.key = ""; this.onLayers && this.onLayers(); },

  // ------------------------------------------------------------ bake 1–3 --
  bake() {
    const key = [this.table.id, this.W, this.H, this.dpr, this.layers.bg, this.layers.scenery, this.layers.rails, Object.keys(Assets.imgs).length].join("|");
    if (key === this.bakes.key) return;
    this.bakes.key = key;
    const k = this.s * this.dpr;
    const mk = () => {
      const c = document.createElement("canvas");
      c.width = Math.ceil(TABLE_W * k); c.height = Math.ceil(TABLE_H * k);
      const x = c.getContext("2d");
      x.setTransform(k, 0, 0, k, 0, 0);
      return [c, x];
    };
    const [b, bx] = mk();
    if (this.layers.bg) this.drawBase(bx, this.table);
    if (this.layers.scenery) this.drawScenery(bx, this.table);
    const [r, rx] = mk();
    if (this.layers.rails) this.drawStaticRails(rx, this.table);
    this.bakes.base = b; this.bakes.rails = r;
  },

  drawBase(x, t) {
    const img = Assets.background(t.id);
    if (img) { x.drawImage(img, 0, 0, TABLE_W, TABLE_H); return; }
    const a = ART[t.id];
    const g = x.createLinearGradient(0, 0, 0, TABLE_H);
    g.addColorStop(0, a.felt[0]); g.addColorStop(1, a.felt[1]);
    x.fillStyle = g;
    x.fillRect(0, 0, TABLE_W, TABLE_H);
    // embossed-paper grain: a few hundred faint dots, placed by hash
    x.fillStyle = "rgba(255,255,255,0.035)";
    for (let i = 0; i < 420; i++) {
      const px = GK.util.hash2(i, 7) * TABLE_W, py = GK.util.hash2(i, 13) * TABLE_H;
      x.fillRect(px, py, 1.2, 1.2);
    }
    // soft vignette toward the flippers
    const v = x.createRadialGradient(CX, 300, 60, CX, 360, 420);
    v.addColorStop(0, "rgba(255,255,255,0.05)"); v.addColorStop(1, "rgba(0,0,0,0.25)");
    x.fillStyle = v; x.fillRect(0, 0, TABLE_W, TABLE_H);
  },

  // One restrained motif per world, well below the contrast of anything the
  // ball touches. An illustrated background replaces this entirely.
  drawScenery(x, t) {
    if (Assets.background(t.id)) return;
    const a = ART[t.id], h = GK.util.hash2;
    x.save();
    x.globalAlpha = 0.5;
    x.fillStyle = a.scene; x.strokeStyle = a.scene; x.lineWidth = 3;
    if (t.id === "castle") {
      x.fillStyle = "rgba(255,244,214,0.55)";
      x.beginPath(); x.arc(92, 118, 22, 0, Math.PI * 2); x.fill();
      x.fillStyle = a.felt[0]; x.beginPath(); x.arc(102, 112, 20, 0, Math.PI * 2); x.fill();
      x.fillStyle = "rgba(255,244,214,0.5)";
      for (let i = 0; i < 26; i++) x.fillRect(40 + h(i, 1) * 300, 60 + h(i, 2) * 180, 1.6, 1.6);
      x.fillStyle = a.scene;
      for (const [tx, tw, th] of [[20, 34, 120], [300, 40, 150]]) {
        x.fillRect(tx, 470 - th, tw, th);
        for (let c = 0; c < 3; c++) x.fillRect(tx + c * (tw / 3), 462 - th, tw / 5, 10);
      }
    } else if (t.id === "temple") {
      for (let i = 0; i < 5; i++) x.fillRect(CX - 110 + i * 22, 190 - i * 18, 220 - i * 44, 18);
      for (let i = 0; i < 7; i++) {
        const vx = 40 + i * 48;
        x.beginPath(); x.moveTo(vx, 40); x.quadraticCurveTo(vx + 14, 110, vx - 4, 150 + h(i, 3) * 80); x.stroke();
      }
    } else if (t.id === "sea") {
      for (let i = 0; i < 6; i++) {
        const kx = i < 3 ? 26 + i * 18 : 290 + (i - 3) * 20;
        x.beginPath(); x.moveTo(kx, 720);
        for (let y = 700; y > 470 - h(i, 5) * 80; y -= 20) x.lineTo(kx + Math.sin(y / 18 + i) * 7, y);
        x.stroke();
      }
      for (let i = 0; i < 18; i++) { x.beginPath(); x.arc(40 + h(i, 8) * 300, 80 + h(i, 9) * 360, 2 + h(i, 4) * 4, 0, Math.PI * 2); x.stroke(); }
    } else if (t.id === "workshop") {
      const gear = (gx, gy, r, n) => {
        x.beginPath();
        for (let i = 0; i < n * 2; i++) { const ang = (i / (n * 2)) * Math.PI * 2, rr = i % 2 ? r : r * 0.82; x.lineTo(gx + Math.cos(ang) * rr, gy + Math.sin(ang) * rr); }
        x.closePath(); x.stroke();
        x.beginPath(); x.arc(gx, gy, r * 0.3, 0, Math.PI * 2); x.stroke();
      };
      gear(70, 160, 46, 12); gear(300, 420, 60, 14); gear(120, 470, 30, 9);
    } else if (t.id === "clouds") {
      x.fillStyle = "rgba(255,255,255,0.35)";
      for (const [cx, cy, r] of [[80, 120, 26], [110, 110, 20], [280, 90, 24], [306, 100, 18], [60, 470, 22], [300, 480, 24]]) { x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fill(); }
      // a soft, wide rainbow high up behind the clouds — broad washes, never
      // a thin bright line that could read as a rail
      const bands = ["#e0604f", "#e8a33c", "#e8d46a", "#6fbf73", "#6fb6e6"];
      x.globalAlpha = 0.16; x.lineWidth = 12;
      bands.forEach((c, i) => { x.strokeStyle = c; x.beginPath(); x.arc(CX, 330, 150 - i * 12, Math.PI * 1.1, Math.PI * 1.9); x.stroke(); });
    }
    x.restore();
  },

  railStroke(x, pts, r, a) {
    x.lineCap = "round"; x.lineJoin = "round";
    x.beginPath(); pts.forEach(([px, py], i) => (i ? x.lineTo(px, py) : x.moveTo(px, py)));
    x.strokeStyle = "rgba(0,0,0,0.35)"; x.lineWidth = r * 2 + 2;
    x.save(); x.translate(1.5, 2.5); x.stroke(); x.restore();
    // A dark keyline all round, so a brass rail keeps its edge on ANY
    // background — a bright illustrated sky took it to 2.3:1 without this.
    x.strokeStyle = "rgba(8,10,24,0.62)"; x.lineWidth = r * 2 + 3; x.stroke();
    x.strokeStyle = a.rail; x.lineWidth = r * 2; x.stroke();
    x.strokeStyle = a.railHi; x.lineWidth = Math.max(0.8, r * 0.6); x.globalAlpha = 0.7; x.stroke(); x.globalAlpha = 1;
  },

  drawStaticRails(x, t) {
    const a = ART[t.id];
    // the ramp tracks first, so the rails the ball bounces off sit on top
    for (const e of t.elements) if (e.type === "ramp") this.drawRampTrack(x, e, a);
    for (const e of t.elements) {
      if (e.type === "wall") this.railStroke(x, e.pts, e.r, a);
      if (e.type === "sling") this.drawSling(x, e, a);
      if (e.type === "post" && !e.stateful) this.drawPost(x, e.x, e.y, e.r, a);
      if (e.type === "arm") this.drawPost(x, e.x, e.y, 6, a);
    }
  },

  drawRampTrack(x, e, a) {
    const P = e.path;
    x.save();
    x.lineCap = "round"; x.lineJoin = "round";
    x.beginPath(); P.forEach(([px, py], i) => (i ? x.lineTo(px, py) : x.moveTo(px, py)));
    // an elevated track: a translucent deck with sleepers, lighter than the
    // rails the ball actually bounces off
    x.strokeStyle = "rgba(0,0,0,0.18)"; x.lineWidth = 24; x.stroke();
    x.strokeStyle = "rgba(246,236,214,0.12)"; x.lineWidth = 18; x.stroke();
    x.setLineDash([2, 10]); x.strokeStyle = "rgba(246,236,214,0.22)"; x.lineWidth = 18; x.stroke(); x.setLineDash([]);
    x.strokeStyle = a.rail; x.lineWidth = 2.5;
    for (const side of [-1, 1]) {
      x.beginPath();
      for (let i = 0; i < P.length; i++) {
        const p0 = P[Math.max(0, i - 1)], p1 = P[Math.min(P.length - 1, i + 1)];
        const dx = p1[0] - p0[0], dy = p1[1] - p0[1], L = Math.hypot(dx, dy) || 1;
        const nx = -dy / L * 10 * side, ny = dx / L * 10 * side;
        i ? x.lineTo(P[i][0] + nx, P[i][1] + ny) : x.moveTo(P[i][0] + nx, P[i][1] + ny);
      }
      x.stroke();
    }
    x.restore();
  },

  drawSling(x, e, a) {
    const [A, B, C] = e.pts;
    x.beginPath(); x.moveTo(...A); x.lineTo(...B); x.lineTo(...C); x.closePath();
    x.fillStyle = "rgba(0,0,0,0.25)"; x.fill();
    x.fillStyle = a.ink; x.globalAlpha = 0.6; x.fill(); x.globalAlpha = 1;
    this.railStroke(x, [A, B, C, A], 3, a);
    const [i, j] = e.face;
    x.lineCap = "round"; x.strokeStyle = CORAL; x.lineWidth = 5;
    x.beginPath(); x.moveTo(...e.pts[i]); x.lineTo(...e.pts[j]); x.stroke();
  },

  drawPost(x, px, py, r, a) {
    x.fillStyle = "rgba(0,0,0,0.35)"; x.beginPath(); x.arc(px + 1.5, py + 2.5, r, 0, Math.PI * 2); x.fill();
    x.fillStyle = a.rail; x.beginPath(); x.arc(px, py, r, 0, Math.PI * 2); x.fill();
    x.fillStyle = a.railHi; x.beginPath(); x.arc(px - r * 0.3, py - r * 0.3, r * 0.45, 0, Math.PI * 2); x.fill();
  },

  // ------------------------------------------------------------ the frame --
  draw(sim, dt) {
    const x = this.ctx, t = this.table, S = sim.S, a = this.art;
    this.clock += dt;
    this.bake();
    x.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    // surround: the cabinet the table sits in
    const g = x.createLinearGradient(0, 0, 0, this.H);
    g.addColorStop(0, a.wood[0]); g.addColorStop(1, a.wood[1]);
    x.fillStyle = g; x.fillRect(0, 0, this.W, this.H);

    const [shx, shy] = (this.reduced || !this.layers.fx) ? [0, 0] : Fx.shakeOffset();
    x.save();
    x.translate(this.ox + shx * this.s, this.oy + shy * this.s);
    x.drawImage(this.bakes.base, 0, 0, TABLE_W * this.s, TABLE_H * this.s);
    x.scale(this.s, this.s);
    if (this.layers.scenery) this.drawToys(x, sim);
    x.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    x.translate(this.ox + shx * this.s, this.oy + shy * this.s);
    x.drawImage(this.bakes.rails, 0, 0, TABLE_W * this.s, TABLE_H * this.s);
    x.scale(this.s, this.s);
    if (this.layers.rails) this.drawLiveRails(x, sim);
    if (this.layers.mech) this.drawMechanisms(x, sim);
    if (this.layers.ball) this.drawBalls(x, sim);
    if (this.layers.fx) Fx.render(x);
    if (this.layers.fg) this.drawForeground(x, t);
    x.restore();
    if (this.layers.fx && Fx.flash > 0.01) {
      x.fillStyle = Fx.flashColor || "#fff"; x.globalAlpha = Math.min(0.5, Fx.flash);
      x.fillRect(0, 0, this.W, this.H); x.globalAlpha = 1;
    }
  },

  drawToys(x, sim) {
    for (const e of sim.table.elements) if (e.type === "toy") {
      const awake = sim.S.el[e.id].awake;
      const img = Assets.character(e.look, awake);
      if (img) { x.drawImage(img, e.x - e.w / 2, e.y - e.h / 2, e.w, e.h); continue; }
      if (e.look === "dragon") this.paintDragon(x, e, awake);
      if (e.look === "automaton") this.paintAutomaton(x, e, awake);
    }
  },

  paintDragon(x, e, awake) {
    const bob = awake ? Math.sin(this.clock * 3) * 2 : Math.sin(this.clock * 1.2) * 1;
    x.save(); x.translate(e.x, e.y + bob); x.globalAlpha = awake ? 1 : 0.8;
    x.fillStyle = "#b8473c";
    x.beginPath(); x.ellipse(0, 6, 44, 18, 0, 0, Math.PI * 2); x.fill();                 // body
    x.beginPath(); x.moveTo(-10, -4); x.lineTo(-40, -30); x.lineTo(-18, 2); x.fill();   // wing
    x.beginPath(); x.moveTo(8, -4); x.lineTo(34, -32); x.lineTo(22, 2); x.fill();
    x.beginPath(); x.arc(40, -2, 13, 0, Math.PI * 2); x.fill();                        // head
    x.fillStyle = "#f3c26b";
    x.beginPath(); x.ellipse(0, 12, 30, 7, 0, 0, Math.PI * 2); x.fill();               // belly
    x.strokeStyle = "#2a0d0a"; x.lineWidth = 2; x.lineCap = "round";
    if (awake) { x.fillStyle = "#fff4d6"; x.beginPath(); x.arc(44, -5, 3.2, 0, Math.PI * 2); x.fill(); x.fillStyle = "#2a0d0a"; x.beginPath(); x.arc(45, -5, 1.6, 0, Math.PI * 2); x.fill(); }
    else { x.beginPath(); x.arc(44, -4, 3, 0.2, Math.PI - 0.2); x.stroke(); }
    if (awake) { x.fillStyle = "rgba(255,170,60,0.8)"; for (let i = 0; i < 3; i++) { x.beginPath(); x.arc(58 + i * 7, -2 + Math.sin(this.clock * 9 + i) * 2, 4 - i, 0, Math.PI * 2); x.fill(); } }
    else { x.fillStyle = "rgba(255,244,214,0.7)"; x.font = "bold 11px 'Baloo 2', sans-serif"; x.fillText("z", 54, -18 - (this.clock * 6 % 8)); }
    x.restore();
  },

  paintAutomaton(x, e, awake) {
    const step = awake ? Math.sin(this.clock * 6) * 3 : 0;
    x.save(); x.translate(e.x, e.y);
    x.fillStyle = "#3b5a8c"; x.fillRect(-12, -10 + Math.abs(step) * 0.3, 24, 30);
    x.fillStyle = "#f3dcc0"; x.beginPath(); x.arc(0, -18, 9, 0, Math.PI * 2); x.fill();
    x.fillStyle = CORAL; x.fillRect(-10, -30, 20, 6);
    x.fillStyle = "#2a2a2a"; x.fillRect(-9, 20, 7, 10 + step); x.fillRect(2, 20, 7, 10 - step);
    x.strokeStyle = BRASS; x.lineWidth = 3; x.save(); x.translate(15, 0); x.rotate(awake ? this.clock * 4 : 0);
    x.beginPath(); x.moveTo(-6, 0); x.lineTo(6, 0); x.moveTo(0, -6); x.lineTo(0, 6); x.stroke(); x.restore();
    x.restore();
  },

  drawLiveRails(x, sim) {
    const S = sim.S, t = sim.table, a = this.art;
    for (const e of t.elements) {
      if (e.type === "gate") {
        const st = S.el[e.id];
        if (e.oneWay) { x.strokeStyle = a.railHi; x.lineWidth = 2; x.lineCap = "round"; x.beginPath(); x.moveTo(...e.a); x.lineTo(...e.b); x.stroke(); continue; }
        if (st.closed) {
          // a raised drawbridge / shut door: solid planks with bolts
          x.lineCap = "butt"; x.strokeStyle = "#6b4526"; x.lineWidth = e.r * 2 + 4;
          x.beginPath(); x.moveTo(...e.a); x.lineTo(...e.b); x.stroke();
          x.strokeStyle = a.rail; x.lineWidth = 2; x.stroke();
        } else {
          x.strokeStyle = "rgba(107,69,38,0.55)"; x.lineWidth = 3; x.setLineDash([4, 4]);
          x.beginPath(); x.moveTo(...e.a); x.lineTo(...e.b); x.stroke(); x.setLineDash([]);
        }
      }
      if (e.type === "post" && e.stateful && !S.el[e.id].hidden) {
        this.drawPost(x, e.x, e.y, e.r, a);
        x.strokeStyle = CREAM; x.lineWidth = 1.5; x.beginPath(); x.arc(e.x, e.y, e.r - 2.5, 0, Math.PI * 2); x.stroke();
      }
      if (e.type === "arm") {
        const ang = armAngle(e, S.t);
        this.capsule(x, e.x, e.y, e.x + Math.cos(ang) * e.len, e.y + Math.sin(ang) * e.len, e.r, e.r, a.rail, a.railHi);
        this.drawPost(x, e.x, e.y, 6, a);
      }
    }
    t.flippers.forEach((f, i) => {
      const ang = S.flip[i].ang;
      const [tx, ty] = Physics.flipperTip(f, ang);
      x.save(); x.translate(1.5, 3); x.globalAlpha = 0.35;
      this.capsule(x, f.x, f.y, tx, ty, f.r0, f.r1, "#000", null); x.restore();
      this.capsule(x, f.x, f.y, tx, ty, f.r0, f.r1, CORAL, null);
      this.capsule(x, f.x, f.y, tx, ty, f.r0 - 2.2, f.r1 - 2.2, CREAM, null);
      x.fillStyle = BRASS; x.beginPath(); x.arc(f.x, f.y, 4, 0, Math.PI * 2); x.fill();
    });
  },

  // A tapered capsule as one path: two circles joined by their tangents.
  capsule(x, ax, ay, bx, by, r0, r1, fill, hi) {
    const ang = Math.atan2(by - ay, bx - ax);
    x.beginPath();
    x.arc(ax, ay, r0, ang + Math.PI / 2, ang - Math.PI / 2);
    x.arc(bx, by, r1, ang - Math.PI / 2, ang + Math.PI / 2);
    x.closePath();
    x.fillStyle = fill; x.fill();
    if (hi) { x.strokeStyle = hi; x.lineWidth = 1; x.stroke(); }
  },

  pulse() { return this.reduced ? 0.6 : 0.5 + 0.5 * Math.sin(this.clock * 6); },

  drawMechanisms(x, sim) {
    const S = sim.S, t = sim.table, a = this.art, now = S.t;
    this._sim = sim;
    const lights = sim.objectiveLights();
    const P = this.pulse();
    // Objective rings and lit inserts are the game telling the player where
    // to aim, so they always sit on a dark underlay: a cyan ring over painted
    // cyan water must still read as "hit this".
    const ring = (cx, cy, r) => {
      x.strokeStyle = "rgba(6,8,18,0.6)"; x.lineWidth = 5.5;
      x.beginPath(); x.arc(cx, cy, r + 3 + P * 3, 0, Math.PI * 2); x.stroke();
      x.strokeStyle = a.glow; x.lineWidth = 2.5; x.globalAlpha = 0.45 + 0.5 * P;
      x.beginPath(); x.arc(cx, cy, r + 3 + P * 3, 0, Math.PI * 2); x.stroke(); x.globalAlpha = 1;
    };
    for (const f of t._fields) {
      if (S.el[f.id].hidden) continue;
      const on = !f.pulse || (now % f.pulse.period) < f.pulse.on;
      const [x0, y0, x1, y1] = f.rect;
      x.fillStyle = on ? "rgba(140,240,255,0.10)" : "rgba(140,240,255,0.03)";
      x.fillRect(x0, y0, x1 - x0, y1 - y0);
      if (on) {
        x.strokeStyle = "rgba(170,245,255,0.5)"; x.lineWidth = 1.5;
        const off = this.reduced ? 0 : (this.clock * 90) % 40;
        for (let y = y1 - off; y > y0; y -= 40) { const cx = (x0 + x1) / 2; x.beginPath(); x.moveTo(cx - 7, y + 6); x.lineTo(cx, y); x.lineTo(cx + 7, y + 6); x.stroke(); }
      }
    }
    for (const e of t.elements) {
      const st = S.el[e.id];
      if (st.hidden) continue;
      const fresh = now - st.flash < 0.15;
      switch (e.type) {
        case "bumper": {
          const squash = fresh ? 0.88 + (now - st.flash) / 0.15 * 0.12 : 1;
          if (e.id in lights) ring(e.x, e.y, e.r);
          this.paintBumper(x, e, squash, fresh, now);
          break;
        }
        case "target": case "drop": {
          const down = e.type === "drop" && st.down;
          if (down) { x.strokeStyle = "rgba(0,0,0,0.5)"; x.lineWidth = 3; x.lineCap = "round"; x.beginPath(); x.moveTo(...e.a); x.lineTo(...e.b); x.stroke(); break; }
          const lit = e.id in lights;
          if (lit) { x.strokeStyle = a.glow; x.globalAlpha = 0.4 + 0.5 * P; x.lineWidth = e.r * 2 + 8; x.lineCap = "round"; x.beginPath(); x.moveTo(...e.a); x.lineTo(...e.b); x.stroke(); x.globalAlpha = 1; }
          this.capsule(x, ...e.a, ...e.b, e.r, e.r, fresh ? "#fff" : (e.type === "drop" ? "#8a6ad0" : a.accent), CREAM);
          if (e.letter) {
            const mx = (e.a[0] + e.b[0]) / 2, my = (e.a[1] + e.b[1]) / 2;
            const vert = Math.abs(e.a[0] - e.b[0]) < 2;
            const lx = mx + (vert ? (mx < CX ? 13 : -13) : 0), ly = my + (vert ? 0 : 14);
            x.fillStyle = lit ? a.glow : CREAM; x.font = "800 11px 'Baloo 2', sans-serif"; x.textAlign = "center"; x.textBaseline = "middle";
            x.fillText(e.letter, lx, ly);
          }
          break;
        }
        case "rollover": {
          if (e.id in lights && !st.lit) ring(e.x, e.y, e.r - 2);
          x.fillStyle = "rgba(6,8,18,0.7)"; x.beginPath(); x.arc(e.x, e.y, e.r - 0.5, 0, Math.PI * 2); x.fill();   // the recessed insert
          x.strokeStyle = CREAM; x.lineWidth = 1.5; x.beginPath(); x.arc(e.x, e.y, e.r - 2, 0, Math.PI * 2); x.stroke();
          x.fillStyle = st.lit ? a.glow : "rgba(255,255,255,0.12)"; x.beginPath(); x.arc(e.x, e.y, e.r - 4.5, 0, Math.PI * 2); x.fill();
          break;
        }
        case "spinner": {
          const mx = (e.a[0] + e.b[0]) / 2, my = (e.a[1] + e.b[1]) / 2;
          if (e.id in lights) ring(mx, my, 10);
          x.strokeStyle = a.rail; x.lineWidth = 1.5; x.beginPath(); x.moveTo(...e.a); x.lineTo(...e.b); x.stroke();
          const w = Math.abs(Math.cos(st.spin)) * 6 + 1;
          const vert = Math.abs(e.a[0] - e.b[0]) < 2;
          x.fillStyle = CREAM;
          if (vert) x.fillRect(mx - w / 2, my - 11, w, 22); else x.fillRect(mx - 11, my - w / 2, 22, w);
          break;
        }
        case "orbit": {
          const mx = (e.a[0] + e.b[0]) / 2, my = (e.a[1] + e.b[1]) / 2;
          const lit = e.id in lights || now - st.flash < 0.4;
          x.fillStyle = lit ? a.glow : "rgba(255,255,255,0.18)"; x.globalAlpha = e.id in lights ? 0.5 + 0.5 * P : 1;
          x.beginPath(); x.moveTo(mx, my - 9); x.lineTo(mx + 9, my + 4); x.lineTo(mx - 9, my + 4); x.closePath(); x.fill(); x.globalAlpha = 1;
          break;
        }
        case "ramp": {
          const [m0, m1] = e.mouth, mx = (m0[0] + m1[0]) / 2, my = (m0[1] + m1[1]) / 2;
          const lit = e.id in lights;
          x.fillStyle = lit ? a.glow : "rgba(255,244,214,0.35)";
          for (let i = 0; i < 3; i++) {
            const k = lit && !this.reduced ? ((this.clock * 2 + i / 3) % 1) : i / 3;
            x.globalAlpha = lit ? 1 - k * 0.7 : 0.8;
            const cx = mx - e.enter[0] * (34 - k * 30), cy = my - e.enter[1] * (34 - k * 30);
            const px = -e.enter[1] * 8, py = e.enter[0] * 8;
            x.beginPath(); x.moveTo(cx + e.enter[0] * 7, cy + e.enter[1] * 7); x.lineTo(cx + px, cy + py); x.lineTo(cx - px, cy - py); x.closePath(); x.fill();
          }
          x.globalAlpha = 1;
          break;
        }
        case "saucer": {
          if (e.id in lights || st.lock) ring(e.x, e.y, e.r + 2);
          x.fillStyle = "#07090f"; x.beginPath(); x.arc(e.x, e.y, e.r, 0, Math.PI * 2); x.fill();
          x.strokeStyle = st.lock ? a.glow : a.rail; x.lineWidth = 3; x.stroke();
          if (st.lock) { x.fillStyle = a.glow; x.fillRect(e.x - 4, e.y - 1, 8, 7); x.strokeStyle = a.glow; x.lineWidth = 1.8; x.beginPath(); x.arc(e.x, e.y - 2, 3, Math.PI, 0); x.stroke(); }
          const n = S.balls.filter((b) => b.mode === "locked" && b.lockAt === e.id).length;
          for (let i = 0; i < n; i++) this.paintBall(x, e.x - 16 + i * 32, e.y + 20, 0.8);
          break;
        }
        case "kickback": {
          x.fillStyle = st.lit ? CORAL : "rgba(255,255,255,0.12)";
          x.globalAlpha = st.lit ? 0.7 + 0.3 * P : 1;
          x.beginPath(); x.moveTo(e.x, e.y - 12); x.lineTo(e.x + 7, e.y); x.lineTo(e.x - 7, e.y); x.closePath(); x.fill();
          x.beginPath(); x.moveTo(e.x, e.y - 2); x.lineTo(e.x + 7, e.y + 10); x.lineTo(e.x - 7, e.y + 10); x.closePath(); x.fill();
          x.globalAlpha = 1;
          break;
        }
      }
    }
  },

  paintBumper(x, e, squash, fresh, now) {
    const a = this.art, r = e.r * squash;
    x.fillStyle = "rgba(0,0,0,0.35)"; x.beginPath(); x.arc(e.x + 2, e.y + 3.5, e.r, 0, Math.PI * 2); x.fill();
    x.fillStyle = a.rail; x.beginPath(); x.arc(e.x, e.y, r, 0, Math.PI * 2); x.fill();
    const cap = x.createRadialGradient(e.x - r * 0.35, e.y - r * 0.35, 1, e.x, e.y, r * 0.9);
    cap.addColorStop(0, fresh ? "#ffffff" : a.enamel2); cap.addColorStop(1, fresh ? a.enamel2 : a.enamel);
    x.fillStyle = cap; x.beginPath(); x.arc(e.x, e.y, r * 0.8, 0, Math.PI * 2); x.fill();
    x.save(); x.translate(e.x, e.y);
    const ink = e.look === "cloud" ? "#6a80bd" : "#fff4dc";
    x.fillStyle = ink; x.strokeStyle = ink; x.lineWidth = 2; x.lineCap = "round";
    const k = r / 20;
    switch (e.look) {
      case "bell":
        x.beginPath(); x.moveTo(-7 * k, 5 * k); x.quadraticCurveTo(-7 * k, -9 * k, 0, -9 * k); x.quadraticCurveTo(7 * k, -9 * k, 7 * k, 5 * k); x.closePath(); x.fill();
        x.beginPath(); x.arc(0, 7 * k, 2.2 * k, 0, Math.PI * 2); x.fill(); break;
      case "idol": {
        x.fillStyle = "#6b4a14"; x.fillRect(-8 * k, -5 * k, 5 * k, 3 * k); x.fillRect(3 * k, -5 * k, 5 * k, 3 * k);
        const awake = this._sim && this._sim.S.el.idol && this._sim.S.el.idol.awake;
        x.fillStyle = awake ? this.art.glow : "#6b4a14"; x.beginPath(); x.arc(0, 4 * k, 3 * k, 0, Math.PI * 2); x.fill(); break;
      }
      case "leaf":
        x.beginPath(); x.ellipse(0, 0, 4 * k, 9 * k, 0.6, 0, Math.PI * 2); x.stroke();
        x.beginPath(); x.moveTo(-5 * k, 6 * k); x.lineTo(5 * k, -6 * k); x.stroke(); break;
      case "shell":
        for (let i = -2; i <= 2; i++) { x.beginPath(); x.moveTo(0, 8 * k); x.lineTo(i * 4 * k, -7 * k); x.stroke(); } break;
      case "gear": {
        x.rotate(now * 1.5);
        for (let i = 0; i < 8; i++) { x.rotate(Math.PI / 4); x.fillRect(-2 * k, -11 * k, 4 * k, 5 * k); }
        x.beginPath(); x.arc(0, 0, 3.5 * k, 0, Math.PI * 2); x.fill(); break;
      }
      case "cloud":
        for (const [cx, cy, cr] of [[-5, 2, 5], [0, -3, 6], [6, 2, 4.5]]) { x.beginPath(); x.arc(cx * k, cy * k, cr * k, 0, Math.PI * 2); x.stroke(); } break;
    }
    x.restore();
  },

  paintBall(x, bx, by, scale = 1) {
    const r = PHYS.BALL_R * scale;
    x.fillStyle = "rgba(0,0,0,0.4)"; x.beginPath(); x.arc(bx + 2.2, by + 3.2, r, 0, Math.PI * 2); x.fill();
    const g = x.createRadialGradient(bx - r * 0.4, by - r * 0.45, r * 0.1, bx, by, r);
    g.addColorStop(0, "#ffffff"); g.addColorStop(0.45, "#f3eee2"); g.addColorStop(1, "#8f97a6");
    x.fillStyle = g; x.beginPath(); x.arc(bx, by, r, 0, Math.PI * 2); x.fill();
    x.strokeStyle = "rgba(20,24,40,0.7)"; x.lineWidth = 1; x.stroke();
    x.fillStyle = "#9ff4ff"; x.beginPath(); x.arc(bx + r * 0.35, by + r * 0.3, r * 0.22, 0, Math.PI * 2); x.fill();
  },

  drawBalls(x, sim) {
    for (const b of sim.S.balls) {
      if (b.mode === "locked") continue;
      const s = b.mode === "ride" ? 1.25 : 1;
      this.paintBall(x, b.x, b.y, s);
    }
  },

  // Procedural foreground: the cabinet wood everywhere outside the shell, so
  // the table reads as a thing in a frame. A foreground image replaces it.
  drawForeground(x, t) {
    const img = Assets.foreground(t.id);
    if (img) { x.drawImage(img, 0, 0, TABLE_W, TABLE_H); return; }
    const shell = t.byId.shell.pts;
    x.save();
    x.beginPath();
    x.rect(-4, -4, TABLE_W + 8, TABLE_H + 8);
    x.moveTo(shell[0][0], TABLE_H + 4);
    for (const p of shell) x.lineTo(p[0], p[1]);
    x.lineTo(shell[shell.length - 1][0], TABLE_H + 4);
    x.closePath();
    const g = x.createLinearGradient(0, 0, 0, TABLE_H);
    g.addColorStop(0, this.art.wood[0]); g.addColorStop(1, this.art.wood[1]);
    x.fillStyle = g;
    x.fill("evenodd");
    x.restore();
    this.railStroke(x, shell, 3, this.art);
  },

  // --------------------------------------------------------- small pieces --
  // An illustrated card for the book when no world-card image exists: the
  // real table, drawn by the same code, small.
  thumbnail(table, w, h) {
    const c = document.createElement("canvas");
    const d = Math.min(2, window.devicePixelRatio || 1);
    c.width = w * d; c.height = h * d;
    const x = c.getContext("2d");
    const k = Math.max(w / TABLE_W, h / (TABLE_H * 0.62)) * d;
    x.setTransform(k, 0, 0, k, (w * d - TABLE_W * k) / 2, -30 * k);
    const t = compileTable(table);
    const sim = new Sim(t, freePlayConfig(t.id));
    const prev = this.art; this.art = ART[t.id];
    this.drawBase(x, t); this.drawScenery(x, t); this.drawStaticRails(x, t);
    this.drawToys(x, sim); this.drawLiveRails(x, sim); this.drawMechanisms(x, sim);
    this.art = prev;
    return c;
  },

  // Objective icons for the HUD chips and the chapter card, drawn in code
  // so no emoji stands in for game art.
  icon(kind, px, world) {
    const c = document.createElement("canvas");
    const d = Math.min(2, window.devicePixelRatio || 1);
    c.width = c.height = px * d;
    const x = c.getContext("2d");
    x.setTransform((px * d) / 32, 0, 0, (px * d) / 32, 0, 0);
    const a = ART[world] || ART.castle;
    x.translate(16, 16);
    x.lineCap = "round"; x.lineJoin = "round";
    const disk = (col) => { x.fillStyle = col; x.beginPath(); x.arc(0, 0, 13, 0, Math.PI * 2); x.fill(); };
    x.fillStyle = CREAM; x.strokeStyle = CREAM; x.lineWidth = 2.4;
    const fake = { x: 0, y: 0, r: 13, look: kind };
    switch (kind) {
      case "bell": case "idol": case "shell": case "gear": case "puff": {
        const prev = this.art; this.art = a;
        this.paintBumper(x, Object.assign(fake, { look: kind === "puff" ? "cloud" : kind }), 1, false, 0);
        this.art = prev; break;
      }
      case "star": x.fillStyle = CORAL; x.beginPath(); for (let i = 0; i < 10; i++) { const r = i % 2 ? 5.5 : 13, g = -Math.PI / 2 + i * Math.PI / 5; x.lineTo(Math.cos(g) * r, Math.sin(g) * r); } x.closePath(); x.fill(); break;
      case "dragon": x.fillStyle = "#b8473c"; x.beginPath(); x.arc(0, 2, 10, 0, Math.PI * 2); x.fill(); x.beginPath(); x.moveTo(-8, -4); x.lineTo(-12, -13); x.lineTo(-2, -7); x.moveTo(8, -4); x.lineTo(12, -13); x.lineTo(2, -7); x.fill(); x.fillStyle = CREAM; x.beginPath(); x.arc(-4, 0, 2, 0, 7); x.arc(4, 0, 2, 0, 7); x.fill(); break;
      case "ramp": case "rainbow": {
        const cols = kind === "rainbow" ? ["#e0604f", "#e8a33c", "#e8d46a", "#6fbf73", "#6fb6e6"] : [BRASS];
        cols.forEach((col, i) => { x.strokeStyle = col; x.lineWidth = kind === "rainbow" ? 2.4 : 4; x.beginPath(); x.arc(0, 10, 12 - i * 2.4, Math.PI, 0); x.stroke(); });
        if (kind === "ramp") { x.fillStyle = CREAM; x.beginPath(); x.moveTo(12, 2); x.lineTo(16, 10); x.lineTo(8, 10); x.fill(); }
        break;
      }
      case "parade": {
        // a parade pennant on a brass pole
        x.strokeStyle = BRASS; x.lineWidth = 2.6; x.beginPath(); x.moveTo(-9, 14); x.lineTo(-9, -13); x.stroke();
        x.fillStyle = CORAL; x.beginPath(); x.moveTo(-8, -12); x.lineTo(13, -6); x.lineTo(-8, 1); x.closePath(); x.fill();
        x.fillStyle = CREAM; x.beginPath(); for (let i = 0; i < 10; i++) { const r = i % 2 ? 1.6 : 3.8, g = -Math.PI / 2 + i * Math.PI / 5; x.lineTo(-1 + Math.cos(g) * r, -5.5 + Math.sin(g) * r); } x.closePath(); x.fill();
        x.fillStyle = BRASS; x.beginPath(); x.arc(-9, -14, 2.4, 0, 7); x.fill();
        break;
      }
      case "lanes": for (let i = -1; i <= 1; i++) { x.fillStyle = a.glow; x.beginPath(); x.arc(i * 9, 3, 3.6, 0, 7); x.fill(); x.strokeStyle = CREAM; x.lineWidth = 2; x.beginPath(); x.moveTo(i * 9 - 4.5, -10); x.lineTo(i * 9 - 4.5, 12); x.stroke(); } break;
      case "spinner": x.strokeStyle = BRASS; x.beginPath(); x.moveTo(0, -13); x.lineTo(0, 13); x.stroke(); x.fillStyle = CREAM; x.fillRect(-8, -3, 16, 6); x.strokeStyle = a.glow; x.lineWidth = 1.6; x.beginPath(); x.arc(0, 0, 11, -0.6, 0.6); x.stroke(); break;
      case "stone": for (let i = 0; i < 3; i++) { x.fillStyle = i === 1 ? "#8a6ad0" : "#b9a888"; x.fillRect(-12 + i * 9, -10 + (i === 1 ? 6 : 0), 7, 20 - (i === 1 ? 6 : 0)); } break;
      case "pearl": for (const [px, py] of [[-6, 4], [6, 4], [0, -6]]) { x.fillStyle = "#f7f1e6"; x.beginPath(); x.arc(px, py, 5.5, 0, 7); x.fill(); x.fillStyle = "#b6e8f0"; x.beginPath(); x.arc(px + 1.5, py + 1.5, 1.6, 0, 7); x.fill(); } break;
      case "chest": x.fillStyle = "#8a5a2b"; x.fillRect(-12, -4, 24, 14); x.beginPath(); x.moveTo(-12, -4); x.quadraticCurveTo(0, -16, 12, -4); x.fill(); x.fillStyle = BRASS; x.fillRect(-2, -4, 4, 7); x.strokeStyle = BRASS; x.lineWidth = 1.5; x.strokeRect(-12, -4, 24, 14); break;
      case "current": case "wind": x.strokeStyle = a.glow; for (let i = 0; i < 3; i++) { x.beginPath(); x.moveTo(-11, 8 - i * 7); x.quadraticCurveTo(-4, 3 - i * 7, 0, 8 - i * 7); x.quadraticCurveTo(5, 13 - i * 7, 11, 8 - i * 7); x.stroke(); } x.fillStyle = CREAM; x.beginPath(); x.moveTo(0, -14); x.lineTo(5, -8); x.lineTo(-5, -8); x.fill(); break;
      case "lock": x.fillStyle = a.glow; x.fillRect(-9, -2, 18, 14); x.strokeStyle = a.glow; x.lineWidth = 3; x.beginPath(); x.arc(0, -3, 6, Math.PI, 0); x.stroke(); x.fillStyle = a.ink; x.fillRect(-1.5, 3, 3, 5); break;
      case "multiball": this.paintBall(x, -5, 2, 0.9); this.paintBall(x, 6, -3, 0.9); break;
      case "key": x.strokeStyle = BRASS; x.lineWidth = 3; x.beginPath(); x.arc(-5, 0, 6, 0, 7); x.moveTo(1, 0); x.lineTo(13, 0); x.moveTo(9, 0); x.lineTo(9, 5); x.moveTo(13, 0); x.lineTo(13, 5); x.stroke(); break;
      case "spell": x.fillStyle = CREAM; x.fillRect(-13, -8, 12, 16); x.fillRect(1, -8, 12, 16); x.fillStyle = a.ink; x.font = "800 12px 'Baloo 2', sans-serif"; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText("A", -7, 1); x.fillText("B", 7, 1); break;
      case "score": default: x.fillStyle = BRASS; x.beginPath(); x.arc(0, 0, 12, 0, 7); x.fill(); x.fillStyle = a.ink; x.font = "800 12px 'Baloo 2', sans-serif"; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText("123".slice(0, 2), 0, 1);
    }
    return c;
  },
};
