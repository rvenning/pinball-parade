// Audit table art against assets/ART-BRIEF.md, numerically — the checks a
// screenshot cannot make.  node tools/audit-art.js   (exit 1 on a failure)
//  - foreground: alpha must be 0 at every pixel inside the safe region (the shell
//    polygon incl. the plunger lane), checked at 2× resolution.
//  - background: luminance near solids (within 20 px at 2×) and overall, and the
//    contrast of the ivory ball against the brighter paint (95th percentile).
// Rails carry their own dark keyline in the renderer, so rail contrast against
// the paint is reported for information only. Missing art is skipped.
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const { decodePNG } = require(ROOT + "/lib/tools/png.js");
const G = require(ROOT + "/tests/load.js");
const { launch } = require("./cdp.js");

const lum = (r, g, b) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const inPoly = (x, y, P) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [xi, yi] = P[i], [xj, yj] = P[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };

(async () => {
  const b = await launch({ width: 400, height: 400, dpr: 1 });
  await b.send("Page.navigate", { url: "about:blank" });
  const out = [];
  const fails = [];
  for (const t of G.TABLES) {
    const fgFile = path.join(ROOT, "assets/table-foregrounds", t.id + ".png"), bgFile = path.join(ROOT, "assets/table-backgrounds", t.id + ".jpg");
    if (!fs.existsSync(fgFile) || !fs.existsSync(bgFile)) { console.log("  - skipping", t.id, "(no table art)"); continue; }
    const shell = t.byId.shell.pts;
    const poly = [[shell[0][0], 720], ...shell, [shell[shell.length - 1][0], 720]].map(([x, y]) => [x * 2, y * 2]);
    // foreground alpha inside the safe region (inset 3 logical px = the rail's own half-width)
    const fg = decodePNG(fs.readFileSync(fgFile));
    let inside = 0, opaque = 0, maxA = 0, worst = null;
    for (let y = 0; y < fg.height; y += 1) for (let x = 0; x < fg.width; x += 1) {
      if (!inPoly(x + 0.5, y + 0.5, poly)) continue;
      // skip the rail itself: within 3 logical px of the shell line is rail, drawn by code on top anyway
      const lx = (x + 0.5) / 2, ly = (y + 0.5) / 2;
      let near = false;
      for (let i = 0; i + 1 < shell.length && !near; i++) { const q = G.Physics.closest(lx, ly, ...shell[i], ...shell[i + 1]); if (Math.hypot(lx - q.x, ly - q.y) < 3) near = true; }
      if (near) continue;
      inside++;
      const a = fg.rgba[(y * fg.width + x) * 4 + 3];
      if (a > 0) { opaque++; if (a > maxA) { maxA = a; worst = [lx.toFixed(0), ly.toFixed(0)]; } }
    }
    // background: decode the JPEG in the browser
    const url = "data:image/jpeg;base64," + fs.readFileSync(bgFile).toString("base64");
    const px = await b.evaluate(`(async () => { const i = new Image(); i.src = ${JSON.stringify(url)}; await i.decode(); const c = document.createElement("canvas"); c.width = i.naturalWidth; c.height = i.naturalHeight; const x = c.getContext("2d"); x.drawImage(i, 0, 0); return [c.width, c.height, Array.from(x.getImageData(0, 0, c.width, c.height).data)]; })()`);
    const [W, H, d] = px;
    // solids as capsules, in logical space
    G.compileTable(t);
    const prims = t._prims;
    let nearMax = 0, nearSum = 0, nearN = 0, allSum = 0, allN = 0, playMax = 0;
    const L = [];
    for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) {
      if (!inPoly(x, y, poly)) continue;
      const i = (y * W + x) * 4, l = lum(d[i], d[i + 1], d[i + 2]);
      allSum += l; allN++; L.push(l);
      playMax = Math.max(playMax, l);
      const lx = x / 2, ly = y / 2;
      let near = false;
      for (const p of prims) { if (lx < p.x0 - 10 || lx > p.x1 + 10 || ly < p.y0 - 10 || ly > p.y1 + 10) continue; const q = G.Physics.closest(lx, ly, p.ax, p.ay, p.bx, p.by); if (Math.hypot(lx - q.x, ly - q.y) < p.r + 10) { near = true; break; } }
      if (near) { nearMax = Math.max(nearMax, l); nearSum += l; nearN++; }
    }
    L.sort((a, b) => a - b);
    const p95 = L[Math.floor(L.length * 0.95)], p99 = L[Math.floor(L.length * 0.99)];
    const ball = lum(243, 238, 226), rail = lum(201, 151, 60);
    const cr = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    out.push({ table: t.id, fg: { insidePx: inside, nonTransparent: opaque, maxAlpha: maxA, at: worst },
      bg: { mean: +(allSum / allN).toFixed(3), p95: +p95.toFixed(3), p99: +p99.toFixed(3), max: +playMax.toFixed(3), nearRailsMean: +(nearSum / nearN).toFixed(3), nearRailsMax: +nearMax.toFixed(3),
        ballVsP95: +cr(ball, p95).toFixed(2), railVsNearMean: +cr(rail, nearSum / nearN).toFixed(2) } });
    if (opaque) fails.push(`${t.id}: foreground has ${opaque} non-transparent pixels inside the safe region (worst at ${worst})`);
    if (cr(ball, p95) < 3) fails.push(`${t.id}: the ball is only ${cr(ball, p95).toFixed(2)}:1 against the brighter paint (needs 3)`);
  }
  await b.close();
  for (const o of out) console.log(`  ${o.table.padEnd(9)} fg opaque-in-safe ${o.fg.nonTransparent}  bg mean ${o.bg.mean} p95 ${o.bg.p95}  ball ${o.bg.ballVsP95}:1  rail/paint ${o.bg.railVsNearMean}:1`);
  for (const f of fails) console.log("  ✗", f);
  if (!fails.length) console.log("  ✓ table art passes the brief's numeric checks");
  process.exitCode = fails.length ? 1 : 0;
})();
