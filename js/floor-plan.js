// FloorPlan holds the drawing's data and renders it with rough.js.
//
// Data model, in grid units rather than pixels:
//   path   - every snapped footstep in order, e.g. [{c: 3, r: 5}, ...]
//            (c = column, r = row; both are grid-node indices)
//   walls  - unique wall segments between consecutive steps
//   rooms  - closed polygons, found when your path returns to a node
//            you already stood on. A room can be marked double height.
//
// Pixels only appear in render(). Keeping the data in grid units means
// the same plan could later be exported as SVG, DXF or JSON at any scale.

const W = 1200;            // canvas size in pixels (4:3, like the webcam)
const H = 900;
export const COLS = 16;    // grid cells across
export const ROWS = 12;    // grid cells deep
const CELL = 60;           // pixels per grid cell
const X0 = (W - COLS * CELL) / 2;  // top-left corner of the grid
const Y0 = 40;

const PAPER = "#f4f1ea";
const GRAPHITE = "#2b2b2b";
const GRID_INK = "rgba(70, 100, 150, 0.16)";
const FONT = '"Architects Daughter", cursive';

// rough.js redraws randomly every time unless you give it a seed. Every
// wall and room gets its own seed so the sketch doesn't jitter on redraw.
let nextSeed = 1;

const sameNode = (a, b) => a.c === b.c && a.r === b.r;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

// Shoelace formula: signed area of a polygon, in grid cells.
function polygonArea(poly) {
  let sum = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    sum += a.c * b.r - b.c * a.r;
  }
  return sum / 2;
}

// Ray casting: shoot a ray to the right and count edge crossings.
// An odd count means the point is inside.
function pointInPolygon(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if ((a.r > p.r) !== (b.r > p.r) &&
        p.c < ((b.c - a.c) * (p.r - a.r)) / (b.r - a.r) + a.c) {
      inside = !inside;
    }
  }
  return inside;
}

export class FloorPlan {
  constructor(canvas) {
    this.canvas = canvas;
    canvas.width = W;
    canvas.height = H;
    this.ctx = canvas.getContext("2d");
    this.rc = rough.canvas(canvas);
    // Orthogonal mode turns a diagonal step into an L (two straight walls),
    // the way most real plans are drawn. Set false for free-angle walls.
    this.orthogonal = true;
    this.meta = { bpm: 124 };
    this.clear();
  }

  clear() {
    this.path = [];
    this.walls = new Map(); // key "c1,r1|c2,r2" -> {a, b, seed}
    this.rooms = [];
  }

  get stats() {
    return {
      steps: this.path.length,
      walls: this.walls.size,
      rooms: this.rooms.length,
      doubles: this.rooms.filter((r) => r.double).length,
    };
  }

  // ---------- Coordinates ----------
  // u, v are 0..1 positions on the floor (left->right, far->near).

  snap(u, v) {
    return {
      c: clamp(Math.round(u * COLS), 0, COLS),
      r: clamp(Math.round(v * ROWS), 0, ROWS),
    };
  }

  toPx(c, r) {
    return { x: X0 + c * CELL, y: Y0 + r * CELL };
  }

  uvToPx(u, v) {
    return this.toPx(clamp(u, 0, 1) * COLS, clamp(v, 0, 1) * ROWS);
  }

  // ---------- Building ----------

  // Record one footstep. Returns true if the plan changed.
  addStep(u, v) {
    const p = this.snap(u, v);
    const last = this.path[this.path.length - 1];
    if (last && sameNode(last, p)) return false; // stayed on the same node

    if (last && this.orthogonal && last.c !== p.c && last.r !== p.r) {
      this.pushNode({ c: p.c, r: last.r }); // go across first, then forward
    }
    this.pushNode(p);
    return true;
  }

  pushNode(p) {
    const last = this.path[this.path.length - 1];
    if (last) this.addWall(last, p);
    this.path.push(p);
    this.detectRoom();
  }

  addWall(a, b) {
    // Sort the endpoints so A->B and B->A are the same wall.
    const [p, q] = [a, b].sort((m, n) => m.c - n.c || m.r - n.r);
    const key = `${p.c},${p.r}|${q.c},${q.r}`;
    if (!this.walls.has(key)) this.walls.set(key, { a: p, b: q, seed: nextSeed++ });
  }

  // If the newest node was visited before, the steps in between form a loop.
  detectRoom() {
    const n = this.path.length;
    const p = this.path[n - 1];
    for (let i = n - 2; i >= 0; i--) {
      if (sameNode(this.path[i], p)) {
        const poly = this.path.slice(i, n - 1);
        if (poly.length >= 3 && Math.abs(polygonArea(poly)) >= 1) this.addRoom(poly);
        return;
      }
    }
  }

  addRoom(poly) {
    const key = poly.map((p) => `${p.c},${p.r}`).sort().join(" ");
    const existing = this.rooms.find((r) => r.key === key);
    if (existing) return existing;
    const room = {
      key,
      poly,
      area: Math.abs(polygonArea(poly)),
      double: false,
      seed: nextSeed++,
      number: this.rooms.length + 1,
    };
    this.rooms.push(room);
    return room;
  }

