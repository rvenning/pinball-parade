// Touch smoke test for table selection, play, results and per-table scores.
// Run with a static server on :8133: node tools/e2e.js [baseUrl]
const { launch, wait } = require("./cdp.js");
const BASE = process.argv[2] || "http://localhost:8133/";

(async () => {
  const b = await launch();
  const { send, evaluate } = b;
  const steps = [];
  const check = (name, good) => { steps.push(`${good ? "✓" : "✗"} ${name}`); if (!good) throw new Error(name); };
  const tap = async (sel) => {
    const p = await evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({block:"center"}); const r=e.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2}; })()`);
    if (!p) throw new Error(`Missing ${sel}`);
    await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...p, id: 1 }] });
    await wait(70);
    await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await wait(250);
  };
  try {
    await send("Page.navigate", { url: BASE + "index.html" });
    for (let i = 0; i < 100 && !(await evaluate("typeof App !== 'undefined' && document.readyState === 'complete'")); i++) await wait(100);
    check("splash opens", (await evaluate("GK.UI.screen")) === "splash");
    await tap("#btn-start");
    await tap("#profile-list .profile-card, #profile-list button, #profile-list > *");
    await tap("#gk-new-profile-modal input");
    await send("Input.insertText", { text: "Tester" });
    await tap("#gk-new-profile-modal .avatar-choice:nth-child(2)");
    await tap("#gk-new-profile-modal .btn.green, #gk-new-profile-modal button[id*=create], #gk-new-profile-modal .row-btns2 .btn:last-child");
    await wait(300);
    if ((await evaluate("GK.UI.screen")) === "profiles") await tap("#profile-list .profile-card");
    check("all five tables are open", (await evaluate("document.querySelectorAll('#worlds .world-card:not(:disabled)').length")) === 5);
    await tap("#worlds .world-card:first-child");
    check("table opens", (await evaluate("GK.UI.screen")) === "game");
    for (let i = 0; i < 20 && !(await evaluate("document.getElementById('btn-launch').classList.contains('ready')")); i++) await wait(100);
    await tap("#btn-launch");
    check("ball launches", (await evaluate("Play.sim.S.stats.launches")) > 0);
    await evaluate("Play.sim.add(12345); Play.sim.finish(false, 0); true");
    await wait(1300);
    check("result saves a table score", (await evaluate("GK.UI.screen === 'results' && Storage.getProgress(App.profile.id).tables.castle >= 12345")) === true);
    await tap("#res-book");
    check("table card shows best score", (await evaluate("document.querySelector('#worlds .world-card:first-child .wc-stars').textContent.includes('12,345')")) === true);
    await tap("#screen-book [aria-label='Family leaderboard']");
    check("leaderboard has five table tabs", (await evaluate("document.querySelectorAll('#lb-tabs .lb-tab').length")) === 5);
    await tap("#lb-tabs .lb-tab:nth-child(2)");
    check("leaderboard switches tables", (await evaluate("App.leaderboardTable")) === "temple");
    check("no uncaught errors", !b.logs.some((x) => x.startsWith("EXCEPTION")));
  } catch (e) { steps.push("✗ " + e.message); process.exitCode = 1; }
  finally { console.log(steps.join("\n")); await b.close(); }
})();
