// Pinball physics — pure geometry and one ball step. No DOM, no canvas, no
// Math.random: everything here is a function of its arguments, which is what
// lets tests/ replay a whole chapter byte-for-byte and lets the bots run the
// real engine headless.
//
// Units are LOGICAL pixels on the fixed 400×720 table and seconds. The table
// is a tilted plane, so "gravity" is the along-table component only.
//
// Every solid is a capsule (a segment with a radius) or a circle. The rendered
// rail is drawn with lineWidth = 2 × radius on the same centre line, so what
// the ball bounces off is exactly what the player sees.

const PHYS = {
  W: 400, H: 720,
  DT: 1 / 480,          // fixed step; 8 per 60 Hz frame
  BALL_R: 9,
  G: 760,               // px/s² down the table
  MAX_SPEED: 1900,      // hard cap; the micro-step below keeps even this tunnel-proof
  DRAG: 0.035,          // fraction of speed lost per second in free flight
  WALL_E: 0.42,         // restitution against rails
  WALL_F: 0.015,        // tangential loss per contact
  SUB_FRAC: 0.35,       // a micro-step never moves the ball more than this × radius
  FLIP_UP: 26,          // rad/s rising
  FLIP_DOWN: 16,        // rad/s falling
  FLIP_E: 0.28,
};

