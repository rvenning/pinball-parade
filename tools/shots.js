// Capture the portrait screenshot set with headless Edge over the DevTools
// protocol (true mobile emulation: 390×844 CSS px, DPR 2, touch).
//   node tools/shots.js [baseUrl]        (default http://localhost:8133/)
// Writes docs/screenshots/*.png. Uses a throwaway browser profile and the
// ?shot= director (js/shots.js), which never saves progress.
//
// (Plain `msedge --screenshot` cannot do this on Windows: the window has a
// ~500px minimum width, so a 390px capture comes back cropped off-centre.)
const fs = require("node:fs");
const path = require("node:path");
const { launch, wait } = require("./cdp.js");

const BASE = process.argv[2] || "http://localhost:8133/";
const OUT = path.join(__dirname, "..", "docs", "screenshots");
const TABLES = ["castle", "temple", "sea", "workshop", "clouds"];
const SHOTS = [
  ["splash", "shot=splash"],
  ["book-worlds", "shot=book"],
  ["world-chapters", "shot=world&w=0"],
  ["chapter-card", "shot=chapter&c=1"],
  ["results", "shot=results"],
  ["results-continued", "shot=results&lost=1"],
  // each world mid-story, its signature mechanism at work
  ["story-castle-dragon", "shot=play-castle&n=3&phase=2&sec=8"],
  ["story-temple-stairs", "shot=play-temple&n=2&phase=1&sec=8"],
  ["story-sea-whirlpool", "shot=play-sea&n=2&phase=2&sec=8"],
  ["story-workshop-clock", "shot=play-workshop&n=2&phase=1&sec=8"],
  ["story-clouds-drift", "shot=play-clouds&n=3&phase=1&sec=8"],
  ...TABLES.map((t) => [`table-${t}-empty`, `shot=${t}&hide=ball,fx,hud`]),
  ...TABLES.map((t) => [`table-${t}-play`, `shot=play-${t}`]),
  // registration aids for the art pass
  ...TABLES.map((t) => [`layers-${t}-base`, `shot=${t}&layers=bg,scenery`]),
  ...TABLES.map((t) => [`layers-${t}-mechanisms`, `shot=${t}&layers=rails,mech`]),
];

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const { send, evaluate, close } = await launch();
  const only = process.env.SHOTS ? process.env.SHOTS.split(",") : null;
  for (const [name, query] of SHOTS) {
    if (only && !only.includes(name)) continue;
    await send("Page.navigate", { url: `${BASE}index.html?${query}` });
    let ready = false;
    for (let i = 0; i < 60 && !ready; i++) {
      await wait(150);
      ready = (await evaluate("!!(document.body && document.body.dataset.shotReady === '1' && document.fonts.status === 'loaded')")) === true;
    }
    await wait(400);   // let a couple of frames draw
    const shot = await send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path.join(OUT, name + ".png"), Buffer.from(shot.result.data, "base64"));
    console.log(ready ? "  ✓" : "  ? (not ready)", name);
  }
  await close();
}
main().catch((e) => { console.error(e); process.exit(1); });
