// App shell and the play loop. Profiles, PINs, sync, install and the version
// line come from gamekit; this file decides what each screen shows and owns
// the fixed-step accumulator that turns real time into Sim.step() calls.

const AVATARS = ["🦄", "🐉", "🦊", "🐼", "🐙", "🦉", "🐸", "🐰", "🐯", "🦖", "🐧", "🐝"];

const EFFECT_WORDS = {
  "open:drawbridge": "The drawbridge is down!",
  "open:templeDoor": "The temple stairs are open!",
  "wake:dragon": "The dragon is awake!",
  "wake:idol": "The idol opens its eye!",
  "lightLock:chest": "The chest is open — lock a ball!",
  "wake:automaton": "The soldier is marching!",
  "lightLock:toybox": "The toybox is open — lock a ball!",
  "lightLock:skyCastle": "The sky castle door is open!",
};

const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const fmt = (n) => Math.round(n).toLocaleString("en-AU");
const esc = (s) => GK.util.esc(String(s));

// ------------------------------------------------------------------- play --
const Play = {
  sim: null, cfg: null, raf: 0, last: 0, acc: 0,
  paused: false, ended: false, token: 0, chipSig: "", showcase: false,
  chain: 0, chainAt: 0,

  start(cfg, opts = {}) {
    const table = TABLES.find((t) => t.id === cfg.table);
    this.cfg = cfg;
    this.sim = new Sim(table, cfg);
    this.token++;
    this.paused = false; this.ended = false; this.acc = 0; this.last = 0; this.chipSig = "";
    this.showcase = !!opts.showcase;
    if (this.showcase) this.sim.S.queue = [];
    Render.setTable(table);
    Fx.reset();
    App.buildHud(cfg, table);
    GK.UI.showScreen("game");
    Render.resize();          // the stage was 0×0 while hidden
    Input.releaseAll();
    Input.enabled = !this.showcase;
    Input.canLaunch = () => !!(this.sim && this.sim.readyBall());
    if (!this.raf) this.loop();
  },

  loop() {
    const tick = (t) => { this.raf = requestAnimationFrame(tick); this.frame(t); };
    this.raf = requestAnimationFrame(tick);
  },
  stop() { cancelAnimationFrame(this.raf); this.raf = 0; },

  // One frame. Clamped at both ends so a tab resume or a stray timestamp
  // can never jump or reverse the table; the engine itself only ever moves
  // in fixed steps.
  frame(t) {
    const sim = this.sim;
    if (!sim || GK.UI.screen !== "game") return;
    let dt = this.last ? (t - this.last) / 1000 : 0;
    this.last = t;
    if (!(dt > 0)) dt = 0;
    dt = Math.min(0.05, dt);
    GK.Debug.frame(dt);
    if (!this.paused && !this.showcase && dt > 0) {
      sim.input.left = Input.left; sim.input.right = Input.right; sim.input.launch = Input.launch;
      this.acc += dt;
      let n = 0;
      while (this.acc >= PHYS.DT && n < 40) { sim.step(); this.acc -= PHYS.DT; n++; }
      Fx.update(dt);
      this.drain();
      App.updateHud();
    }
    Render.draw(sim, this.paused ? 0 : dt);
    if (sim.S.over && !this.ended) this.end();
  },

  // Engine events become sound, light and words.
  drain() {
    const sim = this.sim, R = Render.reduced;
    const burst = (x, y, col, n) => Fx.burst(x, y, col, R ? Math.ceil(n / 3) : n, 150, 0.45, 2.2);
    for (const e of sim.events) {
      switch (e.type) {
        case "flip": Sfx.flip(); break;
        case "bumper":
          if (e.t - this.chainAt > 1.5) this.chain = 0;
          this.chain++; this.chainAt = e.t;
          Sfx.bumper(e.look, this.chain); burst(e.x, e.y, Render.art.enamel2, 10); break;
        case "sling": Sfx.sling(); burst(e.x, e.y, "#f6ecd6", 5); break;
        case "target": Sfx.target(); burst(e.x, e.y, Render.art.accent, 8); break;
        case "letter": Sfx.target(); burst(e.x, e.y, Render.art.glow, 12); App.banner(`${e.letter}!`, 700); break;
        case "wrongLetter": Sfx.wrong(); break;
        case "drop": Sfx.drop(); burst(e.x, e.y, "#b9a0ff", 8); break;
        case "bank": Sfx.rampDone(); App.banner("All down!", 1100); break;
        case "rollover": Sfx.rollover(e.first); break;
        case "lanes": Sfx.rampDone(); App.banner("All three lit!", 1100); break;
        case "spin": Sfx.spin(e.turns); break;
        case "thud": if (e.v > 700) Sfx.thud(e.v); break;
        case "launch": Sfx.launch(e.power); break;
        case "kickback": Sfx.kickback(); burst(e.x, e.y, "#e0604f", 10); break;
        case "rampEnter": Sfx.rampUp(); break;
        case "ramp": Sfx.rampDone(); burst(e.x, e.y, Render.art.glow, 14); break;
        case "saucer": Sfx.saucer(); break;
        case "orbit": Sfx.rollover(true); break;
        case "lock": Sfx.lock(); App.banner("Ball locked!", 1300); break;
        case "multiball": Sfx.multiball(); App.banner("Two-ball parade!", 1800); if (!R) Fx.addShake(6); break;
        case "saved": Sfx.saved(); App.banner("Saved! Here it comes again", 1300); break;
        case "rescue": App.banner("Unstuck!", 900); break;
        case "ballLost": Sfx.ballLost(); App.banner(e.left > 0 ? `Oh well! ${e.left} ball${e.left === 1 ? "" : "s"} left` : "That was the last ball", 1400); break;
        case "paradeStart": Sfx.parade(); App.banner("PARADE! Double points", 1800); if (!R) { Fx.addShake(4); Fx.confetti(TABLE_W, 260, ["#e0604f", "#d9a441", "#72e6f2", "#f6ecd6"], 40); } break;
        case "paradeEnd": Sfx.paradeEnd(); break;
        case "objective": {
          Sfx.objective();
          const o = this.cfg.objectives[e.idx];
          const words = (o.effect || []).map((f) => EFFECT_WORDS[f]).find(Boolean);
          App.banner(words || `${o.label} — done!`, 2000);
          if (!R) { Fx.addShake(5); Fx.addFlash(0.25, "#fff4d6"); }
          break;
        }
        case "chapterWon": Sfx.chapterWon(); if (!R) Fx.confetti(TABLE_W, TABLE_H, ["#e0604f", "#d9a441", "#72e6f2", "#f6ecd6"], 80); break;
        case "points": if (e.v >= 250 && !R) Fx.text(e.x, e.y, `+${fmt(e.v)}`, { color: "#fff4d6", size: e.v >= 1000 ? 16 : 12 }); break;
      }
    }
    sim.events.length = 0;
  },

  pause() {
    if (!this.sim || this.ended || this.paused || this.showcase) return;
    this.paused = true;
    Input.releaseAll();
    App.fillPause();
    GK.UI.openModal("modal-pause");
  },
  resume() {
    GK.UI.closeModal("modal-pause");
    this.paused = false;
    this.last = 0; this.acc = 0;     // no physics jump after a pause
  },

  end() {
    this.ended = true;
    Input.enabled = false; Input.releaseAll();
    const token = this.token, res = this.sim.result();
    setTimeout(() => { if (this.token === token) App.showResults(this.cfg, res); }, 900);
  },

  quit() {
    this.token++;
    GK.UI.closeModal("modal-pause");
    this.paused = false;
    Input.enabled = false; Input.releaseAll();
    this.sim = null;
  },
};