const Physics = {
  clamp(v, a, b) { return v < a ? a : v > b ? b : v; },

  // Closest point on segment AB to P, with its parameter t in [0,1].
  closest(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const L2 = dx * dx + dy * dy;
    let t = L2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / L2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return { x: ax + dx * t, y: ay + dy * t, t };
  },

  // Distance between two segments (for the geometry lint).
  segSegDist(a, b, c, d) {
    if (this.segsCross(a, b, c, d)) return 0;
    const q = [
      this.closest(a[0], a[1], c[0], c[1], d[0], d[1]), this.closest(b[0], b[1], c[0], c[1], d[0], d[1]),
      this.closest(c[0], c[1], a[0], a[1], b[0], b[1]), this.closest(d[0], d[1], a[0], a[1], b[0], b[1]),
    ];
    const p = [a, b, c, d];
    let m = Infinity;
    for (let i = 0; i < 4; i++) m = Math.min(m, Math.hypot(p[i][0] - q[i].x, p[i][1] - q[i].y));
    return m;
  },

  segsCross(a, b, c, d) {
    const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
    const d1 = o(c, d, a), d2 = o(c, d, b), d3 = o(a, b, c), d4 = o(a, b, d);
    return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
  },

  // Did the ball centre cross the line AB between two positions? Returns the
  // side it came FROM (+1 / -1, the sign of cross(AB, AP)) or 0.
  crossed(x0, y0, x1, y1, ax, ay, bx, by) {
    const s0 = (bx - ax) * (y0 - ay) - (by - ay) * (x0 - ax);
    const s1 = (bx - ax) * (y1 - ay) - (by - ay) * (x1 - ax);
    if ((s0 > 0) === (s1 > 0) || s0 === 0) return 0;
    // intersection must lie within the segment
    const t0 = s0 / (s0 - s1);
    const ix = x0 + (x1 - x0) * t0, iy = y0 + (y1 - y0) * t0;
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
    const u = ((ix - ax) * dx + (iy - ay) * dy) / L2;
    if (u < 0 || u > 1) return 0;
    return s0 > 0 ? 1 : -1;
  },

  // Resolve a contact. n points out of the solid toward the ball; pen is the
  // overlap; (svx, svy) the surface's own velocity. Returns the impact speed
  // (0 if the ball was already separating).
  resolve(b, nx, ny, pen, svx, svy, e, f, kick) {
    b.x += nx * pen; b.y += ny * pen;
    const rvx = b.vx - svx, rvy = b.vy - svy;
    const vn = rvx * nx + rvy * ny;
    if (vn >= 0) return 0;
    let out = -vn * e;
    if (kick && out < kick) out = kick;
    // A resting or rolling contact happens every step, so tangential loss is
    // applied only to real impacts — otherwise a ball on a shallow rail would
    // lose its speed 480 times a second and stall.
    if (-vn < 40) { f = 0; if (!kick) out = 0; }
    const tvx = rvx - vn * nx, tvy = rvy - vn * ny;
    b.vx = svx + tvx * (1 - f) + nx * out;
    b.vy = svy + tvy * (1 - f) + ny * out;
    return -vn;
  },

  // Capsule contact: returns {nx, ny, pen, x, y, t} or null.
  capsule(b, R, ax, ay, bx, by, r) {
    const q = this.closest(b.x, b.y, ax, ay, bx, by);
    const dx = b.x - q.x, dy = b.y - q.y;
    const d2 = dx * dx + dy * dy, rr = R + r;
    if (d2 >= rr * rr) return null;
    const d = Math.sqrt(d2);
    if (d < 1e-9) {
      // centre exactly on the line: push along the segment normal
      const L = Math.hypot(bx - ax, by - ay) || 1;
      return { nx: -(by - ay) / L, ny: (bx - ax) / L, pen: rr, x: q.x, y: q.y, t: q.t };
    }
    return { nx: dx / d, ny: dy / d, pen: rr - d, x: q.x, y: q.y, t: q.t };
  },

  circle(b, R, cx, cy, r) {
    const dx = b.x - cx, dy = b.y - cy;
    const d2 = dx * dx + dy * dy, rr = R + r;
    if (d2 >= rr * rr) return null;
    const d = Math.sqrt(d2);
    if (d < 1e-9) return { nx: 0, ny: -1, pen: rr };
    return { nx: dx / d, ny: dy / d, pen: rr - d };
  },

  // A flipper is a tapered capsule rotating about its pivot. The contact
  // radius is interpolated along it, and the surface velocity at the contact
  // point is ω × r — which is where all of a flipper's power comes from.
  flipperTip(f, ang) {
    return [f.x + Math.cos(ang) * f.len, f.y + Math.sin(ang) * f.len];
  },

  flipperContact(b, R, f, ang, omega) {
    const [tx, ty] = this.flipperTip(f, ang);
    const q = this.closest(b.x, b.y, f.x, f.y, tx, ty);
    const r = f.r0 + (f.r1 - f.r0) * q.t;
    const dx = b.x - q.x, dy = b.y - q.y;
    const d2 = dx * dx + dy * dy, rr = R + r;
    if (d2 >= rr * rr) return null;
    const d = Math.sqrt(d2) || 1e-6;
    const ox = q.x - f.x, oy = q.y - f.y;
    return { nx: dx / d, ny: dy / d, pen: rr - d, svx: -oy * omega, svy: ox * omega, t: q.t };
  },

  // Move a flipper one step toward its target angle. Returns the angular
  // velocity actually achieved, so contacts see the true surface speed.
  stepFlipper(f, st, dt) {
    const target = st.held ? f.up : f.rest;
    const dir = Math.sign(target - st.ang);
    const rate = (st.held ? PHYS.FLIP_UP : PHYS.FLIP_DOWN) * (f.power || 1);
    let next = st.ang + dir * rate * dt;
    if ((dir > 0 && next > target) || (dir < 0 && next < target)) next = target;
    st.omega = (next - st.ang) / dt;
    st.ang = next;
  },

  capSpeed(b) {
    const s2 = b.vx * b.vx + b.vy * b.vy;
    if (s2 > PHYS.MAX_SPEED * PHYS.MAX_SPEED) {
      const k = PHYS.MAX_SPEED / Math.sqrt(s2);
      b.vx *= k; b.vy *= k;
    }
  },

  // Two equal balls (multiball).
  ballBall(a, b, R) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const d2 = dx * dx + dy * dy, rr = 2 * R;
    if (d2 >= rr * rr || d2 < 1e-9) return false;
    const d = Math.sqrt(d2), nx = dx / d, ny = dy / d, pen = (rr - d) / 2;
    a.x -= nx * pen; a.y -= ny * pen; b.x += nx * pen; b.y += ny * pen;
    const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
    if (vn >= 0) return true;
    const j = -vn * 0.92;
    a.vx -= nx * j; a.vy -= ny * j; b.vx += nx * j; b.vy += ny * j;
    return true;
  },
};

if (typeof module !== "undefined") module.exports = { PHYS, Physics };
