import rawPoints from "../track-points.json";

export type Point = { x: number; y: number };

/** Logical world size. Every canvas coordinate in the app uses these units. */
export const WORLD = { w: 560, h: 1280 } as const;

export const RAW: Point[] = rawPoints as Point[];

export const ROAD_WIDTH = 92;

/** Wrapped 3-tap smoothing pass — takes the jaggles out of hand drawn input. */
export function smooth(points: Point[], passes = 3): Point[] {
  let out = points;
  for (let p = 0; p < passes; p++) {
    out = out.map((pt, i, arr) => {
      const prev = arr[(i - 1 + arr.length) % arr.length];
      const next = arr[(i + 1) % arr.length];
      return { x: (prev.x + pt.x * 2 + next.x) / 4, y: (prev.y + pt.y * 2 + next.y) / 4 };
    });
  }
  return out;
}

/** Scales + centres a point cloud inside the world box. */
export function fit(points: Point[], pad = 52): Point[] {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const scale = Math.min((WORLD.w - pad * 2) / (maxX - minX), (WORLD.h - pad * 2) / (maxY - minY));
  const offX = (WORLD.w - (maxX - minX) * scale) / 2;
  const offY = (WORLD.h - (maxY - minY) * scale) / 2;
  return points.map((p) => ({ x: (p.x - minX) * scale + offX, y: (p.y - minY) * scale + offY }));
}

/** Drops points that sit on top of each other — hand drawn input always has some. */
export function dedupe(points: Point[], minDist = 0.25): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && Math.hypot(p.x - last.x, p.y - last.y) < minDist) continue;
    out.push(p);
  }
  return out;
}

/**
 * The hand-drawn loop is not closed — there is an ~83px gap between the last and
 * first point. Smoothing across it produces a kink instead of a corner, which is
 * where the worst curvature spike in the raw input comes from. Filling the gap
 * with interpolated points first makes the input a genuine closed curve.
 */
export function closeLoop(points: Point[], segments = 8): Point[] {
  if (points.length < 2) return points;
  const first = points[0];
  const last = points[points.length - 1];
  const gap = Math.hypot(first.x - last.x, first.y - last.y);
  if (gap < 0.5) return points;

  const out = points.slice();
  for (let i = 1; i <= segments; i++) {
    const t = i / (segments + 1);
    out.push({ x: last.x + (first.x - last.x) * t, y: last.y + (first.y - last.y) * t });
  }
  return out;
}

/**
 * Curvature-constrained relaxation.
 *
 * The hand-drawn input contains kinks tighter than the road is wide — one corner
 * has a 39px radius against a 46px half-width, so its inner edge has *negative*
 * radius and overlaps itself. No steering policy can put four wheels there, and
 * an unconstrained smoother just shrinks the loop and throws away the shape the
 * drawing was going for. So only vertices that violate the radius budget get
 * pulled toward their neighbours; everything else is left alone.
 *
 * The pull has to shrink as the violation does. A fixed aggressive weight makes a
 * band of tight vertices overshoot in lockstep and oscillate forever without ever
 * satisfying the constraint.
 */
export function relaxCurvature(points: Point[], minRadius: number, passes = 3000): Point[] {
  let out = points.map((p) => ({ x: p.x, y: p.y }));
  const n = out.length;
  const SPAN = 3;

  for (let pass = 0; pass < passes; pass++) {
    const next = out.map((p) => ({ x: p.x, y: p.y }));
    let moved = 0;

    for (let i = 0; i < n; i++) {
      const a = out[(i - SPAN + n) % n];
      const b = out[i];
      const c = out[(i + SPAN) % n];
      const A = Math.hypot(b.x - a.x, b.y - a.y);
      const B = Math.hypot(c.x - b.x, c.y - b.y);
      const C = Math.hypot(c.x - a.x, c.y - a.y);
      const area = Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2;
      const radius = area < 1e-9 ? Infinity : (A * B * C) / (4 * area);
      if (radius >= minRadius) continue;

      // Violation ratio in 0…1, so the pull vanishes as the constraint is met.
      const w = 0.25 * (1 - radius / minRadius);
      next[i].x += ((a.x + c.x) / 2 - b.x) * w;
      next[i].y += ((a.y + c.y) / 2 - b.y) * w;
      moved++;
    }

    out = next;
    if (!moved) break;
  }

  return out;
}

/**
 * Uniform resample along the closed polyline — the sampling the AI + physics use.
 *
 * The walk advances by *target position*, not by fixed indices, so degenerate
 * input can leave zero-length segments behind. A single `while` guard then traps
 * the walk on the first such segment and every remaining sample collapses onto
 * one point, which quietly wrecks the arc-length maths everything else relies on.
 * Seeking forward keeps degenerate segments local and correct.
 */
export function resample(points: Point[], count: number): Point[] {
  const n = points.length;
  const segStart: number[] = [];
  const segLen: number[] = [];
  let total = 0;
  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    segStart.push(total);
    segLen.push(Math.hypot(b.x - a.x, b.y - a.y));
    total += segLen[i];
  }
  const step = total / count;
  const out: Point[] = [];
  let seg = 0;
  for (let j = 0; j < count; j++) {
    const target = j * step;
    while (seg < n - 1 && segStart[seg + 1] <= target) seg++;
    let len = segLen[seg];
    let guard = 0;
    while (len < 1e-9 && seg < n - 1 && guard++ < n) {
      seg++;
      len = segLen[seg];
    }
    const a = points[seg];
    const b = points[(seg + 1) % n];
    const t = Math.max(0, Math.min(1, (target - segStart[seg]) / (len || 1)));
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  return out;
}

