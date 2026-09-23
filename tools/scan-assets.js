// Scan assets/ and write assets/available.json — the list of illustrated
// files the game is allowed to request. A file is listed only if its name is
// one the renderer knows (js/assets.js ASSET_SPECS) and its PNG header has
// exactly the required size; anything else is reported and left out, so a
// wrong-sized or misnamed image can never reach a player.
//   node tools/scan-assets.js
const fs = require("node:fs");
const path = require("node:path");
const { ASSET_SPECS } = require("../js/assets.js");

const ROOT = path.join(__dirname, "..");
const listed = [], problems = [];

function pngSize(file) {
  const b = fs.readFileSync(file);
  if (b.length < 24 || b.toString("ascii", 1, 4) !== "PNG") return null;
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), colorType: b[25] };
}

for (const spec of ASSET_SPECS) {
  const abs = path.join(ROOT, spec.file);
  if (!fs.existsSync(abs)) continue;
  const d = pngSize(abs);
  if (!d) { problems.push(`${spec.file}: not a PNG`); continue; }
  if (d.w !== spec.w || d.h !== spec.h) { problems.push(`${spec.file}: ${d.w}×${d.h}, needs ${spec.w}×${spec.h}`); continue; }
  if (spec.alpha && d.colorType !== 6 && d.colorType !== 4) problems.push(`${spec.file}: should have an alpha channel (listed anyway)`);
  listed.push(spec.file);
}

// Files sitting in assets/ that the game will never use.
const known = new Set(ASSET_SPECS.map((s) => s.file));
for (const dir of ["logo", "world-cards", "table-backgrounds", "table-foregrounds", "characters", "ui"]) {
  const d = path.join(ROOT, "assets", dir);
  if (!fs.existsSync(d)) continue;
  for (const f of fs.readdirSync(d)) {
    const rel = `assets/${dir}/${f}`;
    if (f.endsWith(".png") && !known.has(rel)) problems.push(`${rel}: unknown name, ignored`);
  }
}

fs.writeFileSync(path.join(ROOT, "assets", "available.json"), JSON.stringify({ files: listed }, null, 2) + "\n");
console.log(`assets/available.json: ${listed.length} file(s) listed`);
for (const p of problems) console.log("  !", p);
