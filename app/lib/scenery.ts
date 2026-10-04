import {
  CURVATURE,
  KERB,
  PROPS,
  ROAD_SHOULDER,
  ROAD_VERGE,
  ROAD_VERGE_BLUR,
  ROAD_WIDTH,
  START,
  START_ANGLE,
  TRACK,
  WORLD,
  centerPath,
  type Prop,
} from "./track";

export type Surface = {
  ctx: CanvasRenderingContext2D;
  /** canvas size in device pixels (only used for the grass grain loop) */
  w: number;
  h: number;
};

export const PALETTE = {
  grassTop: "#20452b",
  grassBottom: "#122b1b",
  grassLight: "rgba(140, 220, 150, 0.07)",
  gravel: "#171b21",
  asphaltEdge: "#23262c",
  asphaltMid: "#31353d",
  asphaltCore: "#3a3f48",
  paint: "rgba(238, 243, 255, 0.82)",
  kerbA: "#e2493c",
  kerbB: "#f2f5fa",
  line: "rgba(255, 255, 255, 0.9)",
  startA: "#f4f7ff",
  startB: "#1a1e25",
  carTop: "#ff5f52",
  carBottom: "#c2202c",
  carGlass: "#101c2b",
  carGlassHi: "#7fd4ff",
  carTrim: "#ffb3a8",
  carDark: "#5c0f18",
  tyre: "#101216",
  rim: "#c9cfda",
  shadow: "rgba(0, 0, 0, 0.42)",
  headlight: "rgba(255, 236, 190, 0.5)",
  tail: "rgba(255, 70, 70, 0.85)",
} as const;

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function circle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
}

/** Soft ground texture — baked into the scenery layer, never re-drawn per frame. */
function paintGrass(s: Surface) {
  const { ctx } = s;
  const w = WORLD.w;
  const h = WORLD.h;
  const grad = ctx.createLinearGradient(0, 0, w * 0.35, h);
  grad.addColorStop(0, PALETTE.grassTop);
  grad.addColorStop(0.55, "#1a3a25");
  grad.addColorStop(1, PALETTE.grassBottom);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // light shafts from the top-left
  const sun = ctx.createRadialGradient(w * 0.2, -h * 0.1, 10, w * 0.2, -h * 0.1, h * 1.1);
  sun.addColorStop(0, "rgba(214, 255, 176, 0.16)");
  sun.addColorStop(1, "transparent");
  ctx.fillStyle = sun;
  ctx.fillRect(0, 0, w, h);

  // mowing stripes, gently curved
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = PALETTE.grassLight;
  ctx.lineWidth = 26;
  for (let i = -2; i < 8; i++) {
    ctx.beginPath();
    const y = i * (h / 5.4);
    ctx.moveTo(-40, y);
    ctx.quadraticCurveTo(w / 2, y - 26 * (i % 2 === 0 ? 1 : -1), w + 40, y);
    ctx.stroke();
  }
  ctx.restore();

  // grain
  ctx.fillStyle = "rgba(255,255,255,0.035)";
  const step = 11;
  for (let y = 0; y < h; y += step) {
    for (let x = ((y / step) % 2) * step * 0.5; x < w; x += step) {
      ctx.fillRect(x, y, 1, 1);
    }
  }
}

function paintProp(s: Surface, p: Prop) {
  const { ctx } = s;
  const r = p.r;
  // contact shadow
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.scale(1, 0.42);
  circle(ctx, 3, 5, r * 1.12);
  ctx.fill();
  ctx.restore();

  if (p.kind === 0) {
    // tree: layered canopy
    ctx.fillStyle = "#12291a";
    circle(ctx, p.x, p.y + 1.5, r);
    ctx.fill();
    ctx.fillStyle = "#1d5232";
    circle(ctx, p.x - r * 0.12, p.y - r * 0.12, r * 0.82);
    ctx.fill();
    ctx.fillStyle = "#2a7345";
    circle(ctx, p.x - r * 0.28, p.y - r * 0.34, r * 0.44);
    ctx.fill();
    ctx.fillStyle = "rgba(168, 232, 160, 0.5)";
    circle(ctx, p.x - r * 0.38, p.y - r * 0.44, r * 0.17);
    ctx.fill();
  } else if (p.kind === 1) {
    // rock
    ctx.fillStyle = p.tone > 0.5 ? "#4a5058" : "#3c4148";
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.tone * Math.PI);
    ctx.beginPath();
    ctx.moveTo(-r, r * 0.5);
    ctx.lineTo(-r * 0.4, -r * 0.75);
    ctx.lineTo(r * 0.7, -r * 0.6);
    ctx.lineTo(r, r * 0.55);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.14)";
    ctx.beginPath();
    ctx.moveTo(-r * 0.4, -r * 0.75);
    ctx.lineTo(r * 0.7, -r * 0.6);
    ctx.lineTo(r * 0.1, -r * 0.05);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  } else {
    // grass tuft
    ctx.strokeStyle = "rgba(150, 224, 158, 0.55)";
    ctx.lineWidth = 1.6;
    ctx.lineCap = "round";
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.moveTo(p.x + i * 3, p.y + r * 0.5);
      ctx.quadraticCurveTo(p.x + i * 5, p.y - r * 0.2, p.x + i * 7, p.y - r * 0.7);
      ctx.stroke();
    }
  }
}