function pathLength(points: Point[]) {
  let total = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return total;
}

/**
 * Corner budget, enforced on the 600-sample working polyline *before* `fit`
 * scales it into the world box — so treat it as a shaping constraint rather than
 * a spec. The shape it produces lands at a ~90px tightest corner in final world
 * units, comfortably above the ~80px the car can hold at its slowest, which is
 * what actually matters: a circuit whose tightest corner is inside the car's
 * minimum radius can never be completed on the tarmac, whatever the network does.
 */
export const MIN_RADIUS = 160;

/**
 * The canonical track: closed, cleaned, smoothed, curvature-legal, resampled, fitted.
 *
 * Relaxation runs at 600 samples, not 300: curvature has to be measured over a
 * known arc length for the budget to mean anything, and at 300 samples each
 * corner is checked over ~59px of track — coarse enough that the raw input's
 * tightest kink (39px against a 46px road half-width, so its inner edge has
 * *negative* radius and overlaps itself) sails through as "compliant".
 */
const SHAPED = relaxCurvature(resample(smooth(closeLoop(dedupe(RAW)), 4), 600), MIN_RADIUS);

export const TRACK: Point[] = fit(resample(SHAPED, 300), 54);
export const TRACK_LENGTH = pathLength(TRACK);
export const TRACK_LENGTH_KM = TRACK_LENGTH / 2200;
export const START = TRACK[0];
export const START_ANGLE = Math.atan2(TRACK[1].y - TRACK[0].y, TRACK[1].x - TRACK[0].x);

/** Closed path of the centreline, in world units. */
export function centerPath(points: Point[] = TRACK): Path2D {
  const p = new Path2D();
  p.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) p.lineTo(points[i].x, points[i].y);
  p.closePath();
  return p;
}

/**
 * Closest point on the centreline (segment-accurate) for a world position.
 * `hint` restricts the first pass to a window around the previous sample —
 * a car moves ~10px per tick, so this is ~6x cheaper and returns the same
 * answer. It falls back to the exhaustive scan whenever the car is genuinely lost.
 */
export function nearestIndex(p: Point, pts: Point[] = TRACK, hint?: number) {
  const n = pts.length;
  const span = 26;

  const scan = (from: number, to: number, state: { best: number; bestD: number; cx: number; cy: number; t: number }) => {
    for (let k = from; k < to; k++) {
      const i = ((k % n) + n) % n;
      const a = pts[i];
      const b = pts[(i + 1) % n];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len));
      const px = a.x + t * dx;
      const py = a.y + t * dy;
      const d = (p.x - px) ** 2 + (p.y - py) ** 2;
      if (d < state.bestD) {
        state.bestD = d;
        state.best = i;
        state.cx = px;
        state.cy = py;
        state.t = t;
      }
    }
  };

  const state = { best: 0, bestD: Infinity, cx: pts[0].x, cy: pts[0].y, t: 0 };

  if (hint === undefined) {
    scan(0, n, state);
  } else {
    scan(hint - span, hint + span + 1, state);
    // Only trust the window if the car is still plausibly near the track.
    const reach = span * 12;
    if (state.bestD > reach * reach) {
      state.bestD = Infinity;
      scan(0, n, state);
    }
  }

  // `t` is where inside the segment the closest point sits, 0…1. Together with
  // `index` it gives a continuous position along the centreline instead of the
  // quantised integer sample, which is what lap counting needs.
  return { index: state.best, dist: Math.sqrt(state.bestD), cx: state.cx, cy: state.cy, t: state.t };
}

/** Heading of the centreline at a sample index. */
export function angleAt(pts: Point[], i: number) {
  const n = pts.length;
  const a = pts[(i - 1 + n) % n];
  const b = pts[(i + 1) % n];
  return Math.atan2(b.y - a.y, b.x - a.x);
}

/** Curvature magnitude per sample — used to paint kerbs only where it matters. */
export const CURVATURE: number[] = TRACK.map((_, i) => {
  const n = TRACK.length;
  const prev = TRACK[(i - 1 + n) % n];
  const cur = TRACK[i];
  const next = TRACK[(i + 1) % n];
  const a1 = Math.atan2(cur.y - prev.y, cur.x - prev.x);
  const a2 = Math.atan2(next.y - cur.y, next.x - cur.x);
  let d = a2 - a1;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
});

/** Deterministic PRNG so scenery never flickers between renders. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Scenery props (trees, rocks, tufts) placed off the tarmac.
 * Cheap rejection sampling against the centreline.
 */
export type Prop = { x: number; y: number; r: number; kind: 0 | 1 | 2; tone: number };

export function scatterProps(count = 190, seed = 20261004): Prop[] {
  const rnd = mulberry32(seed);
  const props: Prop[] = [];
  const clearance = ROAD_WIDTH / 2 + 22;
  let guard = 0;
  while (props.length < count && guard < count * 40) {
    guard++;
    const x = rnd() * WORLD.w;
    const y = rnd() * WORLD.h;
    if (nearestIndex({ x, y }, TRACK).dist < clearance) continue;
    const roll = rnd();
    const kind: Prop["kind"] = roll < 0.42 ? 0 : roll < 0.78 ? 1 : 2;
    props.push({
      x,
      y,
      r: kind === 0 ? 13 + rnd() * 15 : kind === 1 ? 5 + rnd() * 5 : 8 + rnd() * 8,
      kind,
      tone: rnd(),
    });
  }
  return props;
}

export const PROPS = scatterProps();