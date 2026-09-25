// Screenshot director — loaded only when the URL carries ?shot=… .
//
// Stages one screen for a clean portrait capture (tools/shots.js drives it
// with headless Edge). It NEVER persists: saves are stubbed and the player is
// a made-up, in-memory profile, so a capture run cannot touch anyone's
// progress or the family leaderboard.
//
//   ?shot=splash | book | world&w=0 | chapter&c=1 | results
//   ?shot=<tableId>            the empty table (add &hide=ball,fx,hud,mech …)
//   ?shot=play-<tableId>       the table mid-game, frozen on a lively frame
//        &n=<chapter 1-4>  &phase=<0-based phase to start at, table transformed to match>
//   ?shot=results&lost=1       the "to be continued" card with its checkpoint
(function () {
  const q = new URLSearchParams(location.search), shot = q.get("shot");
  if (!shot) return;
  Storage.saveProgress = () => {};
  // captures show end states, not the middle of an entrance animation
  document.head.insertAdjacentHTML("beforeend", "<style>*, *::before, *::after { animation: none !important; transition: none !important; }</style>");
  const player = { id: "shot-player", name: "Player", avatar: "🦄" };
  const prog = PROGRESS.blank();
  [3, 3, 2, 3, 2, 1, 3, 2, 2].forEach((s, i) => { prog.chapters[i] = { stars: s, best: 9000 + i * 4100 }; });
  prog.tables = { castle: 48210, temple: 36900 };
  const realGet = Storage.getProgress.bind(Storage);
  Storage.getProgress = (id) => (id === player.id ? structuredClone(prog) : realGet(id));
  GK.Profiles.lastProfile = () => player;
  Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
  // ready only once the optional art has finished loading, so captures show it
  const done = () => {
    const mark = () => { document.body.dataset.shotReady = "1"; };
    if (Assets.loaded) mark(); else Assets.onChange(() => { if (Assets.loaded) mark(); });
  };

  // A tiny deterministic flipper for play captures: flip when the ball is
  // over a flipper and falling. Enough to put the table in a lively state.
  function run(sim, seconds) {
    const steps = Math.round(seconds / PHYS.DT);
    let hold = [0, 0];
    for (let i = 0; i < steps && !sim.S.over; i++) {
      const r = sim.readyBall();
      sim.input.launch = !!(r && !r.auto && i % 600 < 40);
      const b = sim.S.balls.find((x) => x.mode === "play" && x.y > 575 && x.y < 660 && x.vy > 0);
      for (const k of [0, 1]) {
        if (hold[k] > 0) hold[k]--;
        else if (b && (k ? b.x > 188 : b.x < 180)) hold[k] = 110;
      }
      sim.input.left = hold[0] > 0; sim.input.right = hold[1] > 0;
      sim.step();
    }
  }

  App.profile = player;
  const table = TABLES.find((t) => t.id === shot || "play-" + t.id === shot);
  if (shot === "splash") { App.showScreen("splash"); App.refreshSplash(); done(); }
  else if (shot === "book") { App.showBook(); done(); }
  else if (shot === "world") { App.showWorld(+(q.get("w") || 0)); done(); }
  else if (shot === "chapter") { App.showWorld(0); App.chapterCard(+(q.get("c") || 1)); done(); }
  else if (shot === "results") {
    const cfg = Object.assign({ mode: "chapter" }, CHAPTERS[2]);
    const lost = q.get("lost") === "1", n = cfg.phases.length;
    App.showResults(cfg, lost
      ? { mode: "chapter", won: false, told: false, score: 41250, phase: 2, phases: n, bonus: true, stars: 0, seconds: 212, checkpoint: { phase: 2, score: 30100, bonus: true }, stats: {} }
      : { mode: "chapter", won: true, told: true, score: 98480, phase: n, phases: n, bonus: true, stars: 3, seconds: 318, checkpoint: null, stats: {} });
    done();
  } else if (table && shot === table.id) {
    Play.start(freePlayConfig(table.id), { showcase: true });
    setTimeout(done, 300);
  } else if (table) {
    const ch = CHAPTERS.filter((c) => c.table === table.id)[+(q.get("n") || 2) - 1];
    const ph = +(q.get("phase") || 0);
    Play.start(Object.assign({ mode: "chapter" }, ch, ph ? { resume: { phase: ph, score: 20000 } } : {}));
    const sim = Play.sim;
    sim.events = null;
    run(sim, +(q.get("sec") || 16));
    // land on a frame with the ball up in the table, not in the lane
    for (let k = 0; k < 20000 && !sim.S.balls.some((b) => b.mode === "play" && b.y < 420 && b.x < 350); k++) {
      const r = sim.readyBall();
      sim.input.left = sim.input.right = false; sim.input.launch = !!(r && !r.auto && k % 600 < 40);
      sim.step();
    }
    sim.input.launch = false;
    sim.events = [];
    Play.showcase = true;               // freeze: keep drawing, stop stepping
    App.updateHud();
    setTimeout(done, 300);
  }
})();
