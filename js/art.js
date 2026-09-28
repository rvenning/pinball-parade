// Presentation only. The player's constant question is which lit feature shot
// the ball can reach next. The legibility budget reserves the rails, flippers,
// ball, moving targets and shot entrances for high-contrast gameplay marks.
// The engine supplies every position and state; nothing here changes a
// collision, score or timer. Static table art is already baked by Render.
// These small live details stay behind rails and the ball.
const Art = {
  motion: 1,
  time(t) { return t * this.motion; },
  metal(x, y, r, light = '#fff0bc', dark = '#815526') {
    const g = x.createLinearGradient(0, y-r, 0, y+r);
    g.addColorStop(0, light); g.addColorStop(.38, '#d5a653'); g.addColorStop(.55, '#f5d58b'); g.addColorStop(1, dark);
    return g;
  },
  // A shared machined bezel: the outside remains the exact collision radius.
  bezel(x, e, r) {
    this.oval(x,e.x+1,e.y+3,r,r,'#080e20');
    this.oval(x,e.x,e.y,r,r,this.metal(x,e.y,r),'#302638',1.5);
    for (let i=0;i<4;i++) {
      const a=Math.PI/4+i*Math.PI/2;
      this.oval(x,e.x+Math.cos(a)*r*.89,e.y+Math.sin(a)*r*.89,1,1,'#63442a');
    }
  },
  pocket(x,e,st,t) {
    x.save(); x.translate(e.x,e.y);
    const active=st.lock, hit=Math.max(0,1-(t-st.flash)/.6);
    if(e.id==='chest') {
      const gold=this.metal(x,-6,19);
      x.fillStyle='#3b221e'; x.strokeStyle='#d4ad65'; x.lineWidth=2;
      x.beginPath(); x.roundRect(-20,-18,40,31,5); x.fill(); x.stroke();
      x.fillStyle=gold; x.fillRect(-16,-17,3,28); x.fillRect(13,-17,3,28);
      x.save(); x.translate(0,-18); x.scale(1, .35 + (active ? .25 : 0) + hit * .4 * this.motion);
      x.fillStyle='#8a4930'; x.beginPath(); x.roundRect(-20,-20,40,20,[9,9,0,0]); x.fill(); x.stroke();
      x.restore();
    } else if(e.id==='eye') {
      x.fillStyle=this.metal(x,0,20); x.strokeStyle='#453c23'; x.lineWidth=2;
      x.beginPath(); x.moveTo(-24,0); x.quadraticCurveTo(0,-28,24,0); x.quadraticCurveTo(0,28,-24,0); x.fill(); x.stroke();
    }
    this.oval(x,0,0,e.r+2,e.r+2,this.metal(x,0,e.r+2),'#152033',2);
    this.oval(x,0,0,e.r-1,e.r-1,'#060c18');
    if(e.id==='eye') {
      this.oval(x,0,0,8, Math.max(2,5+hit*3), '#dfdbb5');
      this.oval(x,0,0,4,5,hit>0?'#9ff5dc':'#5dbdb0');
      this.oval(x,0,0,1.5,4,'#092833');
    }
    x.strokeStyle=active?'#8ceff2':'#98794e'; x.lineWidth=1.5;
    x.beginPath(); x.arc(0,0,e.r-3,Math.PI,Math.PI*2); x.stroke();
    if(hit>0) { x.globalAlpha=hit*.65; this.oval(x,0,0,e.r-2,e.r-2,'#a1f4fa'); }
    x.restore();
  },
  path(x, points, fill, stroke = "#401d26", width = 2) {
    x.beginPath(); x.moveTo(...points[0]);
    for (let i = 1; i < points.length; i++) x.lineTo(...points[i]);
    x.closePath(); x.fillStyle = fill; x.fill();
    if (stroke) { x.strokeStyle = stroke; x.lineWidth = width; x.lineJoin = "round"; x.stroke(); }
  },
  oval(x, cx, cy, rx, ry, fill, stroke = null, width = 2) {
    x.beginPath(); x.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    x.fillStyle = fill; x.fill();
    if (stroke) { x.strokeStyle = stroke; x.lineWidth = width; x.stroke(); }
  },

  // The dragon is a little enamel automaton from the castle's storybook art:
  // a readable head, curling tail, articulated wings and brass scale plates.
  // Its lower edge stays above the moving dragon target beneath it.
  dragon(x, e, awake, flying, t, hit=0) {
    t = this.time(t);
    const flap = flying ? Math.sin(t * 9) : Math.sin(t * 2.2) * 0.35;
    const bob = flying ? Math.sin(t * 9) * 2.5 : Math.sin(t * 2) * 1.2;
    x.save(); x.translate(e.x, e.y + bob);
    if(this.motion) x.rotate(-hit*.12);
    // Ground shadow and curled tail anchor the character to the illustrated table.
    this.oval(x, -1, 30, 48, 5, "rgba(7,8,20,.45)");
    x.strokeStyle = "#451a23"; x.lineWidth = 12; x.lineCap = "round";
    x.beginPath(); x.moveTo(-30, 8); x.bezierCurveTo(-55, 9, -55, 24, -69, 10); x.stroke();
    x.strokeStyle = "#bb4e42"; x.lineWidth = 8; x.stroke();
    this.path(x, [[-72, 8],[-65, 0],[-63, 13]], "#e6a64c");
    // Rear wing sweeps up and down; its inner web is a lighter warm coral.
    x.save(); x.translate(-17, -2); x.rotate(-0.16 + flap * 0.22);
    this.path(x, [[0, 0],[-30, -34],[-29, -11],[-45, -20],[-27, 5]], "#a83d3d");
    this.path(x, [[-4, 1],[-29, -27],[-29, -9],[-39, -15],[-25, 1]], "#e77b59", "#7c2933", 1.3);
    x.restore();
    // Body has a dark keyline, a top highlight and individual gold plates.
    const skin=x.createLinearGradient(0,-25,0,26);
    skin.addColorStop(0,'#f39865'); skin.addColorStop(.45,'#c75642'); skin.addColorStop(1,'#732e36');
    this.oval(x, 0, 7, 38, 18, skin, "#4a2026", 2.5);
    this.oval(x, -7, 2, 25, 7, "rgba(255,170,113,.52)");
    this.oval(x, 4, 15, 24, 7, "#f1c172", "#8b4b35", 1.3);
    for (let i = 0; i < 4; i++) this.path(x, [[-24 + i * 12,-7],[-18 + i * 12,-15],[-11 + i * 12,-5]], "#dc9251", "#80383a", 1);
    // Near wing sits above the body and hinges at the shoulder.
    x.save(); x.translate(4, -6); x.rotate(0.07 - flap * 0.28);
    x.beginPath(); x.moveTo(0,5); x.bezierCurveTo(2,-14,12,-39,26,-42);
    x.quadraticCurveTo(18,-25,37,-18); x.quadraticCurveTo(20,-20,22,0);
    x.quadraticCurveTo(9,-10,0,5);
    x.fillStyle=skin; x.fill(); x.strokeStyle='#562631'; x.lineWidth=2; x.stroke();
    x.strokeStyle='#f2b071'; x.lineWidth=1;
    for(const [px,py] of [[26,-42],[37,-18],[22,0]]) { x.beginPath(); x.moveTo(1,3); x.quadraticCurveTo(10,-19,px,py); x.stroke(); }
    x.restore();
    // Neck, sculpted head, snout and two horns make the silhouette unmistakable.
    this.path(x, [[23, 3],[30, -11],[42, -12],[49, 0],[41, 11]], "#bd5143", "#4a2026", 2.3);
    this.oval(x, 39, -9, 15, 13, skin, "#4a2026", 2.3);
    this.path(x, [[47,-5],[61,-3],[64,4],[53,8],[45,5]], "#d76b51", "#4a2026", 2);
    this.path(x, [[32,-17],[31,-30],[39,-22]], "#e3ad62", "#4a2026", 1.3);
    this.path(x, [[43,-17],[48,-29],[49,-15]], "#e3ad62", "#4a2026", 1.3);
    this.oval(x, 54, 0, 1.3, 1.3, "#61272b");
    if(hit>0) {
      x.globalAlpha=hit;
      this.path(x,[[63,1],[71,-3],[68,0],[80,1],[69,6],[72,3],[63,5]],'#ffd079','#bb6339',1);
      x.globalAlpha=1;
    }
    // Raised scales, folded feet and a jaw seam give the small figure depth.
    for(let row=0;row<3;row++) for(let j=0;j<6;j++) {
      x.strokeStyle='rgba(255,202,139,.28)'; x.lineWidth=.7;
      x.beginPath(); x.arc(-28+j*8+row*2,5+row*4,3,0,Math.PI); x.stroke();
    }
    for(const px of [-18,20]) {
      this.oval(x,px,22,9,4,skin,'#572b30',1);
      for(let j=0;j<3;j++) this.oval(x,px+2+j*2,24,1,1.5,'#f4d7a0');
    }
    x.strokeStyle='#743132'; x.lineWidth=1; x.beginPath(); x.moveTo(49,5); x.quadraticCurveTo(58,7,62,3); x.stroke();
    // Awake eyes focus forward; asleep eyes are a small curved lid.
    if (awake) {
      this.oval(x, 43, -10, 4.2, 4.5, "#fff0d4", "#4a2026", 1);
      this.oval(x, 44.2, -9.5, 1.6, 2.4, "#252039");
      this.oval(x, 43.2, -11.2, 0.7, 0.8, "#fff");
    } else {
      x.strokeStyle = "#4a2026"; x.lineWidth = 1.8;
      x.beginPath(); x.arc(43, -10, 4, 0.2, Math.PI - 0.2); x.stroke();
    }
    if (awake && !flying) {
      const breath = 2 + (Math.sin(t * 7) + 1) * 1.5;
      this.oval(x, 67 + breath, 1, 2.5, 1.7, "rgba(255,192,88,.85)");
    }
    x.restore();
  },

  automaton(x, e, awake, t) {
    t = this.time(t);
    const stride = awake ? Math.sin(t * 7) * 4 : 0;
    x.save(); x.translate(e.x, e.y);
    this.oval(x, 0, 27, 18, 4, "rgba(7,8,20,.4)");
    for (const side of [-1, 1]) {
      x.strokeStyle = "#4c3430"; x.lineWidth = 7; x.lineCap = "round";
      x.beginPath(); x.moveTo(side * 7, 11); x.lineTo(side * 8, 25 + stride * side); x.stroke();
      this.oval(x, side * 9, 26 + stride * side, 6, 3, "#d7aa61", "#533d35", 1);
    }
    this.path(x, [[-14,-10],[14,-10],[12,15],[-12,15]], this.metal(x,0,19), "#352c2b", 2);
    for(const side of [-1,1]) {
      x.save(); x.translate(side*14,-5); x.rotate(side*(.25+stride*.08));
      this.path(x,[[-3,0],[3,0],[4,16],[-4,16]],this.metal(x,8,12),'#4c3430',1);
      this.oval(x,0,17,4,4,'#e6c780','#4c3430',1); x.restore();
    }
    this.oval(x, 0, 2, 8, 8, "#d9aa64", "#5b3b2c", 1.5);
    x.strokeStyle = "#75502d"; x.lineWidth = 1.2;
    for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4 + (awake ? t * 2 : 0); x.beginPath(); x.moveTo(Math.cos(a) * 3, 2 + Math.sin(a) * 3); x.lineTo(Math.cos(a) * 6, 2 + Math.sin(a) * 6); x.stroke(); }
    this.oval(x, 0, -17, 11, 10, this.metal(x,-17,11), "#5b3b2c", 2);
    this.path(x, [[-12,-24],[12,-24],[9,-29],[-9,-29]], "#b64f46", "#5b3b2c", 1.5);
    this.oval(x, -4, -18, 1.8, 2.4, awake ? "#9df0fa" : "#695445");
    this.oval(x, 4, -18, 1.8, 2.4, awake ? "#9df0fa" : "#695445");
    x.strokeStyle = "#d3a356"; x.lineWidth = 2.5; x.lineCap = "round";
    x.beginPath(); x.moveTo(14, -2); x.lineTo(20, 0); x.stroke();
    x.save(); x.translate(21, 0); x.rotate(awake ? t * 4 : 0);
    x.beginPath(); x.moveTo(-5, 0); x.lineTo(5, 0); x.moveTo(0, -5); x.lineTo(0, 5); x.stroke(); x.restore();
    x.restore();
  },

  // Quiet, bounded motion in each table's theme. All marks stay beneath the
  // collision drawing; no high-contrast decoration crosses a shot entrance.
  atmosphere(x, sim, t) {
    t = this.time(t);
    const id = sim.table.id;
    x.save();
    if (id === "castle") {
      for (const [px, py] of [[72,185],[312,210],[310,105]]) {
        this.oval(x, px, py, 3.5, 3.5, "rgba(255,207,109,.16)");
        if (this.motion) this.oval(x, px + Math.sin(t * 2 + py) * 3, py - (t * 10 + py) % 20, 1.1, 1.1, "rgba(255,212,135,.55)");
      }
    } else if (id === "temple") {
      x.strokeStyle = "rgba(174,215,123,.28)"; x.lineWidth = 2; x.lineCap = "round";
      for (const px of [78, 292]) { const sway = Math.sin(t * 1.5 + px) * 5;
        x.beginPath(); x.moveTo(px, 65); x.quadraticCurveTo(px + sway * 2, 106, px + sway, 142); x.stroke();
        this.oval(x, px + sway, 139, 4, 8, "rgba(155,204,102,.32)");
      }
    } else if (id === "sea") {
      x.strokeStyle = "rgba(176,242,255,.32)"; x.lineWidth = 1.2;
      for (let i = 0; i < 12; i++) { const px = i % 2 ? 82 + (i * 17) % 28 : 296 + (i * 13) % 22;
        const py = 400 - ((t * (10 + i % 3 * 4) + i * 43) % 340);
        x.beginPath(); x.arc(px + Math.sin(t + i) * 3, py, 1.5 + i % 3, 0, Math.PI * 2); x.stroke();
      }
    } else if (id === "workshop") {
      for (const [px,py,r,dir] of [[70,142,12,1],[304,124,9,-1]]) {
        x.save(); x.translate(px,py); x.rotate(t * .6 * dir); x.strokeStyle = "rgba(238,193,110,.38)"; x.lineWidth = 2;
        x.beginPath(); x.arc(0,0,r,0,Math.PI*2); x.stroke();
        for (let i=0;i<8;i++) { const a=i*Math.PI/4; x.beginPath(); x.moveTo(Math.cos(a)*r*.55,Math.sin(a)*r*.55); x.lineTo(Math.cos(a)*r,Math.sin(a)*r); x.stroke(); }
        x.restore();
      }
    } else if (id === "clouds") {
      for (const [px,py,w] of [[74,102,28],[282,138,22],[92,402,20]]) {
        const drift = Math.sin(t * .6 + py) * 7;
        this.oval(x, px + drift, py, w, 5, "rgba(244,249,255,.15)");
      }
    }
    x.restore();
  },
};