// -------------------------------------------------------------------- app --
const App = {
  profile: null,
  el(id) { return document.getElementById(id); },

  init() {
    Sfx.enabled = Storage.getSettings().sound !== false;
    GK.UI.onScreenChange = (name) => {
      if (name !== "game") { Input.enabled = false; Input.releaseAll(); }
      if (name === "splash") this.refreshSplash();
      document.body.classList.toggle("in-game", name === "game");
    };
    GK.UI.bindSoundToggle(Storage);
    GK.UI.bindMenuClicks();
    GK.Profiles.init({
      storage: Storage, avatars: AVATARS,
      meta: (p, prog) => `⭐ ${Progress.totalStars(prog)}/60 · 📖 world ${Math.max(1, Progress.worldsOpen(prog))}`,
      onEnter: (p) => { this.profile = p; this.showBook(); },
      addLabel: "New Player",
    });
    GK.initPWA({ appName: "Pinball Parade" });

    // The launch button lives in TABLE coordinates, just left of the plunger
    // lane: never over the waiting ball, never over a flipper.
    Render.onResize = () => {
      const b = this.el("btn-launch"), size = Math.round(Math.max(64, Math.min(96, 88 * Render.s)));
      b.style.width = b.style.height = size + "px";
      b.style.left = Math.round(Render.ox + 306 * Render.s - size / 2) + "px";
      b.style.top = `min(${Math.round(Render.oy + 688 * Render.s - size / 2)}px, calc(100% - ${size}px - env(safe-area-inset-bottom, 0px) - 6px))`;
    };
    Render.boot(this.el("cv"));
    Input.bind(this.el("game-stage"), this.el("btn-launch"));
    Input.onPause = () => (Play.paused ? Play.resume() : Play.pause());
    document.addEventListener("visibilitychange", () => { if (document.hidden) Play.pause(); });
    Assets.init();
    Assets.onChange(() => { if (GK.UI.screen === "book") this.showBook(); this.applyLogo(); });

    const shot = new URLSearchParams(location.search).get("shot");
    GK.Debug.init({ storage: Storage, title: "PINBALL PARADE" })
      .jump("chapter", CHAPTERS.length, (n) => this.startChapter(n - 1))
      .action("complete objective", () => { const s = Play.sim; if (s) { const i = s.S.obj.findIndex((o) => !o.done); if (i >= 0) s.complete(i); } })
      .action("multiball", () => { const s = Play.sim; if (s) { s.serve(true); s.serve(true); } });
    for (const l of LAYERS) GK.Debug.action(`${l} on/off`, () => { Render.setLayer(l, !Render.layers[l]); this.applyLayers(); });
    this.applyLayers();
    this.applyLogo();

    this.showScreen("splash");
    Storage.initFirebase().then((ok) => {
      this.el("sync-badge").textContent = ok ? "☁️ family sync on" : "📴 playing offline";
      if (!ok) return;
      if (GK.UI.screen === "profiles") GK.Profiles.renderList();
      if (GK.UI.screen === "splash") this.refreshSplash();
      if (GK.UI.screen === "book") this.showBook();
      if (GK.UI.screen === "leaderboard") this.showLeaderboard(true);
    });
    // Screenshot mode (?shot=…) is a separate, debug-only script: see js/shots.js.
    if (shot) { const s = document.createElement("script"); s.src = "js/shots.js"; document.body.appendChild(s); }
  },

  showScreen(name) { GK.UI.showScreen(name); },
  progress() { return Storage.getProgress(this.profile.id); },
  save(p) { Storage.saveProgress(this.profile.id, p); },

  applyLayers() { document.body.classList.toggle("hide-hud", !Render.layers.hud); },
  applyLogo() {
    const img = Assets.get("assets/logo/logo.png");
    const slot = this.el("logo-art");
    if (img && slot && !slot.firstChild) { const i = img.cloneNode(); i.alt = "Pinball Parade"; slot.appendChild(i); document.body.classList.add("has-logo"); }
  },

  // --------------------------------------------------------------- splash --
  refreshSplash() {
    const last = GK.Profiles.lastProfile();
    const cont = this.el("btn-continue-as"), start = this.el("btn-start");
    if (last) {
      cont.style.display = "";
      cont.textContent = `▶ Continue as ${last.avatar} ${last.name}`;
      cont.onclick = () => { Sfx.init(); GK.Profiles.select(last); };
      start.className = "btn ghost";
      start.textContent = "👥 Switch player";
    } else {
      cont.style.display = "none";
      start.className = "btn big green";
      start.textContent = "▶ Let the story roll";
    }
  },
  play() { Sfx.init(); Sfx.click(); GK.Profiles.renderList(); this.showScreen("profiles"); },
  howTo() { Sfx.click(); GK.UI.openModal("modal-howto"); },

  // ----------------------------------------------------------------- book --
  showBook() {
    if (!this.profile) return this.play();
    const p = this.progress();
    this.el("book-player").innerHTML = `${this.profile.avatar} <b>${esc(this.profile.name)}</b>`;
    this.el("book-stars").textContent = `⭐ ${Progress.totalStars(p)}`;
    const next = Progress.nextChapter(p);
    const cont = this.el("btn-next");
    if (next !== null) {
      const c = CHAPTERS[next];
      cont.innerHTML = `<span class="nb-k">${esc(WORLDS[c.world].name)} · Chapter ${c.n}</span><span class="nb-t">▶ ${esc(c.title)}</span>`;
      cont.onclick = () => this.chapterCard(next);
    } else {
      cont.innerHTML = "🏆 Every story told — replay any chapter";
      cont.onclick = () => this.showWorld(4);
    }
    const d = dailyConfig(todayKey());
    const dailyOpen = Progress.worldOpen(p, WORLDS.findIndex((w) => w.table === d.table));
    const dp = p.dailyDate === d.date ? p.dailyScore : 0;
    this.el("daily").innerHTML = `
      <button class="daily-card${dailyOpen ? "" : " locked"}" ${dailyOpen ? "" : "disabled"} onclick="App.startDaily()" aria-label="Daily Parade">
        <span class="daily-kicker">Today's Daily Parade</span>
        <span class="daily-name">${esc(WORLDS.find((w) => w.table === d.table).name)} · ${esc(d.twist.name)}</span>
        <span class="daily-note">${dailyOpen ? `${esc(d.twist.note)}${dp ? ` · your best today ${fmt(dp)}` : ""}` : "Opens when you reach this world"}</span>
      </button>`;
    const wrap = this.el("worlds");
    wrap.innerHTML = "";
    WORLDS.forEach((w, i) => {
      const open = Progress.worldOpen(p, i);
      const chs = CHAPTERS.filter((c) => c.world === i);
      const got = chs.reduce((s, c) => s + ((p.chapters[c.idx] || {}).stars || 0), 0);
      const b = document.createElement("button");
      b.className = "world-card" + (open ? "" : " locked");
      b.setAttribute("aria-label", `${w.name}${open ? `, ${got} of 12 stars` : ", locked"}`);
      b.innerHTML = `<span class="wc-art"></span>
        <span class="wc-body">
          <span class="wc-n">World ${i + 1}</span>
          <span class="wc-name">${esc(w.name)}</span>
          <span class="wc-stars">${open ? `${"★".repeat(Math.min(got, 12))}<i>${"★".repeat(12 - Math.min(got, 12))}</i>` : `🔒 ${esc(Progress.worldNeeds(p, i))}`}</span>
        </span>`;
      const art = b.querySelector(".wc-art");
      const img = Assets.worldCard(w.table);
      art.appendChild(img ? img.cloneNode() : Render.thumbnail(TABLES[i], 150, 110));
      if (open) b.onclick = () => { Sfx.click(); this.showWorld(i); };
      else b.disabled = true;
      wrap.appendChild(b);
    });
    this.showScreen("book");
  },

  showWorld(w) {
    const p = this.progress(), W = WORLDS[w];
    this.worldIdx = w;
    this.el("world-title").textContent = W.name;
    this.el("world-blurb").textContent = W.blurb;
    const art = this.el("world-art");
    art.innerHTML = "";
    const img = Assets.worldCard(W.table);
    art.appendChild(img ? img.cloneNode() : Render.thumbnail(TABLES[w], 330, 150));
    this.el("chapters").innerHTML = CHAPTERS.filter((c) => c.world === w).map((c) => {
      const open = Progress.chapterOpen(p, c.idx), r = p.chapters[c.idx];
      const st = r ? r.stars : 0;
      return `<button class="ch-card${open ? "" : " locked"}${open && !r ? " next" : ""}" ${open ? `onclick="App.chapterCard(${c.idx})"` : "disabled"}
          aria-label="Chapter ${c.n}, ${esc(c.title)}${open ? `, ${st} of 3 stars` : ", locked"}">
        <span class="ch-n">${open ? c.n : "🔒"}</span>
        <span class="ch-body"><span class="ch-title">${esc(c.title)}</span>
          <span class="ch-best">${r ? `best ${fmt(r.best)}` : open ? "new chapter" : "finish the one before"}</span></span>
        <span class="ch-stars">${"★".repeat(st)}<i>${"★".repeat(3 - st)}</i></span>
      </button>`;
    }).join("");
    const best = (p.tables || {})[W.table] || 0;
    this.el("free-play").innerHTML = `<button class="free-card" onclick="App.startFree('${W.table}')" aria-label="Free play on ${esc(W.name)}">
        <span class="free-kicker">Free play · family leaderboard</span>
        <span class="free-name">Every ramp open, three balls, go for the high score</span>
        <span class="free-best">${best ? `your best ${fmt(best)}` : "no score yet"}</span></button>`;
    this.showScreen("world");
  },

  // Three objectives, shown before play, with the same icons as the HUD.
  chapterCard(idx) {
    Sfx.init(); Sfx.click();
    const c = CHAPTERS[idx], w = WORLDS[c.world];
    this.el("cc-kicker").textContent = `${w.name} · Chapter ${c.n}`;
    this.el("cc-title").textContent = c.title;
    this.el("cc-story").textContent = c.story;
    const rows = this.el("cc-objs");
    rows.innerHTML = "";
    const tags = ["Opens the next chapter", "Second star", `Third star — or score ${fmt(c.scoreTarget)}`];
    c.objectives.forEach((o, i) => {
      const r = document.createElement("div");
      r.className = "cc-obj" + (i === 0 ? " primary" : "");
      r.appendChild(Render.icon(o.icon, 40, c.table));
      r.insertAdjacentHTML("beforeend", `<span><b>${esc(o.label)}${o.count > 1 && o.kind !== "spell" && !/d|twice/i.test(o.label) ? ` <em>×${o.count}</em>` : ""}</b><small>${esc(tags[i])}</small></span>`);
      rows.appendChild(r);
    });
    this.el("cc-play").onclick = () => { GK.UI.closeModal("modal-chapter"); this.startChapter(idx); };
    GK.UI.openModal("modal-chapter");
  },

  startChapter(idx) { Sfx.init(); Play.start(Object.assign({ mode: "chapter" }, CHAPTERS[idx])); },
  startFree(table) { Sfx.init(); Sfx.click(); Play.start(freePlayConfig(table)); },
  startDaily() { Sfx.init(); Sfx.click(); Play.start(dailyConfig(todayKey())); },

  // ------------------------------------------------------------------ hud --
  buildHud(cfg, table) {
    const chips = this.el("hud-chips");
    chips.innerHTML = "";
    if (!cfg.objectives.length) {
      chips.innerHTML = `<span class="hud-label">Free play · ${esc(WORLDS.find((w) => w.table === cfg.table).name)}</span>`;
    }
    cfg.objectives.forEach((o, i) => {
      const d = document.createElement("div");
      d.className = "chip" + (i === 0 ? " primary" : "");
      d.setAttribute("aria-label", o.label);
      d.appendChild(Render.icon(o.icon, 26, cfg.table));
      d.insertAdjacentHTML("beforeend", `<span class="chip-n"></span>`);
      chips.appendChild(d);
    });
    this.el("hud-score").textContent = "0";
    this.el("banner").className = "banner";
    this.updateHud();
  },

  updateHud() {
    const S = Play.sim.S, cfg = Play.cfg;
    const sig = S.obj.map((o) => `${o.n}${o.done ? "d" : ""}`).join(",") + "|" + S.ballsLeft + "|" + S.score + "|" + Math.round(S.parade.meter * 40) + (S.t < S.parade.until ? "P" : "") + "|" + (Play.sim.readyBall() ? 1 : 0) + (S.t < S.saveUntil ? "s" : "");
    if (sig === Play.chipSig) return;
    Play.chipSig = sig;
    const chips = this.el("hud-chips").children;
    cfg.objectives.forEach((o, i) => {
      const st = S.obj[i], c = chips[i];
      if (!c) return;
      c.classList.toggle("done", st.done);
      const need = o.kind === "score" ? 1 : (o.count || 1);
      c.querySelector(".chip-n").textContent = st.done ? "✓" : o.kind === "spell" ? `${(S.spell[o.group] || 0)}/${o.word.length}` : `${Math.min(st.n, need)}/${need}`;
    });
    this.el("hud-balls").innerHTML = Array.from({ length: cfg.balls || 3 }, (_, i) => `<i class="${i < S.ballsLeft ? "on" : ""}"></i>`).join("");
    this.el("hud-score").textContent = fmt(S.score);
    const bar = this.el("parade-bar");
    const on = S.t < S.parade.until;
    bar.classList.toggle("on", on);
    bar.firstElementChild.style.width = `${on ? 100 * (S.parade.until - S.t) / 10 : S.parade.meter * 100}%`;
    this.el("btn-launch").classList.toggle("ready", !!Play.sim.readyBall() && !Play.sim.readyBall().auto);
    this.el("save-lamp").classList.toggle("on", S.t < S.saveUntil);
  },

  banner(text, ms) {
    const b = this.el("banner");
    b.textContent = text;
    b.className = "banner show";
    clearTimeout(this._bt);
    this._bt = setTimeout(() => { b.className = "banner"; }, ms);
  },

  fillPause() {
    const done = Play.sim && Play.sim.S.obj[0] && Play.sim.S.obj[0].done;
    this.el("btn-finish").style.display = done ? "" : "none";
  },
  finishNow() { GK.UI.closeModal("modal-pause"); Play.paused = false; Play.sim.finish(true, 0.1); },
  restart() { const cfg = Play.cfg; Play.quit(); Play.start(cfg); },
  exitGame() {
    const cfg = Play.cfg;
    Play.quit();
    if (cfg.mode === "chapter") this.showWorld(cfg.world);
    else if (cfg.mode === "free") this.showWorld(WORLDS.findIndex((w) => w.table === cfg.table));
    else this.showBook();
  },

  // -------------------------------------------------------------- results --
  showResults(cfg, res) {
    const p = Progress.record(this.progress(), cfg, res);
    this.save(p);
    const title = this.el("res-title"), note = this.el("res-note"), next = this.el("res-next"), again = this.el("res-again");
    this.el("res-kicker").textContent = cfg.mode === "chapter" ? `${WORLDS[cfg.world].name} · Chapter ${cfg.n}` : cfg.title;
    this.el("res-score").textContent = fmt(res.score);
    const stars = this.el("res-stars");
    stars.innerHTML = cfg.mode === "chapter" ? [0, 1, 2].map((i) => `<span class="star${i < res.stars ? " on" : ""}">★</span>`).join("") : "";
    const objs = this.el("res-objs");
    objs.innerHTML = "";
    (cfg.objectives || []).forEach((o, i) => {
      const r = document.createElement("div");
      r.className = "res-obj" + (res.done[i] ? " done" : "");
      r.appendChild(Render.icon(o.icon, 28, cfg.table));
      r.insertAdjacentHTML("beforeend", `<span>${esc(o.label)}</span><b>${res.done[i] ? "✓" : "·"}</b>`);
      objs.appendChild(r);
    });
    next.style.display = "none";
    if (cfg.mode === "chapter") {
      title.textContent = res.won ? (res.stars === 3 ? "A perfect tale!" : "Tale told!") : "Nearly there!";
      note.textContent = res.won
        ? (res.stars < 3 ? `Another go could win ${3 - res.stars} more star${3 - res.stars === 1 ? "" : "s"}.` : "Every star in this chapter is yours.")
        : `${cfg.objectives[0].label} to open the next chapter. Have another go!`;
      const n = cfg.idx + 1;
      if (res.won && n < CHAPTERS.length && Progress.chapterOpen(p, n)) {
        next.style.display = "";
        next.textContent = `▶ ${CHAPTERS[n].title}`;
        next.onclick = () => this.chapterCard(n);
      } else if (res.won && n < CHAPTERS.length) {
        note.textContent += ` ${Progress.worldNeeds(p, CHAPTERS[n].world)}.`;
      }
      if (res.won && n >= CHAPTERS.length) note.textContent = "That was the Grand Parade — every world, every story. Well played!";
      for (let i = 0; i < res.stars; i++) setTimeout(() => Sfx.star(i + 1), 350 + i * 260);
    } else if (cfg.mode === "free") {
      const best = p.tables[cfg.table];
      title.textContent = res.score >= best && res.score > 0 ? "New best!" : "Game over";
      note.textContent = `Your best on this table: ${fmt(best)}. It counts on the family leaderboard.`;
    } else {
      title.textContent = "Daily Parade done";
      note.textContent = `Your best today: ${fmt(p.dailyScore)}. A new parade comes tomorrow.`;
    }
    again.onclick = () => { Sfx.click(); Play.start(cfg); };
    this.el("res-book").onclick = () => { Sfx.click(); cfg.mode === "chapter" ? this.showWorld(cfg.world) : this.showBook(); };
    this.showScreen("results");
  },

  // ---------------------------------------------------------- leaderboard --
  showLeaderboard(silent) {
    if (!silent) Sfx.click();
    const day = todayKey();
    GK.Profiles.renderLeaderboard("lb-rows", {
      cols: (r) => `<span class="lb-stat">⭐ ${Progress.totalStars(r.progress)}</span>
        <span class="lb-stat">🏆 ${fmt(Progress.freeTotal(r.progress))}</span>
        <span class="lb-stat">📅 ${r.progress.dailyDate === day ? fmt(r.progress.dailyScore) : "–"}</span>`,
      sort: (a, b) => Progress.freeTotal(b.progress) - Progress.freeTotal(a.progress) || Progress.totalStars(b.progress) - Progress.totalStars(a.progress),
      meId: this.profile && this.profile.id,
      empty: "Nobody has played yet — tap Free Play on any world!",
    });
    this.showScreen("leaderboard");
  },
};

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => App.init());
else App.init();
