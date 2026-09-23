// Rasterise a table's collision geometry to PNG — a greybox you can look at
// without a browser. Solid = grey, sensors = green, ramps = orange path,
// flippers at rest = cream, optional ball trail = cyan.
//   node tools/debug-table.js castle [out.png]
const fs = require("node:fs");
const path = require("node:path");
const { encodePNG } = require("../lib/tools/png.js");
const G = require("../tests/load.js");

function raster(table, opts = {}) {
  const S = opts.scale || 1, W = 400 * S, H = 720 * S;
  const px = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) { px[i * 4] = 18; px[i * 4 + 1] = 24; px[i * 4 + 2] = 48; px[i * 4 + 3] = 255; }
  const put = (x, y, c, a = 1) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = (y * W + x) * 4;
    px[i] = px[i] * (1 - a) + c[0] * a; px[i + 1] = px[i + 1] * (1 - a) + c[1] * a; px[i + 2] = px[i + 2] * (1 - a) + c[2] * a;
  };
  const cap = (ax, ay, bx, by, r, c, a) => {
    const x0 = Math.floor((Math.min(ax, bx) - r) * S), x1 = Math.ceil((Math.max(ax, bx) + r) * S);
    const y0 = Math.floor((Math.min(ay, by) - r) * S), y1 = Math.ceil((Math.max(ay, by) + r) * S);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const q = G.Physics.closest(x / S, y / S, ax, ay, bx, by);
      if (Math.hypot(x / S - q.x, y / S - q.y) <= r) put(x, y, c, a);
    }
  };
  const ring = (cx, cy, r, c) => {
    for (let k = 0; k < 64; k++) { const a = (k / 64) * Math.PI * 2; put(Math.round((cx + Math.cos(a) * r) * S), Math.round((cy + Math.sin(a) * r) * S), c); }
  };
  const grey = [200, 196, 185], green = [90, 220, 120], orange = [240, 150, 60], red = [230, 90, 80], blue = [110, 160, 255];
  for (const e of table.elements) {
    const c = e.type === "bumper" ? red : e.type === "target" ? blue : e.type === "drop" ? [150, 120, 255] : e.type === "gate" ? [220, 200, 90] : grey;
    if (e.pts && e.type === "wall") for (let i = 0; i + 1 < e.pts.length; i++) cap(...e.pts[i], ...e.pts[i + 1], e.r, c, 1);
    if (e.type === "sling") for (let i = 0; i < 3; i++) cap(...e.pts[i], ...e.pts[(i + 1) % 3], 3, i === 0 ? [255, 120, 120] : grey, 1);
    if (e.type === "post" || e.type === "bumper") cap(e.x, e.y, e.x, e.y, e.r, c, 1);
    if (e.type === "target" || e.type === "drop" || e.type === "gate") cap(...e.a, ...e.b, e.r, c, 1);
    if (e.type === "rollover" || e.type === "kickback" || e.type === "saucer") ring(e.x, e.y, e.r, green);
    if (e.type === "spinner" || e.type === "orbit") cap(...e.a, ...e.b, 1, green, 1);
    if (e.type === "ramp") { cap(...e.mouth[0], ...e.mouth[1], 1.2, green, 1); for (let i = 0; i + 1 < e.path.length; i++) cap(...e.path[i], ...e.path[i + 1], 1.5, orange, 0.7); }
    if (e.type === "field") { const [x0, y0, x1, y1] = e.rect; for (let y = y0; y < y1; y += 6) cap(x0, y, x1, y, 0.5, [80, 200, 230], 0.5); }
    if (e.type === "arm") { cap(e.x, e.y, e.x + Math.cos(e.a0) * e.len, e.y + Math.sin(e.a0) * e.len, e.r, [255, 210, 120], 1); }
    if (e.type === "toy") ring(e.x, e.y, Math.min(e.w, e.h) / 2, [200, 120, 220]);
  }
  for (const f of table.flippers) {
    const tx = f.x + Math.cos(f.rest) * f.len, ty = f.y + Math.sin(f.rest) * f.len;
    for (let k = 0; k <= 20; k++) { const u = k / 20; cap(f.x + (tx - f.x) * u, f.y + (ty - f.y) * u, f.x + (tx - f.x) * u, f.y + (ty - f.y) * u, f.r0 + (f.r1 - f.r0) * u, [250, 235, 200], 1); }
  }
  for (const [x, y, c] of opts.trail || []) cap(x, y, x, y, 1.3, c || [80, 240, 255], 0.8);
  for (const [x, y] of opts.dots || []) ring(x, y, 9, [255, 255, 255]);
  return encodePNG(W, H, px);
}

if (require.main === module) {
  const id = process.argv[2] || "castle";
  const t = G.TABLES.find((x) => x.id === id);
  const out = process.argv[3] || path.join(__dirname, "..", "..", "scratch-" + id + ".png");
  fs.writeFileSync(out, raster(t, { scale: 1 }));
  console.log("wrote", out);
}
module.exports = { raster };
