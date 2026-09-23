// Export each table's geometry for the illustration pass:
//   docs/geometry/<id>.json  every element, in logical 400×720 coordinates
//   docs/geometry/<id>.svg   an 800×1440 registration overlay (2× logical):
//                            the safe gameplay region, every solid rail and
//                            mechanism, sensors dashed, ramps as centre lines.
// Run after any change to js/tables.js:  node tools/export-geometry.js
const fs = require("node:fs");
const path = require("node:path");
const G = require("../tests/load.js");

const OUT = path.join(__dirname, "..", "docs", "geometry");
fs.mkdirSync(OUT, { recursive: true });
const K = 2;   // art is authored at 2× the logical table
const P = (pts) => pts.map(([x, y]) => `${(x * K).toFixed(1)},${(y * K).toFixed(1)}`).join(" ");

for (const t of G.TABLES) {
  const els = t.elements.map((e) => { const c = Object.assign({}, e); delete c._seg; delete c._len; return c; });
  fs.writeFileSync(path.join(OUT, t.id + ".json"), JSON.stringify({ id: t.id, name: t.name, logical: { w: 400, h: 720 }, ballRadius: G.PHYS.BALL_R, flippers: t.flippers, plunger: t.plunger, elements: els }, null, 1) + "\n");

  const shell = t.byId.shell.pts;
  const s = [];
  s.push(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1440" viewBox="0 0 800 1440">`);
  s.push(`<title>${t.name} — registration overlay (2× logical). Safe region in green; solids in red; sensors dashed blue; ramps orange.</title>`);
  s.push(`<polygon points="${P([[shell[0][0], 720], ...shell, [shell[shell.length - 1][0], 720]])}" fill="rgba(60,200,120,0.12)" stroke="#3c8" stroke-width="2"/>`);
  const line = (pts, w, col, dash) => s.push(`<polyline points="${P(pts)}" fill="none" stroke="${col}" stroke-width="${w * K}" stroke-linecap="round" stroke-linejoin="round"${dash ? ` stroke-dasharray="6 6"` : ""} opacity="0.85"/>`);
  const circle = (x, y, r, col, dash) => s.push(`<circle cx="${x * K}" cy="${y * K}" r="${r * K}" fill="none" stroke="${col}" stroke-width="3"${dash ? ` stroke-dasharray="6 6"` : ""}/>`);
  for (const e of t.elements) {
    switch (e.type) {
      case "wall": line(e.pts, e.r * 2, "#e33"); break;
      case "sling": line([...e.pts, e.pts[0]], 6, "#e33"); break;
      case "post": case "bumper": circle(e.x, e.y, e.r, "#e33"); break;
      case "target": case "drop": case "gate": line([e.a, e.b], (e.r || 3) * 2, e.type === "gate" ? "#ea3" : "#e33"); break;
      case "rollover": case "kickback": case "saucer": circle(e.x, e.y, e.r, "#39f", true); break;
      case "spinner": case "orbit": line([e.a, e.b], 1.5, "#39f", true); break;
      case "ramp": line(e.path, 20, "rgba(255,150,40,0.35)"); line(e.mouth, 1.5, "#39f", true); break;
      case "field": { const [x0, y0, x1, y1] = e.rect; s.push(`<rect x="${x0 * K}" y="${y0 * K}" width="${(x1 - x0) * K}" height="${(y1 - y0) * K}" fill="rgba(80,200,255,0.12)" stroke="#39f" stroke-dasharray="6 6"/>`); break; }
      case "arm": circle(e.x, e.y, e.len + e.r, "#ea3", true); break;
      case "toy": s.push(`<rect x="${(e.x - e.w / 2) * K}" y="${(e.y - e.h / 2) * K}" width="${e.w * K}" height="${e.h * K}" fill="rgba(200,120,255,0.12)" stroke="#a6f" stroke-dasharray="4 4"/>`); break;
    }
  }
  for (const f of t.flippers) {
    for (const ang of [f.rest, f.up]) line([[f.x, f.y], [f.x + Math.cos(ang) * f.len, f.y + Math.sin(ang) * f.len]], f.r0 * 2, ang === f.rest ? "#e33" : "rgba(238,51,51,0.4)");
  }
  s.push(`</svg>`);
  fs.writeFileSync(path.join(OUT, t.id + ".svg"), s.join("\n") + "\n");
  console.log("wrote", t.id);
}
