// Sounds, layered on gamekit's synth. Everything is generated — nothing to
// load, nothing copyrighted, works offline.
//
// The palette is a toy theatre: wooden knocks, brass bells, a little march.
// Two rules. Pitch varies with what was hit and how often, so a run of
// bumpers climbs rather than repeating. And losing a ball is a soft falling
// "oh well" — never a buzzer.

const Sfx = GK.Sfx;
const PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21];
const note = (base, step) => base * Math.pow(2, PENTA[Math.max(0, Math.min(PENTA.length - 1, step))] / 12);

Object.assign(Sfx, {
  flip() { this.noise({ dur: 0.025, vol: 0.05 }); this.tone({ freq: 140, type: "square", dur: 0.03, vol: 0.04 }); },

  // Each bumper look has its own voice; the chain climbs the scale.
  bumper(look, chain) {
    const step = chain % 8;
    if (look === "bell") {
      const f = note(660, step);
      this.tone({ freq: f, type: "sine", dur: 0.35, vol: 0.12 });
      this.tone({ freq: f * 2.76, type: "sine", dur: 0.18, vol: 0.03 });
    } else if (look === "gear") {
      this.tone({ freq: note(330, step), type: "square", dur: 0.06, vol: 0.07 });
      this.noise({ dur: 0.03, vol: 0.05 });
    } else if (look === "shell" || look === "cloud") {
      this.tone({ freq: note(440, step), type: "sine", dur: 0.2, vol: 0.12, slide: 60 });
    } else {
      this.tone({ freq: note(392, step), type: "triangle", dur: 0.14, vol: 0.13 });
    }
  },
  sling() { this.tone({ freq: 250, type: "triangle", dur: 0.06, vol: 0.09, slide: 90 }); },
  target() { this.tone({ freq: 880, type: "triangle", dur: 0.09, vol: 0.1 }); this.tone({ freq: 1320, type: "sine", dur: 0.08, vol: 0.05, when: 0.04 }); },
  drop() { this.tone({ freq: 220, type: "square", dur: 0.08, vol: 0.08, slide: -80 }); this.noise({ dur: 0.05, vol: 0.06 }); },
  wrong() { this.tone({ freq: 300, type: "sine", dur: 0.08, vol: 0.06 }); },
  rollover(first) { this.tone({ freq: first ? 1046 : 784, type: "sine", dur: 0.09, vol: 0.09 }); },
  spin(turns) { for (let i = 0; i < Math.min(turns, 5); i++) this.tone({ freq: 1200 + i * 60, type: "square", dur: 0.02, vol: 0.03, when: i * 0.05 }); },
  thud(v) { this.tone({ freq: 110, type: "sine", dur: 0.05, vol: Math.min(0.08, v / 12000) }); },
  launch(p) { this.noise({ dur: 0.12, vol: 0.08 }); this.tone({ freq: 180 + p * 220, type: "sawtooth", dur: 0.18, vol: 0.05, slide: 300 }); },
  kickback() { this.tone({ freq: 160, type: "square", dur: 0.12, vol: 0.1, slide: 420 }); },
  rampUp() { [0, 2, 4, 5].forEach((s, i) => this.tone({ freq: note(392, s), type: "triangle", dur: 0.09, vol: 0.08, when: i * 0.06 })); },
  rampDone() { [4, 5, 7].forEach((s, i) => this.tone({ freq: note(523, s), type: "triangle", dur: 0.14, vol: 0.12, when: i * 0.07 })); },
  saucer() { this.tone({ freq: 196, type: "sine", dur: 0.25, vol: 0.12, slide: -40 }); },
  lock() { this.tone({ freq: 294, type: "square", dur: 0.1, vol: 0.09 }); this.tone({ freq: 392, type: "square", dur: 0.16, vol: 0.09, when: 0.1 }); },
  saved() { [9, 7, 9, 12].forEach((s, i) => this.tone({ freq: note(523, Math.min(9, s)), type: "sine", dur: 0.12, vol: 0.07, when: i * 0.06 })); },
  // Losing a ball: two soft falling notes. Warm, over quickly.
  ballLost() {
    this.tone({ freq: 392, type: "sine", dur: 0.22, vol: 0.09, slide: -60 });
    this.tone({ freq: 294, type: "sine", dur: 0.3, vol: 0.08, when: 0.18, slide: -40 });
  },

  // A march: the parade starting. Snare-ish noise under a rising brass line.
  parade() {
    const line = [0, 0, 2, 4, 4, 7];
    line.forEach((s, i) => {
      this.tone({ freq: note(392, s), type: "square", dur: 0.11, vol: 0.08, when: i * 0.13 });
      this.noise({ dur: 0.04, vol: 0.05, when: i * 0.13 });
    });
    this.tone({ freq: note(392, 5) * 2, type: "triangle", dur: 0.4, vol: 0.1, when: 0.8 });
  },
  paradeEnd() { this.tone({ freq: 523, type: "triangle", dur: 0.2, vol: 0.07, slide: -120 }); },
  objective() { [0, 4, 7, 12].forEach((s, i) => this.tone({ freq: 523 * Math.pow(2, s / 12), type: "triangle", dur: 0.2, vol: 0.13, when: i * 0.09 })); },
  multiball() { for (let i = 0; i < 8; i++) this.tone({ freq: note(330, i), type: "square", dur: 0.08, vol: 0.08, when: i * 0.07 }); },
  chapterWon() {
    [0, 4, 7, 12, 7, 12, 16].forEach((s, i) => this.tone({ freq: 392 * Math.pow(2, s / 12), type: "triangle", dur: 0.22, vol: 0.14, when: i * 0.12 }));
  },
  star(n) { this.tone({ freq: 660 + n * 220, type: "triangle", dur: 0.22, vol: 0.18, slide: 160 }); },
});
