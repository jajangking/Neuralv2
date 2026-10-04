import rawPoints from "../track-points.json";

export type Point = { x: number; y: number };

/** Logical world size. Every canvas coordinate in the app uses these units. */
export const WORLD = { w: 560, h: 1280 } as const;

export const RAW: Point[] = rawPoints as Point[];

export const ROAD_WIDTH = 92;

/* ------------------------------------------------------------------ *
 * Painted footprint of the road, in world units
 *
 * The scenery paints the asphalt plus three widening passes — gravel
 * shoulder, soft dark verge — and blurs the outermost one. Every one of them
 * is part of what the driver sees, so `fit` has to reserve all of it or the
 * road runs off the canvas and the track reads as cropped. These numbers are
 * the single source of truth for that: scenery.ts draws them, fit() reserves
 * them.
 * ------------------------------------------------------------------ */

/** Extra width added to the gravel shoulder pass. */
export const ROAD_SHOULDER = 22;
/** Extra width added to the soft dark verge pass. */
export const ROAD_VERGE = 46;
/** Blur radius on that outermost pass, px. */
export const ROAD_VERGE_BLUR = 7;
/**
 * How far past its stroke the blurred verge is worth reserving.
 *
 * The blur tails off over `blur` px; the last of it is a couple of percent of
 * alpha, so the margin only has to cover the part that is actually visible.
 */
export const ROAD_VERGE_SPILL = 4;

/** Half-width of everything the scenery paints around the centreline. */
export const ROAD_HALF_PAINTED = ROAD_WIDTH / 2 + ROAD_VERGE / 2 + ROAD_VERGE_SPILL;

/** Grass left visible between the painted road and the edge of the world box. */
export const GRASS_MARGIN = 8;

/** What `fit` reserves: the painted road plus a band of grass. */
export const TRACK_MARGIN = ROAD_HALF_PAINTED + GRASS_MARGIN;

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

/**
 * Scales + centres a point cloud inside the world box, leaving `pad` world
 * units of room on every side.
 *
 * `pad` defaults to TRACK_MARGIN so the *painted* road (asphalt + shoulder +
 * verge + its blur) lands inside the canvas. Fitting to the centreline alone
 * left the verge hanging 15px off the edge on all four sides.
 */
