import { forward, type Brain } from "./net";
import { ROAD_WIDTH, TRACK, TRACK_LENGTH, angleAt, nearestIndex, type Point } from "./track";

export const MAX_SPEED = 600;
export const MAX_LATERAL = ROAD_WIDTH / 2 - 8;
export const KMH = 0.22;

/** Everything the agent "sees", derived from its pose on the track. */
export type Sense = {
  index: number;
  dist: number;
  /** continuous distance along the centreline, px */
  arc: number;
  /** signed offset from the centreline, px. + = left of the racing line, − = right. */
  lateral: number;
  headingError: number;
  curvature: number;
  onRoad: boolean;
  ahead: Point;
  edge: Point;
  normal: { x: number; y: number };
  /** the 5 network inputs, all in −1…1 */
  inputs: number[];
};

const LOOKAHEAD = 6;

export function senseAt(x: number, y: number, angle: number, speed: number, pts: Point[] = TRACK, hint?: number): Sense {
  const n = pts.length;
  const near = nearestIndex({ x, y }, pts, hint);
  const i = near.index;
  const ahead = pts[(i + LOOKAHEAD) % n];
  const prev = pts[(i - 2 + n) % n];
  const cur = pts[(i + 2) % n];

  let headingError = Math.atan2(ahead.y - y, ahead.x - x) - angle;
  while (headingError > Math.PI) headingError -= Math.PI * 2;
  while (headingError < -Math.PI) headingError += Math.PI * 2;

  let curvature = Math.atan2(cur.y - prev.y, cur.x - prev.x);
  while (curvature > Math.PI) curvature -= Math.PI * 2;
  while (curvature < -Math.PI) curvature += Math.PI * 2;

  const nx = -Math.sin(angleAt(pts, i));
  const ny = Math.cos(angleAt(pts, i));
  const edge = { x: pts[i].x + nx * MAX_LATERAL, y: pts[i].y + ny * MAX_LATERAL };
  // Signed: without it the network cannot tell left from right and can never
  // steer back onto the road once it has dropped a wheel.
  const lateral = (x - near.cx) * nx + (y - near.cy) * ny;

  return {
    index: i,
    dist: near.dist,
    arc: arcAt(i, near.t, n),
    lateral,
    headingError,
    curvature,
    onRoad: near.dist < MAX_LATERAL,
    ahead,
    edge,
    normal: { x: nx, y: ny },
    inputs: [
      Math.min(1, Math.abs(speed) / MAX_SPEED),
      clamp(headingError / (Math.PI / 2), -1, 1),
      clamp(lateral / (MAX_LATERAL * 1.5), -1, 1),
      Math.cos(curvature - angle),
      Math.sin(curvature - angle),
    ],
  };
}

export type Kinematics = {
  x: number;
  y: number;
  angle: number;
  v: number;
};

export function startPose(): Kinematics {
  return { x: TRACK[0].x, y: TRACK[0].y, angle: angleAt(TRACK, 0), v: 0 };
}

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/* ------------------------------------------------------------------ */
/* Shared vehicle model                                                 */
/* ------------------------------------------------------------------ */

const DT = 1 / 60;

const ENGINE = 440;
const ROLLING = 24;
const ROLLING_OFFROAD = 96;
const DRAG = 0.0018;
const DRAG_OFFROAD = 0.0052;
const STEER_AUTHORITY = 0.62;

/** Effective road-wheel angle (rad) for a raw steer output at a given speed. */
export function steerAngle(steerOut: number, speed: number) {
  // Steering authority falls away with speed so the car cannot spin at the top end.
  const limit = STEER_AUTHORITY / (1 + Math.abs(speed) / 220);
  return clamp(steerOut * limit, -0.9, 0.9);
}

/**
 * One physics tick. The trainer (`simulateRun`) and the on-screen champion run
 * both call this, so what you watch is exactly what was scored.
 *
 * `steerOut` / `throttleOut` are raw network outputs in −1…1.
 */
export function driveStep(k: Kinematics, onRoad: boolean, steerOut: number, throttleOut: number, step = DT) {
  const throttle = clamp((throttleOut + 1) / 2, 0, 1);
  k.angle += (k.v / 34) * Math.tan(steerAngle(steerOut, k.v)) * step;

  // Grass is slow, but it is a drag — not a wall. A hard brake here makes the
  // off-road state absorbing: the car stalls and, with no steering authority
  // left, can never rejoin.
  const speed = Math.abs(k.v);
  const drag = (onRoad ? DRAG : DRAG + DRAG_OFFROAD) * k.v * speed;
  const rolling = speed > 1 ? (onRoad ? ROLLING : ROLLING_OFFROAD) * Math.sign(k.v) : 0;
  k.v = clamp(k.v + (throttle * ENGINE - drag - rolling) * step, -120, MAX_SPEED);

  k.x += Math.cos(k.angle) * k.v * step;
  k.y += Math.sin(k.angle) * k.v * step;
}

