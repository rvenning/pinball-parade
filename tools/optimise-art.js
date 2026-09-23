// Make the web-weight derivatives of the illustrated art, using headless
// Edge's own resampler and encoders (no image dependencies).
//   node tools/optimise-art.js [artSourceDir]
//     artSourceDir defaults to ../pinball-parade-art-source (read only).
//
//   world cards   assets/world-cards/<id>.png (or the source)  -> <id>.jpg  720×480, q 0.84
//   mascots       <src>/mascot-<name>.png                       -> assets/characters/mascot-<table>.png 400×400
//
// Opaque art goes to JPEG (a painted 720×480 card is ~1 MB as PNG and ~80 KB
// as JPEG); anything that needs transparency stays PNG. Then run
// `node tools/scan-assets.js` to refresh assets/available.json.
const fs = require("node:fs");
const path = require("node:path");
const { launch } = require("./cdp.js");

const ROOT = path.join(__dirname, "..");
const SRC = path.resolve(process.argv[2] || path.join(ROOT, "..", "pinball-parade-art-source"));
const MASCOTS = {
  castle: "mascot-moonlight-dragon.png", temple: "mascot-jungle-idol.png", sea: "mascot-deep-sea-puffer.png",
  workshop: "mascot-clockwork-automaton.png", clouds: "mascot-cloud-dragon.png",
};
const TABLES = Object.keys(MASCOTS);
const dataUrl = (f) => "data:image/png;base64," + fs.readFileSync(f).toString("base64");

(async () => {
  const b = await launch({ width: 800, height: 600, dpr: 1 });
  await b.send("Page.navigate", { url: "about:blank" });
  // Draw at the target size with the browser's high-quality smoothing, then
  // encode. `cover` crops to fill; `contain` fits and keeps transparency.
  const encode = (src, w, h, type, quality, fit) => b.evaluate(`(async () => {
    const img = new Image(); img.src = ${JSON.stringify(src)}; await img.decode();
    const c = document.createElement("canvas"); c.width = ${w}; c.height = ${h};
    const x = c.getContext("2d"); x.imageSmoothingEnabled = true; x.imageSmoothingQuality = "high";
    const k = Math.${fit === "cover" ? "max" : "min"}(${w} / img.naturalWidth, ${h} / img.naturalHeight);
    const dw = img.naturalWidth * k, dh = img.naturalHeight * k;
    x.drawImage(img, (${w} - dw) / 2, (${h} - dh) / 2, dw, dh);
    return c.toDataURL(${JSON.stringify(type)}, ${quality});
  })()`);
  const save = (url, out) => { fs.writeFileSync(out, Buffer.from(url.split(",")[1], "base64")); return fs.statSync(out).size; };

  for (const t of TABLES) {
    // Prefer the 720×480 crop already chosen for the game; fall back to the source.
    const crop = path.join(ROOT, "assets", "world-cards", t + ".png");
    const srcName = { castle: "moonlight-castle", temple: "jungle-temple", sea: "deep-sea", workshop: "clockwork-workshop", clouds: "cloud-kingdom" }[t];
    const from = fs.existsSync(crop) ? crop : path.join(SRC, `world-${srcName}.png`);
    if (!fs.existsSync(from)) { console.log("  - no world card for", t); continue; }
    const kb = save(await encode(dataUrl(from), 720, 480, "image/jpeg", 0.84, "cover"), path.join(ROOT, "assets", "world-cards", t + ".jpg")) >> 10;
    console.log(`  world-cards/${t}.jpg  ${kb} KB  (from ${path.basename(from)})`);
  }
  for (const t of TABLES) {
    const from = path.join(SRC, MASCOTS[t]);
    if (!fs.existsSync(from)) { console.log("  - no mascot for", t); continue; }
    const kb = save(await encode(dataUrl(from), 400, 400, "image/png", 1, "contain"), path.join(ROOT, "assets", "characters", `mascot-${t}.png`)) >> 10;
    console.log(`  characters/mascot-${t}.png  ${kb} KB`);
  }
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
