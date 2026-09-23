// Controls: every touch, mouse and key ends in the same three booleans the
// engine reads — Input.left, Input.right, Input.launch.
//
// Touch: each pointer is tracked by its id and assigned a side when it lands
// (left or right half of the table, lower 60% of it), so two thumbs held at
// once are two flippers held at once, and lifting one never releases the
// other. A pointer that lands on the plunger lane while a ball waits there
// charges the launcher instead; so does the big Launch button.
//
// Keys: ←/A/Left Shift, →/D/Right Shift, Space/↓/Enter to launch, P/Esc to
// pause. Nothing here is gesture detection: flippers must respond on
// pointerdown, and a swipe would cost the timing.

const Input = {
  left: false, right: false, launch: false,
  pointers: new Map(),      // pointerId -> "L" | "R" | "launch"
  keys: { L: false, R: false, launch: false },
  button: false,            // the DOM launch button is held
  enabled: false,
  onPause: null,
  canLaunch: () => false,

  bind(stage, launchBtn) {
    const down = (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      GK.Sfx.init();
      const p = Render.toLogical(e.clientX, e.clientY);
      let side;
      if (p.x > 340 && p.y > 440 && this.canLaunch()) side = "launch";
      else if (p.y < TABLE_H * 0.4) return;        // the top of the table is for looking at
      else side = p.x < CX ? "L" : "R";
      this.pointers.set(e.pointerId, side);
      try { stage.setPointerCapture(e.pointerId); } catch {}
      this.sync();
    };
    const up = (e) => { if (this.pointers.delete(e.pointerId)) this.sync(); };
    stage.addEventListener("pointerdown", down, { passive: false });
    stage.addEventListener("pointerup", up);
    stage.addEventListener("pointercancel", up);
    stage.addEventListener("lostpointercapture", up);
    // iOS: stop the page scrolling, zooming or long-press-selecting under a thumb
    for (const ev of ["touchstart", "touchmove", "touchend"]) stage.addEventListener(ev, (e) => { if (this.enabled) e.preventDefault(); }, { passive: false });
    stage.addEventListener("contextmenu", (e) => e.preventDefault());

    if (launchBtn) {
      launchBtn.addEventListener("pointerdown", (e) => { e.preventDefault(); e.stopPropagation(); GK.Sfx.init(); this.button = true; try { launchBtn.setPointerCapture(e.pointerId); } catch {} this.sync(); });
      const rel = (e) => { e.stopPropagation(); if (this.button) { this.button = false; this.sync(); } };
      launchBtn.addEventListener("pointerup", rel);
      launchBtn.addEventListener("pointercancel", rel);
      launchBtn.addEventListener("lostpointercapture", rel);
    }

    const KEY = { ArrowLeft: "L", KeyA: "L", ShiftLeft: "L", KeyZ: "L", ArrowRight: "R", KeyD: "R", ShiftRight: "R", Slash: "R", Space: "launch", ArrowDown: "launch", Enter: "launch" };
    window.addEventListener("keydown", (e) => {
      if (!this.enabled) return;
      if (e.code === "Escape" || e.code === "KeyP") { e.preventDefault(); if (this.onPause) this.onPause(); return; }
      const k = KEY[e.code];
      if (!k) return;
      e.preventDefault();
      if (e.repeat) return;
      GK.Sfx.init();
      this.keys[k] = true; this.sync();
    });
    window.addEventListener("keyup", (e) => { const k = KEY[e.code]; if (k) { this.keys[k] = false; this.sync(); } });
    window.addEventListener("blur", () => this.releaseAll());
    document.addEventListener("gesturestart", (e) => e.preventDefault());
    document.addEventListener("gesturechange", (e) => e.preventDefault());
  },

  sync() {
    const held = new Set(this.pointers.values());
    this.left = held.has("L") || this.keys.L;
    this.right = held.has("R") || this.keys.R;
    this.launch = held.has("launch") || this.keys.launch || this.button;
  },

  releaseAll() {
    this.pointers.clear();
    this.keys = { L: false, R: false, launch: false };
    this.button = false;
    this.sync();
  },
};