function paintRoad(s: Surface) {
  const { ctx } = s;
  const center = centerPath(TRACK);

  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  // wet-ish outer verge — the widths here are what fit() reserves around the
  // centreline (see ROAD_HALF_PAINTED in track.ts), so the whole road always
  // lands inside the world box
  ctx.save();
  ctx.strokeStyle = "rgba(0,0,0,0.34)";
  ctx.filter = `blur(${ROAD_VERGE_BLUR}px)`;
  ctx.lineWidth = ROAD_WIDTH + ROAD_VERGE;
  ctx.stroke(center);
  ctx.restore();

  // gravel shoulder
  ctx.strokeStyle = PALETTE.gravel;
  ctx.lineWidth = ROAD_WIDTH + ROAD_SHOULDER;
  ctx.stroke(center);

  // asphalt base
  ctx.strokeStyle = PALETTE.asphaltEdge;
  ctx.lineWidth = ROAD_WIDTH;
  ctx.stroke(center);

  // build-up: wide, blurred pass fakes the camber
  ctx.save();
  ctx.filter = `blur(${5}px)`;
  ctx.strokeStyle = PALETTE.asphaltMid;
  ctx.lineWidth = ROAD_WIDTH * 0.74;
  ctx.stroke(center);
  ctx.strokeStyle = PALETTE.asphaltCore;
  ctx.lineWidth = ROAD_WIDTH * 0.4;
  ctx.stroke(center);
  ctx.restore();

  // crisp edge lines
  ctx.strokeStyle = "rgba(236, 244, 255, 0.34)";
  ctx.lineWidth = 1.6;
  ctx.stroke(center);

  // racing line: subtle darker wear where cars go
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = "rgba(12, 14, 18, 0.5)";
  ctx.setLineDash([46, 40]);
  ctx.lineWidth = ROAD_WIDTH * 0.42;
  ctx.stroke(center);
  ctx.setLineDash([]);
  ctx.restore();

  // centre dashes
  ctx.strokeStyle = PALETTE.paint;
  ctx.setLineDash([24, 30]);
  ctx.lineWidth = 3.4;
  ctx.stroke(center);
  ctx.setLineDash([]);

  // kerbs where the track actually turns
  const n = TRACK.length;
  for (let i = 0; i < n; i++) {
    if (!KERB[i]) continue;
    const bend = CURVATURE[i];
    const p = TRACK[i];
    const q = TRACK[(i + 1) % n];
    const ang = Math.atan2(q.y - p.y, q.x - p.x);
    const side = bend > 0 ? 1 : -1;
    const nx = -Math.sin(ang);
    const ny = Math.cos(ang);
    const offset = ROAD_WIDTH / 2 + 5.5;
    ctx.save();
    ctx.translate(p.x + nx * offset * side, p.y + ny * offset * side);
    ctx.rotate(ang);
    ctx.fillStyle = i % 4 < 2 ? PALETTE.kerbA : PALETTE.kerbB;
    ctx.fillRect(-2, -7, 8, 14);
    ctx.restore();
  }

  // start / finish gantry line
  ctx.save();
  ctx.translate(START.x, START.y);
  ctx.rotate(START_ANGLE);
  const half = ROAD_WIDTH / 2;
  const cell = 10;
  const band = 13;
  ctx.fillStyle = PALETTE.startB;
  ctx.fillRect(-band / 2, -half, band, half * 2);
  const rows = Math.ceil((half * 2) / cell);
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < 2; j++) {
      if ((i + j) % 2 !== 0) continue;
      ctx.fillStyle = PALETTE.startA;
      ctx.fillRect(-band / 2 + j * (band / 2), -half + i * cell, band / 2, cell);
    }
  }
  ctx.strokeStyle = "rgba(255,255,255,0.45)";
  ctx.lineWidth = 1.4;
  ctx.strokeRect(-band / 2, -half, band, half * 2);
  ctx.restore();
}

