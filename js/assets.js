// Optional illustrated assets, with procedural fallbacks.
//
// The game is fully playable with an empty assets/ folder. An art pass drops
// PNGs into assets/<folder>/ with exactly the names below, then runs
// `node tools/scan-assets.js`, which writes assets/available.json listing the
// files that are present and correctly sized. Only listed files are
// requested, so a missing image costs nothing — no 404s, no broken frames —
// and a failed load simply leaves the procedural drawing in place.
//
// Nothing here can change gameplay: images are decoration registered to the
// logical 400×720 table, and every collision-critical piece (rails, flippers,
// bumpers, targets, gates, ramps, the ball, objective lights) stays drawn by
// code from js/tables.js. See assets/ART-BRIEF.md.

const ART_TABLES = ["castle", "temple", "sea", "workshop", "clouds"];
const ART_CHARACTERS = ["dragon", "automaton", "mascot"];

// Every file the renderer knows how to use, with its required pixel size and
// whether it may be transparent. The ART-BRIEF test checks the brief lists
// each one.
const ASSET_SPECS = [
  { file: "assets/logo/logo.png", w: 1200, h: 600, alpha: true, use: "splash title" },
  ...ART_TABLES.map((t) => ({ file: `assets/world-cards/${t}.png`, w: 720, h: 480, alpha: false, use: "world card in the book" })),
  ...ART_TABLES.map((t) => ({ file: `assets/table-backgrounds/${t}.png`, w: 800, h: 1440, alpha: false, use: "layer 1+2: base material and scenery under the playfield" })),
  ...ART_TABLES.map((t) => ({ file: `assets/table-foregrounds/${t}.png`, w: 800, h: 1440, alpha: true, use: "layer 6: frame/occlusion over everything outside the safe region" })),
  { file: "assets/characters/dragon.png", w: 240, h: 140, alpha: true, use: "castle toy, asleep" },
  { file: "assets/characters/dragon-awake.png", w: 240, h: 140, alpha: true, use: "castle toy, awake" },
  { file: "assets/characters/automaton.png", w: 80, h: 120, alpha: true, use: "workshop toy, run down" },
  { file: "assets/characters/automaton-awake.png", w: 80, h: 120, alpha: true, use: "workshop toy, marching" },
  { file: "assets/characters/mascot.png", w: 400, h: 400, alpha: true, use: "splash mascot" },
  { file: "assets/ui/paper.png", w: 512, h: 512, alpha: false, use: "tileable paper texture behind menus" },
];

const Assets = {
  imgs: {},
  listeners: [],
  loaded: false,

  init(base = "") {
    const done = () => { this.loaded = true; this.emit(); };
    if (typeof fetch !== "function") return done();
    fetch(base + "assets/available.json", { cache: "no-cache" })
      .then((r) => (r.ok ? r.json() : { files: [] }))
      .catch(() => ({ files: [] }))
      .then((j) => {
        const known = new Set(ASSET_SPECS.map((s) => s.file));
        const files = (j.files || []).filter((f) => known.has(f));
        if (!files.length) return done();
        let left = files.length;
        for (const f of files) {
          const img = new Image();
          img.onload = () => { if (img.naturalWidth > 0) this.imgs[f] = img; if (--left === 0) done(); else this.emit(); };
          img.onerror = () => { if (--left === 0) done(); };
          img.src = base + f;
        }
      });
  },

  // An image that has finished loading, or null — callers draw their
  // procedural fallback on null.
  get(file) { return this.imgs[file] || null; },
  background(id) { return this.get(`assets/table-backgrounds/${id}.png`); },
  foreground(id) { return this.get(`assets/table-foregrounds/${id}.png`); },
  worldCard(id) { return this.get(`assets/world-cards/${id}.png`); },
  character(look, awake) { return (awake && this.get(`assets/characters/${look}-awake.png`)) || this.get(`assets/characters/${look}.png`); },

  onChange(fn) { this.listeners.push(fn); },
  emit() { for (const fn of this.listeners) { try { fn(); } catch (e) { console.warn(e); } } },
};

if (typeof module !== "undefined") module.exports = { ASSET_SPECS, ART_TABLES, ART_CHARACTERS };