export function fit(points: Point[], pad = TRACK_MARGIN): Point[] {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  // A straight line (or a single dot) has zero extent on one axis; without the
  // floor that divides by zero and the whole track comes out NaN.
  const spanX = Math.max(1e-3, maxX - minX);
  const spanY = Math.max(1e-3, maxY - minY);
  const scale = Math.min((WORLD.w - pad * 2) / spanX, (WORLD.h - pad * 2) / spanY);
  const offX = (WORLD.w - spanX * scale) / 2;
  const offY = (WORLD.h - spanY * scale) / 2;
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

/** Circumradius through the samples `window` either side of `i`, world units. */
function radiusAt(pts: Point[], i: number, window: number) {
  const n = pts.length;
  const a = pts[(i - window + n) % n];
  const b = pts[i];
  const c = pts[(i + window) % n];
  const A = Math.hypot(b.x - a.x, b.y - a.y);
  const B = Math.hypot(c.x - b.x, c.y - b.y);
  const C = Math.hypot(c.x - a.x, c.y - a.y);
  const area = Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2;
  return area < 1e-9 ? Infinity : (A * B * C) / (4 * area);
}

/** How tight the worst corner is on `pts`, plus where. */
export function tightestRadius(pts: Point[], windows: number[] = [2, 4]) {
  const n = pts.length;
  let radius = Infinity;
  let index = 0;
  for (const w of windows) {
    for (let i = 0; i < n; i++) {
      const r = radiusAt(pts, i, w);
      if (r < radius) {
        radius = r;
        index = i;
      }
    }
  }
  return { radius, index };
}

/**
 * Curvature-weighted Laplacian diffusion — the corner rounder.
 *
 * Every vertex is pulled toward the midpoint of its neighbours, weighted by how
 * far inside `minRadius` it sits: straights are left completely alone, tight
 * corners get rounded. Iterating until the worst violation is inside tolerance
 * spreads a kink over its neighbourhood instead of leaving one sharp sample.
 *
 * Why diffusion and not a chord pull: pulling a single vertex toward the chord
 * across its ±w neighbours carves a V out of the polyline (measured — the
 * "fixed" corner then shows up as a much smaller radius over 1-2 samples), and
 * with a wide budget the loop folds over itself and grows 7x. A Laplacian is a
 * convex combination of neighbours, so it can shorten and round but never fold,
 * and combined with the per-node weight it converges instead of oscillating.
 * The old version here ran 3000 passes of a decaying chord pull, never reached
 * a stopping criterion, and left the track *more* kinked than its input
 * (29 → 56px minimum over a 3-sample window) while shrinking it 42%.
 */
export function relaxCurvature(
  points: Point[],
  minRadius: number,
  windows: number[] = [2, 4],
  passes = 2000,
  tolerance = 0.02,
): Point[] {
  const out = points.map((p) => ({ x: p.x, y: p.y }));
  const n = out.length;
  const widest = Math.max(...windows);
  if (n < widest * 2 + 2) return out;

  const worstViolation = () => {
    let worst = 0;
    for (const w of windows) {
      for (let i = 0; i < n; i++) {
        const r = radiusAt(out, i, w);
        if (r < minRadius) worst = Math.max(worst, 1 - r / minRadius);
      }
    }
    return worst;
  };

  let worst = worstViolation();
  const STEP = 0.35;

  for (let pass = 0; pass < passes && worst > tolerance; pass++) {
    const nx = new Float64Array(n);
    const ny = new Float64Array(n);
    let touched = false;

    for (let i = 0; i < n; i++) {
      let w = 0;
      for (const cand of windows) {
        const r = radiusAt(out, i, cand);
        if (r < minRadius) w = Math.max(w, Math.min(1, 1 - r / minRadius));
      }
      const a = out[(i - 1 + n) % n];
      const b = out[i];
      const c = out[(i + 1) % n];
      nx[i] = b.x + ((a.x + c.x) / 2 - b.x) * w * STEP;
      ny[i] = b.y + ((a.y + c.y) / 2 - b.y) * w * STEP;
      if (w > 0) touched = true;
    }

    if (!touched) break;
    for (let i = 0; i < n; i++) {
      out[i].x = nx[i];
      out[i].y = ny[i];
    }
    worst = worstViolation();
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
 * Corner budget for the shipped track, in world units, measured over ±2 and ±4
 * samples (18px and 36px of arc at 300 samples) so it constrains the radius a
 * car actually drives through, not a single sharp sample.
 *
 * It is set by what the car can hold:
 *  - below ROAD_WIDTH / 2 = 46 the inner edge of the asphalt folds onto itself;
 *  - below wheelbase / tan(STEER_AUTHORITY) ≈ 48 the car cannot follow the
 *    centreline at any speed, so the GA can only learn to cut the corner over
 *    the grass;
 *  - at a ~140px budget the worst corner lands at ~103px, which is about the
 *    radius the car holds at 200px/s (~45 km/h) — tight enough to be a corner,
 *    wide enough to be driven without parking on the apex.
 *
 * The previous pipeline never got near this: it enforced a budget expressed in
 * *drawing* units, before the shape was fitted, and the relaxation it fed (a
 * 3000-pass chord pull) moved the tightest corner the wrong way — the shipped
 * track had a 52px corner against a 48px car limit.
 */
export const MIN_RADIUS = 140;

/** Windows the budget is measured over, in samples. */
export const MIN_RADIUS_WINDOWS = [2, 4];

/**
 * The canonical track: closed, cleaned, smoothed, curvature-legal, resampled
 * and fitted so the whole painted road lands inside the world box.
 *
 * Order matters. Cleaning runs at 600 samples (curvature needs a known arc
 * length for a budget to mean anything). The fit then maps the drawing into the
 * world, and the real corner budget is enforced *after* it, on the 300-sample
 * polyline the game drives — because a radius in drawing units is not a radius
 * in world units, and only the world one decides whether the asphalt folds and
 * whether the car can hold the line. The final fit re-expands the loop after the
 * rounding pulled it in; a uniform scale can only raise every measured radius,
 * so the budget survives it.
 */
const CLEANED = resample(smooth(closeLoop(dedupe(RAW)), 4), 600);
const FITTED = fit(resample(CLEANED, 300), TRACK_MARGIN);
const LEGAL = relaxCurvature(FITTED, MIN_RADIUS, MIN_RADIUS_WINDOWS);

export const TRACK: Point[] = fit(LEGAL, TRACK_MARGIN);
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

/** Radius under which a corner counts as a corner for the kerbs, world units. */
export const KERB_RADIUS = 130;

/**
 * Where the kerbs go: the samples whose local radius is under KERB_RADIUS.
 *
 * Deliberately a radius rule and not a per-sample angle. How much a corner
 * turns between two samples depends on the sampling — after the relaxation
 * spread each corner over more samples, the old |angle| ≥ 0.2 test matched a
 * single sample on the whole lap and the kerbs all but vanished. A radius means
 * the same thing at any sample rate.
 */
export const KERB: boolean[] = TRACK.map(
  (_, i) => Math.min(radiusAt(TRACK, i, 2), radiusAt(TRACK, i, 3)) < KERB_RADIUS,
);

/** Curvature magnitude per sample — the sign tells the kerbs which side to sit. */
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
  // Clear of the painted verge (not just the asphalt) so props are not
  // swallowed by the road's outer passes…
  const clearance = ROAD_HALF_PAINTED + 6;
  // …and clear of the frame, because a tree centred on the last pixel renders
  // as a half tree. Props are up to 28px across.
  const edge = 30;
  let guard = 0;
  while (props.length < count && guard < count * 40) {
    guard++;
    const x = edge + rnd() * (WORLD.w - edge * 2);
    const y = edge + rnd() * (WORLD.h - edge * 2);
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