/** Everything static about a scene, rendered once into an offscreen bitmap. */
export function renderScenery(canvas: HTMLCanvasElement, scale: number) {
  const w = Math.max(1, Math.round(WORLD.w * scale));
  const h = Math.max(1, Math.round(WORLD.h * scale));
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  const s: Surface = { ctx, w, h };

  paintGrass(s);
  for (const p of PROPS) paintProp(s, p);
  paintRoad(s);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

/* ------------------------------------------------------------------ *
 * Car
 * ------------------------------------------------------------------ */

export type CarLook = {
  angle: number;
  /** -1 hard left … 1 hard right */
  steer: number;
  /** 0…1 how hard the throttle is being mashed */
  throttle: number;
  brake: number;
  /** total speed in world units / s */
  speed: number;
  drift: number;
};

/**
 * Draws the car in *world* units — the caller's ctx is already transformed, so
 * nothing here may be multiplied by the device scale. (It used to be, and on a
 * 2x screen the car came out twice the size and wider than the road, with its
 * wheels floating off the body.)
 */
export function drawCar(ctx: CanvasRenderingContext2D, x: number, y: number, look: CarLook) {
  const { angle, steer, throttle, brake, speed, drift } = look;
  ctx.save();
  ctx.translate(x, y);

  // ground shadow, offset with heading
  ctx.save();
  ctx.rotate(angle);
  ctx.fillStyle = PALETTE.shadow;
  ctx.filter = `blur(${4}px)`;
  roundRect(ctx, -26 + 3, -14 + 4, 54, 30, 9);
  ctx.fill();
  ctx.filter = "none";
  ctx.restore();

  ctx.rotate(angle);

  // brake glow
  if (brake > 0.05) {
    const glow = ctx.createRadialGradient(-28, 0, 1, -28, 0, 22);
    glow.addColorStop(0, `rgba(255, 70, 70, ${0.42 * brake})`);
    glow.addColorStop(1, "transparent");
    ctx.fillStyle = glow;
    ctx.fillRect(-52, -24, 44, 48);
  }

  // wheels
  const wheel = (wx: number, wy: number, rot: number) => {
    ctx.save();
    ctx.translate(wx, wy);
    ctx.rotate(rot);
    ctx.fillStyle = PALETTE.tyre;
    roundRect(ctx, -8, -4.2, 16, 8.4, 3);
    ctx.fill();
    ctx.fillStyle = PALETTE.rim;
    ctx.fillRect(-2.4, -3.4, 4.8, 6.8);
    ctx.restore();
  };
  const steerAngle = steer * 0.42;
  wheel(16, -13.5, steerAngle);
  wheel(16, 13.5, steerAngle);
  wheel(-17, -13.5, 0);
  wheel(-17, 13.5, 0);

  // chassis
  const body = ctx.createLinearGradient(0, -14, 0, 14);
  body.addColorStop(0, PALETTE.carTop);
  body.addColorStop(0.5, "#ef4038");
  body.addColorStop(1, PALETTE.carBottom);
  ctx.fillStyle = body;
  roundRect(ctx, -27, -13, 55, 26, 8.5);
  ctx.fill();

  // top-down specular sheen
  const sheen = ctx.createLinearGradient(-27, -13, 27, 13);
  sheen.addColorStop(0, "rgba(255,255,255,0.34)");
  sheen.addColorStop(0.4, "rgba(255,255,255,0.05)");
  sheen.addColorStop(1, "rgba(0,0,0,0.16)");
  ctx.fillStyle = sheen;
  roundRect(ctx, -27, -13, 55, 26, 8.5);
  ctx.fill();

  // nose + splitter
  ctx.fillStyle = PALETTE.carTrim;
  roundRect(ctx, 25, -8, 4.5, 16, 2);
  ctx.fill();
  ctx.fillStyle = PALETTE.carDark;
  roundRect(ctx, -30, -10, 5, 20, 2);
  ctx.fill();

  // cockpit
  ctx.fillStyle = PALETTE.carGlass;
  roundRect(ctx, -8, -8.5, 18, 17, 5.5);
  ctx.fill();
  ctx.fillStyle = PALETTE.carGlassHi;
  ctx.globalAlpha = 0.55;
  roundRect(ctx, 0, -7, 5, 14, 2.5);
  ctx.fill();
  ctx.globalAlpha = 1;

  // racing stripe
  ctx.fillStyle = "rgba(255,255,255,0.86)";
  ctx.fillRect(-24, -1.6, 48, 3.2);

  // spoiler
  ctx.fillStyle = PALETTE.carDark;
  roundRect(ctx, -32, -17, 5.5, 34, 2.5);
  ctx.fill();

  // headlights + tail lights
  const headAura = throttle > 0.05 ? 0.55 : 0.3;
  ctx.fillStyle = `rgba(255, 243, 208, ${headAura})`;
  roundRect(ctx, 24, -10.5, 4, 7, 1.6);
  ctx.fill();
  roundRect(ctx, 24, 3.5, 4, 7, 1.6);
  ctx.fill();
  ctx.fillStyle = brake > 0.05 ? "#ff5252" : "#a4161f";
  ctx.fillRect(-29.5, -9.5, 2.6, 6.5);
  ctx.fillRect(-29.5, 3, 2.6, 6.5);

  // speed shimmer
  if (speed > 380) {
    ctx.globalAlpha = Math.min(0.5, (speed - 380) / 700);
    ctx.fillStyle = "#dff3ff";
    for (let i = 0; i < 3; i++) {
      const x0 = 30 + i * 9;
      ctx.fillRect(x0, -9 + i * 7, 16, 1.6);
    }
    ctx.globalAlpha = 1;
  }

  // drift smoke at the rear axle
  if (drift > 0.02) {
    const smoke = ctx.createRadialGradient(-26, 0, 1, -26, 0, 30);
    smoke.addColorStop(0, `rgba(226, 232, 245, ${0.4 * drift})`);
    smoke.addColorStop(1, "transparent");
    ctx.fillStyle = smoke;
    ctx.fillRect(-58, -32, 62, 64);
  }

  ctx.restore();
}