  // The drop: make the room you're standing in double height. If you're
  // not inside a closed room yet, enclose the area of your last 16 steps
  // (4 bars) with walls and make that the room. Pressing again toggles.
  markDrop(u, v) {
    const p = { c: clamp(u, 0, 1) * COLS, r: clamp(v, 0, 1) * ROWS };
    const containing = this.rooms
      .filter((room) => pointInPolygon(p, room.poly))
      .sort((a, b) => a.area - b.area); // smallest room wins
    let room = containing[0];
    if (!room) {
      const poly = this.enclosure(p);
      for (let i = 0; i < poly.length; i++) this.addWall(poly[i], poly[(i + 1) % poly.length]);
      room = this.addRoom(poly);
    }
    room.double = !room.double;
    return room;
  }

  // Bounding rectangle of the recent steps plus the grid cell you're in.
  enclosure(p) {
    let minC = Math.floor(p.c), maxC = Math.ceil(p.c);
    let minR = Math.floor(p.r), maxR = Math.ceil(p.r);
    for (const s of this.path.slice(-16)) {
      minC = Math.min(minC, s.c); maxC = Math.max(maxC, s.c);
      minR = Math.min(minR, s.r); maxR = Math.max(maxR, s.r);
    }
    if (maxC === minC) maxC < COLS ? maxC++ : minC--;
    if (maxR === minR) maxR < ROWS ? maxR++ : minR--;
    return [
      { c: minC, r: minR }, { c: maxC, r: minR },
      { c: maxC, r: maxR }, { c: minC, r: maxR },
    ];
  }

  // ---------- Drawing ----------

  render() {
    const ctx = this.ctx;
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, W, H);

    this.drawGrid();
    for (const room of this.rooms) if (room.double) this.drawHatch(room);
    for (const wall of this.walls.values()) this.drawWall(wall);
    for (const room of this.rooms) this.drawLabel(room);
    this.drawTitleBlock();
  }

  drawGrid() {
    const ctx = this.ctx;
    ctx.strokeStyle = GRID_INK;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let c = 0; c <= COLS; c++) {
      const { x } = this.toPx(c, 0);
      ctx.moveTo(x, Y0);
      ctx.lineTo(x, Y0 + ROWS * CELL);
    }
    for (let r = 0; r <= ROWS; r++) {
      const { y } = this.toPx(0, r);
      ctx.moveTo(X0, y);
      ctx.lineTo(X0 + COLS * CELL, y);
    }
    ctx.stroke();
  }

  drawWall(wall) {
    const a = this.toPx(wall.a.c, wall.a.r);
    const b = this.toPx(wall.b.c, wall.b.r);
    this.rc.line(a.x, a.y, b.x, b.y, {
      seed: wall.seed,
      stroke: GRAPHITE,
      strokeWidth: 2.6,
      roughness: 1.3,  // how wobbly the line is
      bowing: 1.2,     // how much it curves, like a freehand stroke
    });
  }

  // Diagonal hatching is the plan convention for "something different
  // happens in section here". We use it for the double-height space.
  drawHatch(room) {
    const pts = room.poly.map((p) => {
      const { x, y } = this.toPx(p.c, p.r);
      return [x, y];
    });
    this.rc.polygon(pts, {
      seed: room.seed,
      stroke: "none",
      fill: "rgba(43, 43, 43, 0.75)",
      fillStyle: "hachure",
      hachureAngle: 45,
      hachureGap: 10,
      fillWeight: 1.2,
      roughness: 1.4,
    });
  }

  drawLabel(room) {
    const ctx = this.ctx;
    // Average of the vertices: good enough for a label position.
    const c = room.poly.reduce((s, p) => s + p.c, 0) / room.poly.length;
    const r = room.poly.reduce((s, p) => s + p.r, 0) / room.poly.length;
    const { x, y } = this.toPx(c, r);
    const lines = [`ROOM ${String(room.number).padStart(2, "0")}`];
    if (room.double) lines.push("DOUBLE HEIGHT");

    ctx.font = `20px ${FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const width = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 16;
    const height = lines.length * 24 + 6;
    if (room.double) {
      // Paper-colored backing so the label reads over the hatching.
      ctx.fillStyle = PAPER;
      ctx.fillRect(x - width / 2, y - height / 2, width, height);
    }
    ctx.fillStyle = GRAPHITE;
    lines.forEach((line, i) => ctx.fillText(line, x, y + (i - (lines.length - 1) / 2) * 24));
  }

  // The box in the corner of every architectural drawing sheet.
  drawTitleBlock() {
    const ctx = this.ctx;
    const top = Y0 + ROWS * CELL + 24;
    const left = X0;
    const width = COLS * CELL;
    const height = H - top - 20;
    this.rc.rectangle(left, top, width, height, {
      seed: 9999, stroke: GRAPHITE, strokeWidth: 1.6, roughness: 0.8,
    });
    this.rc.line(left + width * 0.62, top, left + width * 0.62, top + height, {
      seed: 9998, stroke: GRAPHITE, strokeWidth: 1.2, roughness: 0.8,
    });

    ctx.fillStyle = GRAPHITE;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.font = `30px ${FONT}`;
    ctx.fillText("HOUSE MUSIC BUILDS A HOUSE", left + 20, top + height * 0.36);
    ctx.font = `18px ${FONT}`;
    ctx.fillText("GROUND FLOOR PLAN · 1 GRID SQUARE = 1 STEP", left + 20, top + height * 0.72);

    const { steps, rooms } = this.stats;
    const date = new Date().toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
    const col = left + width * 0.62 + 20;
    ctx.fillText(`TEMPO  ${this.meta.bpm} BPM`, col, top + height * 0.25);
    ctx.fillText(`STEPS  ${steps}   ROOMS  ${rooms}`, col, top + height * 0.5);
    ctx.fillText(`DATE   ${date.toUpperCase()}`, col, top + height * 0.75);
  }
}
