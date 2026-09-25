// App shell and the play loop. Profiles, PINs, sync, install and the version
// line come from gamekit; this file decides what each screen shows and owns
// the fixed-step accumulator that turns real time into Sim.step() calls.

const AVATARS = ["🦄", "🐉", "🦊", "🐼", "🐙", "🦉", "🐸", "🐰", "🐯", "🦖", "🐧", "🐝"];

const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const fmt = (n) => Math.round(n).toLocaleString("en-AU");
// "×3" after a label, unless the label already says how many
const countText = (o) => (o.kind === "frenzy" ? ` — ${o.count ? o.count + " in " : ""}${o.timer.secs} seconds`
  : o.count > 1 && o.kind !== "spell" && !/\d|twice/i.test(o.label) ? ` ×${o.count}` : "");
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
        case "phaseStart": {
          const p = this.cfg.phases[e.idx];
          // the first phase is on the chapter card already; say it once the ball is out
          App.banner(p.title, e.idx === 0 ? 1800 : 2400, (e.final ? "Finale · " : "") + p.label, e.idx === 0 ? 700 : 900);
          App.buildPhaseChip();
          break;
        }
        case "phaseDone": {
          Sfx.objective();
          if (e.jackpot) { App.banner("JACKPOT!", 1600, "+" + fmt(e.value)); if (!R) Fx.text(CX, 330, "+" + fmt(e.value), { color: "#72e6f2", size: 22 }); }
          if (!R) { Fx.addShake(5); Fx.addFlash(0.25, "#fff4d6"); }
          break;
        }
        case "effect": {
          // the table visibly changing: a burst where it changed
          if (!e.id) break;
          const [x, y] = this.sim.pos(e.id);
          burst(x, y, e.kind === "open" || e.kind === "lightLock" ? Render.art.glow : "#fff4d6", 16);
          break;
        }
        case "bonusDone": Sfx.rampDone(); App.banner("Bonus star!", 1500, this.cfg.bonus.label); break;
        case "extraBall": Sfx.saved(); App.banner("Extra ball!", 1500); break;
        case "storyTold": App.banner("The end!", 2600, "What a story"); break;
        case "ballBonus": if (!R) Fx.text(CX, 420, `${e.balls} ball${e.balls === 1 ? "" : "s"} in hand +${fmt(e.v)}`, { color: "#fff4d6", size: 15 }); break;
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
    Assets.onChange(() => {
      if (GK.UI.screen === "book") this.showBook();
      if (GK.UI.screen === "results") this.fillMascot();
      this.applyLogo();
    });

    const shot = new URLSearchParams(location.search).get("shot");
    GK.Debug.init({ storage: Storage, title: "PINBALL PARADE" })
      .jump("chapter", CHAPTERS.length, (n) => this.startChapter(n - 1))
      .action("complete phase", () => { const s = Play.sim; if (s && s.phaseSpec()) s.completePhase(); })
      .action("multiball", () => { const s = Play.sim; if (s) { s.serve(true); s.serve(true); } })
      // Real family play, against the designed bands: time and games to a
      // chapter's first clear (still-running tallies marked "so far").
      .action("pacing report", () => {
        if (!this.profile) return alert("Pick a player first.");
        const p = this.progress(), rows = [];
        for (const c of CHAPTERS) {
          const done = (p.pace || {})[c.idx], run = (p.paceRun || {})[c.idx], r = done || run;
          if (!r) continue;
          const band = PACE[c.pace];
          rows.push(`${c.idx + 1}. ${c.title}: ${(r.secs / 60).toFixed(1)} min in ${r.games} game${r.games === 1 ? "" : "s"}${done ? "" : " so far"} (band ${band[0]}–${band[1]})`);
        }
        alert(rows.length ? `${this.profile.name}\n` + rows.join("\n") : "No chapters played yet.");
      });
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

  // The story before play: its phases in order (the finale marked), the bonus
  // and the score star — with the same icons as the HUD.
  chapterCard(idx) {
    Sfx.init(); Sfx.click();
    const c = CHAPTERS[idx], w = WORLDS[c.world];
    const resume = Progress.resumeFor(this.progress(), idx);
    this.el("cc-kicker").textContent = `${w.name} · Chapter ${c.n}`;
    this.el("cc-title").textContent = c.title;
    this.el("cc-story").textContent = c.story;
    const rows = this.el("cc-objs");
    rows.innerHTML = "";
    const row = (icon, head, sub, cls) => {
      const r = document.createElement("div");
      r.className = "cc-obj " + (cls || "");
      r.appendChild(Render.icon(icon, 32, c.table));
      r.insertAdjacentHTML("beforeend", `<span><b>${head}</b><small>${sub}</small></span>`);
      rows.appendChild(r);
    };
    c.phases.forEach((p, i) => {
      const fin = i === c.phases.length - 1;
      const past = resume && i < resume.phase;
      row(p.icon, `${esc(p.title)}`, `${fin ? "<i>Finale</i> · " : ""}${esc(p.label)}${countText(p)}`, "phase" + (fin ? " finale" : "") + (past ? " past" : ""));
    });
    if (c.bonus) row(c.bonus.icon, "Bonus star", esc(c.bonus.label) + countText(c.bonus), "bonus");
    row("score", "Score star", `Score ${fmt(c.scoreTarget)}`, "bonus");
    const play = this.el("cc-play"), fresh = this.el("cc-fresh");
    if (resume) {
      play.textContent = `▶ Carry on: ${c.phases[resume.phase].title}`;
      play.onclick = () => { GK.UI.closeModal("modal-chapter"); this.startChapter(idx, resume); };
      fresh.style.display = "";
      fresh.onclick = () => { GK.UI.closeModal("modal-chapter"); this.startChapter(idx); };
    } else {
      play.textContent = "▶ Play";
      play.onclick = () => { GK.UI.closeModal("modal-chapter"); this.startChapter(idx); };
      fresh.style.display = "none";
    }
    GK.UI.openModal("modal-chapter");
  },

  startChapter(idx, resume) {
    Sfx.init();
    const cfg = Object.assign({ mode: "chapter" }, CHAPTERS[idx]);
    if (resume) cfg.resume = { phase: resume.phase, score: resume.score, bonus: resume.bonus };
    Play.start(cfg);
  },
  startFree(table) { Sfx.init(); Sfx.click(); Play.start(freePlayConfig(table)); },
  startDaily() { Sfx.init(); Sfx.click(); Play.start(dailyConfig(todayKey())); },

  // ------------------------------------------------------------------ hud --
  // The HUD holds one phase chip (what the story wants now, with a pip for
  // every phase) and one small bonus chip. Free play shows the table's name.
  buildHud(cfg, table) {
    const chips = this.el("hud-chips");
    chips.innerHTML = "";
    if (!cfg.phases.length) {
      chips.innerHTML = `<span class="hud-label">Free play · ${esc(WORLDS.find((w) => w.table === cfg.table).name)}</span>`;
    } else {
      chips.innerHTML = `<div class="chip phase" id="chip-phase"><span class="ph-icon"></span><span class="ph-text"><span class="ph-label"></span><span class="ph-sub"><span class="ph-pips"></span><span class="chip-n"></span></span></span></div>`;
      if (cfg.bonus) {
        const d = document.createElement("div");
        d.className = "chip bonus"; d.id = "chip-bonus";
        d.setAttribute("aria-label", "Bonus: " + cfg.bonus.label);
        d.appendChild(Render.icon(cfg.bonus.icon, 22, cfg.table));
        d.insertAdjacentHTML("beforeend", `<span class="chip-n"></span>`);
        chips.appendChild(d);
      }
      this.buildPhaseChip();
    }
    this.el("hud-score").textContent = "0";
    this.el("banner").className = "banner";
    this.updateHud();
  },

  buildPhaseChip() {
    const sim = Play.sim, cfg = Play.cfg, c = this.el("chip-phase");
    if (!c || !sim) return;
    const p = sim.phaseSpec() || cfg.phases[cfg.phases.length - 1];
    const ic = c.querySelector(".ph-icon");
    ic.replaceChildren(Render.icon(p.icon, 26, cfg.table));
    c.querySelector(".ph-label").textContent = p.label;
    c.setAttribute("aria-label", `Phase ${Math.min(sim.S.phase + 1, cfg.phases.length)} of ${cfg.phases.length}: ${p.label}`);
    c.classList.toggle("finale", sim.S.phase === cfg.phases.length - 1);
    Play.chipSig = "";
  },

  // "2/3", a countdown for a timed mode, or a hurry-up's current value.
  goalText(o, st, S) {
    if (!st) return "✓";
    if (o.jackpot) return fmt(Play.sim.jackpotValue());
    if (o.kind === "spell") return `${(S.spell[o.group] || 0)}/${o.word.length}`;
    if (o.kind === "score") return fmt(Math.max(0, o.points - S.score));
    const n = `${Math.min(st.n, o.count || 1)}/${o.count || 1}`;
    if (o.timer && o.timer.end === "complete") return `${Math.max(0, Math.ceil(o.timer.secs - st.clock))}s` + (o.count ? ` · ${n}` : "");
    return n;
  },

  updateHud() {
    const sim = Play.sim, S = sim.S, cfg = Play.cfg;
    const p = sim.phaseSpec();
    const pv = p && S.ph ? this.goalText(p, S.ph, S) : "✓";
    const bv = cfg.bonus ? (S.bonus.done ? "✓" : this.goalText(cfg.bonus, S.bonus, S)) : "";
    const sig = S.phase + ":" + pv + "|" + bv + "|" + S.ballsLeft + "|" + S.score + "|" + Math.round(S.parade.meter * 40) + (S.t < S.parade.until ? "P" : "") + "|" + (sim.readyBall() ? 1 : 0) + (S.t < S.saveUntil ? "s" : "");
    if (sig === Play.chipSig) return;
    Play.chipSig = sig;
    const pc = this.el("chip-phase");
    if (pc) {
      pc.querySelector(".chip-n").textContent = pv;
      pc.classList.toggle("done", S.told);
      pc.querySelector(".ph-pips").innerHTML = cfg.phases.map((_, i) => `<i class="${i < S.phase ? "on" : i === S.phase ? "now" : ""}"></i>`).join("");
    }
    const bc = this.el("chip-bonus");
    if (bc) { bc.querySelector(".chip-n").textContent = bv; bc.classList.toggle("done", S.bonus.done); }
    this.el("hud-balls").innerHTML = Array.from({ length: cfg.balls || 3 }, (_, i) => `<i class="${i < S.ballsLeft ? "on" : ""}"></i>`).join("");
    this.el("hud-score").textContent = fmt(S.score);
    const bar = this.el("parade-bar");
    const on = S.t < S.parade.until;
    bar.classList.toggle("on", on);
    bar.firstElementChild.style.width = `${on ? 100 * (S.parade.until - S.t) / 10 : S.parade.meter * 100}%`;
    this.el("btn-launch").classList.toggle("ready", !!Play.sim.readyBall() && !Play.sim.readyBall().auto);
    this.el("save-lamp").classList.toggle("on", S.t < S.saveUntil);
  },

  // A headline and an optional smaller line. `after` delays it a moment, so a
  // phase-done flourish and the next phase's title do not trample each other.
  banner(text, ms, sub, after) {
    const b = this.el("banner");
    const show = () => {
      b.innerHTML = esc(text) + (sub ? `<small>${esc(sub)}</small>` : "");
      b.className = "banner show";
      clearTimeout(this._bt);
      this._bt = setTimeout(() => { b.className = "banner"; }, ms);
    };
    clearTimeout(this._ba);
    if (after) this._ba = setTimeout(show, after); else show();
  },

  fillPause() {
    const sim = Play.sim, p = sim && sim.phaseSpec();
    this.el("pause-story").textContent = p ? `Chapter so far: phase ${sim.S.phase + 1} of ${Play.cfg.phases.length}, “${p.title}”.` : "The ball is waiting right where you left it.";
  },
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
    this.resTable = cfg.table;
    this.fillMascot();
    const stars = this.el("res-stars");
    stars.innerHTML = cfg.mode === "chapter" ? [0, 1, 2].map((i) => `<span class="star${i < res.stars ? " on" : ""}">★</span>`).join("") : "";
    const objs = this.el("res-objs");
    objs.innerHTML = "";
    const row = (icon, text, done) => {
      const r = document.createElement("div");
      r.className = "res-obj" + (done ? " done" : "");
      r.appendChild(Render.icon(icon, 28, cfg.table));
      r.insertAdjacentHTML("beforeend", `<span>${esc(text)}</span><b>${done ? "✓" : "·"}</b>`);
      objs.appendChild(r);
    };
    (cfg.phases || []).forEach((p, i) => row(p.icon, p.title, i < res.phase));
    if (cfg.bonus) row(cfg.bonus.icon, "Bonus · " + cfg.bonus.label, res.bonus);
    next.style.display = "none";
    if (cfg.mode === "chapter") {
      title.textContent = res.won ? (res.stars === 3 ? "A perfect tale!" : "Tale told!") : "To be continued…";
      const cp = res.checkpoint && res.checkpoint.phase > 0 ? cfg.phases[res.checkpoint.phase] : null;
      note.textContent = res.won
        ? (res.stars < 3 ? `Another go could win ${3 - res.stars} more star${3 - res.stars === 1 ? "" : "s"}.` : "Every star in this chapter is yours.")
        : cp ? `Next time the story carries on from “${cp.title}”.` : "Have another go — the story is waiting.";
      if (!res.won) {
        next.style.display = "";
        next.textContent = cp ? `▶ Carry on: ${cp.title}` : "▶ Try again";
        next.onclick = () => { Sfx.click(); this.startChapter(cfg.idx, Progress.resumeFor(this.progress(), cfg.idx)); };
      }
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
    again.onclick = () => { Sfx.click(); cfg.mode === "chapter" ? this.startChapter(cfg.idx) : Play.start(cfg); };
    again.textContent = cfg.mode === "chapter" && !res.won ? "↻ Start over" : "↻ Again";
    this.el("res-book").onclick = () => { Sfx.click(); cfg.mode === "chapter" ? this.showWorld(cfg.world) : this.showBook(); };
    this.showScreen("results");
  },

  // This world's mascot, only if its art has loaded; the slot collapses
  // otherwise. Called again when art arrives late (see Assets.onChange).
  fillMascot() {
    const slot = this.el("res-mascot"), art = this.resTable && Assets.mascot(this.resTable);
    slot.replaceChildren();
    if (art) { const img = art.cloneNode(); img.alt = ""; slot.appendChild(img); }
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
