// Generate icons/ — a brass-arched midnight table, two cream flippers with
// coral rubbers, a coral bumper and the ivory ball with its cyan glint.
// Run: node tools/make-icons.js  (from the pinball-parade folder)
const fs = require("fs");
const path = require("path");
const { makeCanvas, downsample, encodePNG } = require("../lib/tools/png.js");

const OUT = path.join(__dirname, "..", "icons");
fs.mkdirSync(OUT, { recursive: true });

function paint(size, pad) {
  const SS = 4, big = size * SS;
  const cv = makeCanvas(big);
  const u = big / 100;
  const s = pad ? 0.74 : 1;
  const at = (v) => 50 * u + (v - 50) * u * s;
  const sz = (v) => v * u * s;

  cv.fillRect(0, 0, big, big, "#121c3a");
  for (let y = 0; y < 100; y += 9) cv.fillRect(0, y * u, big, 2.5 * u, "#1c2a52", 0.6);

  // the table: an arch of brass, midnight felt inside
  cv.fillRoundRect(at(14), at(10), sz(72), sz(84), sz(34), "#c9973c");
  cv.fillRoundRect(at(18), at(14), sz(64), sz(80), sz(30), "#223463");

  // bumper
  cv.fillCircle(at(50), at(38), sz(12), "#c9973c");
  cv.fillCircle(at(50), at(38), sz(9.5), "#d9534a");
  cv.fillCircle(at(47), at(35), sz(3.5), "#f08c6a");

  // flippers: tapered, cream on coral
  const flipper = (px, py, tx, ty, dir) => {
    for (const [col, g] of [["#e0604f", 0], ["#f6ecd6", 1.6]]) {
      const r0 = sz(6.2 - g), r1 = sz(3.8 - g);
      cv.fillCircle(at(px), at(py), r0, col);
      cv.fillCircle(at(tx), at(ty), r1, col);
      cv.fillTriangle(at(px), at(py) - r0, at(px), at(py) + r0, at(tx), at(ty), col);
      cv.fillTriangle(at(px), at(py) - r0 * 0.9, at(tx), at(ty) - r1, at(tx), at(ty) + r1, col);
    }
  };
  flipper(30, 76, 45, 83, 1);
  flipper(70, 76, 55, 83, -1);

  // the ball, bright and always readable
  cv.fillCircle(at(58), at(58), sz(8.5), "#8f97a6");
  cv.fillCircle(at(57), at(57), sz(7.6), "#f3eee2");
  cv.fillCircle(at(55), at(55), sz(3.6), "#ffffff");
  cv.fillCircle(at(61), at(61), sz(2), "#9ff4ff");

  return encodePNG(size, size, downsample(cv.px, big, SS));
}

fs.writeFileSync(path.join(OUT, "icon-192.png"), paint(192, false));
fs.writeFileSync(path.join(OUT, "icon-512.png"), paint(512, false));
fs.writeFileSync(path.join(OUT, "maskable-512.png"), paint(512, true));
console.log("icons written to", OUT);
