// Persistence — gamekit storage configured for Pinball Parade.
// pbp_* localStorage keys, "pinballparade" Firestore collection.
//
// Everything saved is monotonic, so the cross-device merge is "keep the
// better of each": more stars on a chapter, a higher best score, a later
// daily, bigger lifetime counters. There is no currency and nothing is ever
// spent, so max() can never resurrect anything.
//
// The daily pair (date, score) moves together — a score belongs to its date.
// blank/merge are named so tests/storage.test.js can call the merge, which is
// the one function here that could destroy a save.

const STAT_KEYS = ["games", "balls", "bumpers", "ramps", "locks", "multiballs", "parades", "saves", "seconds"];

const PROGRESS = {
  blank: () => ({
    chapters: {},        // { [idx]: { stars, best } } — best result per chapter
    tables: {},          // { [tableId]: best free-play score }
    worldsOpen: 1,       // highest world unlocked (derived, stored for the roster line)
    dailyDate: "", dailyScore: 0, dailyDone: 0,
    stats: {},           // lifetime counters, STAT_KEYS
    // Pacing from REAL play: seconds and games spent on a chapter up to its
    // first clear (paceRun while still trying, pace once told). Write-once.
    pace: {}, paceRun: {},
    // Where an unfinished story can be picked up: { idx, phase, score, bonus, at }.
    resume: null,
    updated: 0,
  }),

  merge: (a, b) => {
    const chapters = { ...(a.chapters || {}) };
    for (const [k, r] of Object.entries(b.chapters || {})) {
      const c = chapters[k];
      chapters[k] = c ? { stars: Math.max(c.stars || 0, r.stars || 0), best: Math.max(c.best || 0, r.best || 0) } : r;
    }
    const tables = { ...(a.tables || {}) };
    for (const [k, v] of Object.entries(b.tables || {})) tables[k] = Math.max(tables[k] || 0, v || 0);
    const stats = { ...(a.stats || {}) };
    for (const [k, v] of Object.entries(b.stats || {})) stats[k] = Math.max(stats[k] || 0, v || 0);
    const da = a.dailyDate || "", db = b.dailyDate || "";
    const day = db > da ? b : da > db ? a : ((b.dailyScore || 0) > (a.dailyScore || 0) ? b : a);
    // a first-clear time is written once: whichever device recorded it first keeps it
    const pace = { ...(b.pace || {}), ...(a.pace || {}) };
    const paceRun = { ...(a.paceRun || {}) };
    for (const [k, v] of Object.entries(b.paceRun || {})) if (!paceRun[k] || (v.secs || 0) > (paceRun[k].secs || 0)) paceRun[k] = v;
    for (const k of Object.keys(pace)) delete paceRun[k];
    const ra = a.resume, rb = b.resume;
    const resume = !ra ? rb || null : !rb ? ra : ((rb.at || 0) > (ra.at || 0) ? rb : ra);
    return {
      ...a, ...b,
      chapters, tables, stats, pace, paceRun, resume,
      worldsOpen: Math.max(a.worldsOpen || 1, b.worldsOpen || 1),
      dailyDate: day.dailyDate || "", dailyScore: day.dailyScore || 0,
      dailyDone: Math.max(a.dailyDone || 0, b.dailyDone || 0),
      updated: Math.max(a.updated || 0, b.updated || 0),
    };
  },
};

