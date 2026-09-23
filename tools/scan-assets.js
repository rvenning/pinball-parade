// Scan assets/ and write assets/available.json — the list of illustrated
// files the game is allowed to request. A file is listed only if its name is
// one the renderer knows (js/assets.js ASSET_SPECS) and its PNG or JPEG
// header has exactly the required size; anything else is reported and left out, so a
// wrong-sized or misnamed image can never reach a player.
//   node tools/scan-assets.js
const fs = require("node:fs");
const path = require("node:path");
const { ASSET_SPECS } = require("../js/assets.js");

const ROOT = path.join(__dirname, "..");
const listed = [], problems = [];

function pngSize(b) {
  if (b.length < 24 || b.toString("ascii", 1, 4) !== "PNG") return null;
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), colorType: b[25] };
}

// Walk the JPEG markers to the frame header (any SOFn except DHT/JPG/DAC).
function jpegSize(b) {
  if (b[0] !== 0xff || b[1] !== 0xd8) return null;
  for (let p = 2; p + 9 < b.length; ) {
    if (b[p] !== 0xff) { p++; continue; }
    const m = b[p + 1];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { w: b.readUInt16BE(p + 7), h: b.readUInt16BE(p + 5) };
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { p += 2; continue; }
    p += 2 + b.readUInt16BE(p + 2);
  }
  return null;
}

for (const spec of ASSET_SPECS) {
  const abs = path.join(ROOT, spec.file);
  if (!fs.existsSync(abs)) continue;
  const buf = fs.readFileSync(abs), jpg = spec.file.endsWith(".jpg");
  const d = jpg ? jpegSize(buf) : pngSize(buf);
  if (!d) { problems.push(`${spec.file}: not a ${jpg ? "JPEG" : "PNG"}`); continue; }
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
    if (/\.(png|jpe?g|webp)$/i.test(f) && !known.has(rel)) problems.push(`${rel}: unknown name, ignored`);
  }
}

fs.writeFileSync(path.join(ROOT, "assets", "available.json"), JSON.stringify({ files: listed }, null, 2) + "\n");
console.log(`assets/available.json: ${listed.length} file(s) listed`);
for (const p of problems) console.log("  !", p);
