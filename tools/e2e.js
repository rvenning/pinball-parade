// End-to-end first run with TRUSTED input, in headless Edge emulating a
// 390×844 phone at DPR 2 with touch. Every tap goes through the browser's own
// hit-testing (Input.dispatchTouchEvent), so an unclickable control fails
// here exactly as it would under a finger.
//   node tools/e2e.js [baseUrl]
// Walks: splash → new player → book → chapter card → play → launch →
// both flippers at once → pause/resume → then PLAYS CHAPTER 1 TO THE END in
// real time with real touches, carrying on from the checkpoint after a lost
// game, and reports how long the story took on the wall clock — the real-play
// check on the bots' pacing numbers. Exits non-zero on the first broken step.
const { launch, wait } = require("./cdp.js");
const BASE = process.argv[2] || "http://localhost:8133/";

(async () => {
  const b = await launch();
  const { send, evaluate } = b;
  const steps = [];
  const ok = (name, cond, extra) => { steps.push(`${cond ? "✓" : "✗"} ${name}${extra ? "  " + extra : ""}`); if (!cond) throw new Error(name); };
  const center = async (sel) => evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({block:"center"}); const r = e.getBoundingClientRect(); return { x: r.left + r.width/2, y: r.top + r.height/2, w: r.width }; })()`);
  const touch = async (points, type) => send("Input.dispatchTouchEvent", { type, touchPoints: points.map((p, i) => ({ x: p.x, y: p.y, id: p.id ?? i, radiusX: 8, radiusY: 8, force: 1 })) });
  const tapAt = async (p) => { await touch([p], "touchStart"); await wait(60); await touch([], "touchEnd"); await wait(250); };
  const tap = async (sel) => { const p = await center(sel); if (!p) throw new Error("no element " + sel); await tapAt(p); return p; };
  const screen = () => evaluate("GK.UI.screen");
  const tableXY = (x, y) => evaluate(`(() => { const p = Render.toScreen(${x}, ${y}); return { x: p.x, y: p.y }; })()`);

  try {
    await send("Page.navigate", { url: BASE + "index.html" });
    for (let i = 0; i < 150 && (await evaluate("typeof GK !== 'undefined' && typeof App !== 'undefined' && document.readyState === 'complete'")) !== true; i++) await wait(200);
    ok("splash is up", (await screen()) === "splash");
    ok("fresh device: no Continue button", (await evaluate("getComputedStyle(document.getElementById('btn-continue-as')).display")) === "none");
    await tap("#btn-start");
    ok("roster opens", (await screen()) === "profiles");
    await wait(300);
    ok("audio woke on the first touch", (await evaluate("!!(GK.Sfx.ctx)")) === true, await evaluate("GK.Sfx.ctx && GK.Sfx.ctx.state"));
    await tap("#profile-list .profile-card, #profile-list button, #profile-list > *");
    await wait(300);
    ok("new-player sheet opens", (await evaluate("[...document.querySelectorAll('.modal.visible')].map(m=>m.id).join()")).includes("new-profile"));
    await tap("#gk-new-profile-modal input");
    await send("Input.insertText", { text: "Tester" });
    await tap("#gk-new-profile-modal .avatar-choice:nth-child(2)");
    await tap("#gk-new-profile-modal .btn.green, #gk-new-profile-modal button[id*=create], #gk-new-profile-modal .row-btns2 .btn:last-child");
    await wait(400);
    if ((await screen()) === "profiles") { await tap("#profile-list .profile-card"); await wait(300); }
    ok("the book opens for the new player", (await screen()) === "book");
    await tap("#btn-next");
    const nPhases = await evaluate("CHAPTERS[0].phases.length");
    ok("chapter card tells the story in phases", (await evaluate("document.querySelectorAll('#cc-objs .cc-obj.phase').length")) === nPhases && (await evaluate("!!document.querySelector('#cc-objs .cc-obj.finale')")), `${nPhases} phases`);
    await tap("#cc-play");
    await wait(500);
    ok("the table is up", (await screen()) === "game");
    const geo = await evaluate("(() => { const c = document.getElementById('cv'), r = c.getBoundingClientRect(), s = document.getElementById('game-stage').getBoundingClientRect(); return [r.width, r.height, c.width, s.width, s.height, devicePixelRatio]; })()");
    ok("canvas fills the stage at DPR 2", geo[0] === geo[3] && geo[1] === geo[4] && geo[2] === geo[0] * 2, JSON.stringify(geo));

    for (let i = 0; i < 20 && !(await evaluate("document.getElementById('btn-launch').classList.contains('ready')")); i++) await wait(150);
    const lb = await center("#btn-launch");
    ok("launch button is on screen and clear of the ball", !!lb && (await evaluate(`(() => { const r = document.getElementById('btn-launch').getBoundingClientRect(), p = Render.toScreen(370, 700); return !(p.x > r.left && p.x < r.right && p.y > r.top && p.y < r.bottom) && r.bottom <= innerHeight; })()`)));
    await touch([lb], "touchStart"); await wait(120); await touch([], "touchEnd"); await wait(400);
    ok("the ball launches", (await evaluate("Play.sim.S.stats.launches")) >= 1);
    ok("the HUD names what the story wants now", (await evaluate("document.querySelector('#chip-phase .ph-label').textContent")) === (await evaluate("CHAPTERS[0].phases[0].label")));

    const L = await tableXY(100, 640), R = await tableXY(270, 640);
    await evaluate("window.__plog = []; for (const t of ['pointerdown','pointerup','pointercancel','lostpointercapture']) document.getElementById('game-stage').addEventListener(t, (e) => __plog.push(t + ':' + e.pointerId), true); true");
    await touch([{ ...L, id: 1 }], "touchStart");
    await touch([{ ...L, id: 1 }, { ...R, id: 2 }], "touchStart");
    await wait(150);
    ok("two thumbs hold both flippers", (await evaluate("Play.sim.S.flip.map(f => f.held).join()")) === "true,true");
    // CDP's touchEnd lists the fingers being LIFTED: lift the right thumb only.
    await touch([{ ...R, id: 2 }], "touchEnd");
    await wait(80);
    ok("lifting one thumb keeps the other flipper up", (await evaluate("Play.sim.S.flip.map(f => f.held).join()")) === "true,false", await evaluate("Play.sim.S.flip.map(f => f.held).join() + ' | ' + __plog.join(' ') + ' | ' + JSON.stringify([...Input.pointers])"));
    await touch([{ ...L, id: 1 }], "touchEnd");
    await wait(80);
    ok("and lifting the last one drops it", (await evaluate("Play.sim.S.flip.map(f => f.held).join()")) === "false,false");

    const t0 = await evaluate("Play.sim.S.t");
    await tap("#screen-game .gamebar .iconbtn");
    ok("pause opens the sheet", (await evaluate("Play.paused && document.getElementById('modal-pause').classList.contains('visible')")) === true);
    await wait(1500);
    const t1 = await evaluate("Play.sim.S.t");
    ok("the table is frozen while paused", Math.abs(t1 - (await evaluate("Play.sim.S.t"))) < 1e-9);
    await tap("#modal-pause .btn.green");
    await wait(300);
    const t2 = await evaluate("Play.sim.S.t");
    ok("resume carries on without a jump", t2 > t1 && t2 - t1 < 0.6, `${(t1 - t0).toFixed(2)}s before, +${(t2 - t1).toFixed(2)}s after`);

    // Play with real touches: flip whichever side the ball is falling toward.
    // Game after game, carrying the story on from its checkpoint, until told.
    const seen = new Set();
    const wall0 = Date.now();
    let simSecs = 0, games = 0, told = false;
    const watch = "window.__seen = window.__seen || []; if (!Play.__w) { const o = Play.drain.bind(Play); Play.drain = function () { for (const e of this.sim.events) window.__seen.push(e.type); return o(); }; Play.__w = 1; } true";
    await evaluate(watch);
    for (games = 1; games <= 6 && !told; games++) {
    let held = null;
    for (let i = 0; i < 20000 && (await screen()) === "game" && Date.now() - wall0 < 12 * 60000; i++) {
      const s = await evaluate("(() => { const S = Play.sim && Play.sim.S; if (!S) return null; const b = S.balls.filter(b => b.mode === 'play').sort((a, c) => c.y - a.y)[0]; return { b: b && [b.x, b.y, b.vy], ready: document.getElementById('btn-launch').classList.contains('ready') }; })()");
      if (!s) break;
      if (s.ready) { const p = await center("#btn-launch"); await touch([p], "touchStart"); await wait(60); await touch([], "touchEnd"); continue; }
      const want = s.b && s.b[1] > 575 && s.b[1] < 665 && s.b[2] > 0 ? (s.b[0] < 184 ? "L" : "R") : null;
      if (want && want !== held) { await touch([want === "L" ? L : R], "touchStart"); held = want; }
      else if (!want && held) { await touch([], "touchEnd"); held = null; }
      await wait(30);
    }
    if (held) await touch([], "touchEnd");
    simSecs += await evaluate("Play.sim ? Play.sim.S.t : 0");
    for (let i = 0; i < 30 && (await screen()) === "game"; i++) await wait(200);
    told = (await evaluate("document.getElementById('res-title').textContent")) !== "To be continued…";
    steps.push(`  game ${games}: ${await evaluate("document.getElementById('res-title').textContent")} (${Math.round((Date.now() - wall0) / 1000)}s on the wall clock so far)`);
    if (!told && games < 6) { await tap("#res-next"); await wait(600); }
    }
    for (const e of await evaluate("window.__seen")) seen.add(e);
    const wall = (Date.now() - wall0) / 1000;
    ok("phases completed and the table changed", seen.has("phaseDone") && seen.has("effect"), [...seen].filter((e) => ["phaseDone", "effect", "bumper", "saved", "ballLost", "chapterWon", "storyTold"].includes(e)).join(","));
    ok("results arrive", (await screen()) === "results", await evaluate("document.getElementById('res-title').textContent"));
    ok("chapter 1 told by real play", told, `${games - 1} game(s)`);
    ok("real play took as long as the story says (2–4 min band, never under 1)", wall >= 60, `${(wall / 60).toFixed(1)} min on the wall clock, ${(simSecs / 60).toFixed(1)} min of table time, ${games - 1} game(s)`);
    const pace = await evaluate("JSON.stringify(Storage.getProgress(App.profile.id).pace || {})");
    ok("the pacing log recorded the first clear", (JSON.parse(pace)[0] || {}).secs > 0, pace);
    const stars = await evaluate("document.querySelectorAll('#res-stars .star.on').length");
    const saved = await evaluate("JSON.stringify(Storage.getProgress(App.profile.id).chapters)");
    ok("the result is saved", saved.includes('"0"'), `${stars}★ ${saved}`);
    if (await evaluate("getComputedStyle(document.getElementById('res-next')).display !== 'none'")) {
      await tap("#res-next");
      ok("next chapter card opens", (await evaluate("document.getElementById('cc-title').textContent")) === "Lower the Drawbridge");
    }
    await send("Page.navigate", { url: BASE + "index.html" });
    for (let i = 0; i < 150 && (await evaluate("typeof GK !== 'undefined' && typeof App !== 'undefined' && document.readyState === 'complete'")) !== true; i++) await wait(200);
    ok("returning player gets one-tap Continue", /Continue as/.test(await evaluate("document.getElementById('btn-continue-as').textContent")));
    ok("no uncaught errors", !b.logs.some((l) => l.startsWith("EXCEPTION")), b.logs.filter((l) => !/403|Firebase|auth|firestore/i.test(l)).join(" | "));
  } catch (e) {
    steps.push("✗ STOPPED: " + e.message);
    process.exitCode = 1;
  } finally {
    console.log(steps.join("\n"));
    await b.close();
  }
})();