// Pure progression rules, shared by the menus and the tests.
const Progress = {
  totalStars(p) { return Object.values(p.chapters || {}).reduce((s, r) => s + (r.stars || 0), 0); },
  cleared(p, idx) { return !!(p.chapters && p.chapters[idx] && p.chapters[idx].stars > 0); },
  worldOpen(p, w) {
    if (w === 0) return true;
    const lastOfPrev = CHAPTERS.filter((c) => c.world === w - 1).pop().idx;
    return this.cleared(p, lastOfPrev) && this.totalStars(p) >= WORLDS[w].stars;
  },
  chapterOpen(p, idx) {
    const c = CHAPTERS[idx];
    if (!this.worldOpen(p, c.world)) return false;
    return c.n === 1 || this.cleared(p, idx - 1);
  },
  nextChapter(p) {
    for (const c of CHAPTERS) if (this.chapterOpen(p, c.idx) && !this.cleared(p, c.idx)) return c.idx;
    return null;
  },
  worldsOpen(p) { let n = 0; for (let w = 0; w < WORLDS.length; w++) if (this.worldOpen(p, w)) n = w + 1; return n; },
  // Why is this world shut? One short sentence, never a wall of rules.
  worldNeeds(p, w) {
    const lastOfPrev = CHAPTERS.filter((c) => c.world === w - 1).pop();
    if (!this.cleared(p, lastOfPrev.idx)) return `Finish ${WORLDS[w - 1].name} first`;
    const need = WORLDS[w].stars - this.totalStars(p);
    return need > 0 ? `${need} more star${need === 1 ? "" : "s"} to open` : "";
  },
  freeTotal(p) { return Object.values(p.tables || {}).reduce((s, v) => s + (v || 0), 0); },

  // A checkpoint for this chapter, if the last game on it stopped part-way.
  resumeFor(p, idx) {
    const r = p.resume;
    return r && r.idx === idx && r.phase > 0 ? r : null;
  },

  // Fold one finished game into a progress object (returns it). Only a game
  // whose story is told records a chapter; lifetime counters always count.
  record(p, cfg, res, now) {
    p.chapters = p.chapters || {}; p.tables = p.tables || {}; p.stats = p.stats || {};
    p.pace = p.pace || {}; p.paceRun = p.paceRun || {};
    if (cfg.mode === "chapter") {
      const k = cfg.idx;
      if (!p.pace[k]) {
        const run = p.paceRun[k] || { secs: 0, games: 0 };
        run.secs += res.seconds || 0; run.games += 1;
        if (res.told) { p.pace[k] = run; delete p.paceRun[k]; } else p.paceRun[k] = run;
      }
      const at = now || Date.now();
      p.resume = !res.told && res.checkpoint && res.checkpoint.phase > 0 ? Object.assign({ idx: k, at }, res.checkpoint) : (p.resume && p.resume.idx !== k ? p.resume : { idx: -1, at });
    }
    if (cfg.mode === "free") p.tables[cfg.table] = Math.max(p.tables[cfg.table] || 0, res.score);
    else if (cfg.mode === "daily") {
      if (p.dailyDate !== cfg.date) { p.dailyDate = cfg.date; p.dailyScore = 0; p.dailyDone = (p.dailyDone || 0) + 1; }
      p.dailyScore = Math.max(p.dailyScore || 0, res.score);
    } else if (res.stars > 0) {
      const cur = p.chapters[cfg.idx] || { stars: 0, best: 0 };
      p.chapters[cfg.idx] = { stars: Math.max(cur.stars, res.stars), best: Math.max(cur.best, res.score) };
    } else if (p.chapters[cfg.idx]) {
      p.chapters[cfg.idx].best = Math.max(p.chapters[cfg.idx].best || 0, res.score);
    }
    const s = res.stats || {};
    const add = { games: 1, balls: s.launches || 0, bumpers: s.bumpers || 0, ramps: s.ramps || 0, locks: s.locks || 0, multiballs: s.multiballs || 0, parades: s.parades || 0, saves: s.saves || 0, seconds: res.seconds || 0 };
    for (const k of STAT_KEYS) p.stats[k] = (p.stats[k] || 0) + (add[k] || 0);
    p.worldsOpen = Math.max(p.worldsOpen || 1, this.worldsOpen(p));
    return p;
  },
};

const Storage = GK.createStorage({
  prefix: "pbp",
  collection: "pinballparade",
  firebaseConfig: window.FIREBASE_CONFIG,
  blankProgress: PROGRESS.blank,
  mergeProgress: PROGRESS.merge,
});