/* ------------------------------------------------------------------ */
/* Lap bookkeeping + fitness                                            */
/* ------------------------------------------------------------------ */

/**
 * TRACK is a uniform resample, so sample `i` sits at a predictable arc length and
 * `Sense.arc` is a true distance-along-the-track in px rather than a sample index.
 */
const PX_PER_INDEX = TRACK_LENGTH / TRACK.length;

/** `arc` is where the car is; `progress` is credited distance. */
export type Progress = { arc: number; progress: number };

/**
 * Where a fresh car sits along the track.
 *
 * The nearest-point search is handed the start index as its hint so it only
 * looks at the local window — without it, both `freshDrive()` and the lap
 * counter fell back to an exhaustive scan of all 300 samples every time they
 * were called.
 */
export function emptyProgress(): Progress {
  const k = startPose();
  return { arc: senseAt(k.x, k.y, k.angle, 0, TRACK, 0).arc, progress: 0 };
}

/**
 * Credits forward progress, capped by the distance the car actually covered.
 *
 * `arc` and `travelled` are both in pixels, and `p.progress` accumulates in
 * pixels up to TRACK_LENGTH — one clean unit everywhere, because mixing "sample
 * index" and "arc length" is how a lap counter silently ends up reporting 9%.
 *
 * Both halves matter. Counting raw index jumps lets the car cut a hairpin across
 * the grass and get paid for track it never drove — the GA finds that shortcut
 * within about six generations. Capping by `travelled` means the only way to bank
 * a lap is to actually drive it.
 */
export function advanceProgress(p: Progress, arc: number, onRoad: boolean, travelled: number) {
  let delta = arc - p.arc;
  if (delta < -TRACK_LENGTH / 2) delta += TRACK_LENGTH;
  if (delta > TRACK_LENGTH / 2) delta -= TRACK_LENGTH;
  if (onRoad && delta > 0) p.progress += Math.min(delta, travelled);
  p.arc = arc;
}

/** Arc length of a track sample, in px. `t` is the position inside the segment. */
export function arcAt(index: number, t: number, samples = TRACK.length) {
  return (index + t) * (TRACK_LENGTH / samples);
}

export type DriveState = Kinematics & Progress & {
  laps: number;
  elapsed: number;
  drift: number;
  /** sample index from the previous tick — only used as a search hint */
  lastIndex: number;
  offroadTime: number;
};

export const freshDrive = (laps = 0): DriveState => ({
  ...startPose(),
  ...emptyProgress(),
  laps,
  elapsed: 0,
  drift: 0,
  lastIndex: 0,
  offroadTime: 0,
});

export type Run = {
  fitness: number;
  /** 0…1 of one lap completed */
  progress: number;
  /** fraction of the run spent off the tarmac */
  offroad: number;
  path: Point[];
  speed: number[];
  /** mean travelled distance per tick, px/s */
  averageSpeed: number;
};

/**
 * Fitness scale. Progress dominates; grass and dawdling are surcharges.
 *
 * The grass surcharge is deliberately smaller than a lap. Set it high and the
 * GA discovers that crawling along the centreline at 14 km/h is unbeatable —
 * a safe, boring optimum the search cannot climb out of, because every faster
 * brain immediately runs wide and eats a penalty bigger than the whole lap.
 */
const LAP_REWARD = 100;
const OFFROAD_PENALTY = 35;
const PACE_BONUS = 25;
const PACE_REFERENCE = PX_PER_INDEX * 24; // px/s — roughly 57 km/h

/** Headless rollout of a brain — this is what the genetic loop scores. */
export function simulateRun(brain: Brain, steps = 1200): Run {
  const k = startPose();
  const path: Point[] = [];
  const speed: number[] = [];
  const progress = emptyProgress();
  let offroad = 0;
  let distance = 0;
  let lastIndex = 0;

  for (let step = 0; step < steps; step++) {
    const sense = senseAt(k.x, k.y, k.angle, k.v, TRACK, lastIndex);
    if (!sense.onRoad) offroad++;

    const out = forward(brain, sense.inputs).outputs;
    const from = { x: k.x, y: k.y };
    driveStep(k, sense.onRoad, out[0], out[1]);

    const travelled = Math.hypot(k.x - from.x, k.y - from.y);
    advanceProgress(progress, sense.arc, sense.onRoad, travelled);
    distance += travelled;
    lastIndex = sense.index;

    path.push({ x: k.x, y: k.y });
    speed.push(Math.abs(k.v));
  }

  const laps = progress.progress / TRACK_LENGTH;
  const offroadFraction = offroad / steps;
  const averageSpeed = distance / (steps * DT); // px per tick → px/s
  const pace = Math.min(1.5, averageSpeed / PACE_REFERENCE);

  return {
    fitness: laps * LAP_REWARD + laps * pace * PACE_BONUS - offroadFraction * OFFROAD_PENALTY,
    progress: Math.min(1, Math.max(0, laps)),
    offroad: offroadFraction,
    path,
    speed,
    averageSpeed,
  };
}
