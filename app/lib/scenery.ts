import {
  CURVATURE,
  PROPS,
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
  /** device pixels per world unit */
  k: number;
  /** canvas size in device pixels */
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
  const { ctx, k } = s;
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
  ctx.lineWidth = 26 * k;
  for (let i = -2; i < 8; i++) {
    ctx.beginPath();
    const y = i * (h / 5.4);
    ctx.moveTo(-40, y);
    ctx.quadraticCurveTo(w / 2, y - 26 * k * (i % 2 === 0 ? 1 : -1), w + 40, y);
    ctx.stroke();
  }
  ctx.restore();

  // grain
  ctx.fillStyle = "rgba(255,255,255,0.035)";
  const step = 11 * k;
  for (let y = 0; y < h; y += step) {
    for (let x = ((y / step) % 2) * step * 0.5; x < w; x += step) {
      ctx.fillRect(x, y, 1 * k, 1 * k);
    }
  }
}

function paintProp(s: Surface, p: Prop) {
  const { ctx, k } = s;
  const r = p.r;
  // contact shadow
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.scale(1, 0.42);
  circle(ctx, 3 * k, 5 * k, r * 1.12);
  ctx.fill();
  ctx.restore();

  if (p.kind === 0) {
    // tree: layered canopy
    ctx.fillStyle = "#12291a";
    circle(ctx, p.x, p.y + 1.5 * k, r);
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
    ctx.lineWidth = 1.6 * k;
    ctx.lineCap = "round";
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.moveTo(p.x + i * 3 * k, p.y + r * 0.5);
      ctx.quadraticCurveTo(p.x + i * 5 * k, p.y - r * 0.2, p.x + i * 7 * k, p.y - r * 0.7);
      ctx.stroke();
    }
  }
}

function paintRoad(s: Surface) {
  const { ctx, k } = s;
  const center = centerPath(TRACK);

  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  // wet-ish outer verge
  ctx.save();
  ctx.strokeStyle = "rgba(0,0,0,0.34)";
  ctx.filter = `blur(${7 * k}px)`;
  ctx.lineWidth = ROAD_WIDTH + 46;
  ctx.stroke(center);
  ctx.restore();

  // gravel shoulder
  ctx.strokeStyle = PALETTE.gravel;
  ctx.lineWidth = ROAD_WIDTH + 22;
  ctx.stroke(center);

  // asphalt base
  ctx.strokeStyle = PALETTE.asphaltEdge;
  ctx.lineWidth = ROAD_WIDTH;
  ctx.stroke(center);

  // build-up: wide, blurred pass fakes the camber
  ctx.save();
  ctx.filter = `blur(${5 * k}px)`;
  ctx.strokeStyle = PALETTE.asphaltMid;
  ctx.lineWidth = ROAD_WIDTH * 0.74;
  ctx.stroke(center);
  ctx.strokeStyle = PALETTE.asphaltCore;
  ctx.lineWidth = ROAD_WIDTH * 0.4;
  ctx.stroke(center);
  ctx.restore();

  // crisp edge lines
  ctx.strokeStyle = "rgba(236, 244, 255, 0.34)";
  ctx.lineWidth = 1.6 * k;
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
  ctx.lineWidth = 3.4 * k;
  ctx.stroke(center);
  ctx.setLineDash([]);

  // kerbs where the track actually turns
  const n = TRACK.length;
  for (let i = 0; i < n; i++) {
    const bend = CURVATURE[i];
    if (Math.abs(bend) < 0.2) continue;
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
    ctx.fillRect(-2 * k, -7 * k, 8 * k, 14 * k);
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
  ctx.lineWidth = 1.4 * k;
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
  const s: Surface = { ctx, k: scale, w, h };

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

export function drawCar(ctx: CanvasRenderingContext2D, x: number, y: number, look: CarLook, k = 1) {
  const { angle, steer, throttle, brake, speed, drift } = look;
  ctx.save();
  ctx.translate(x, y);

  // ground shadow, offset with heading
  ctx.save();
  ctx.rotate(angle);
  ctx.fillStyle = PALETTE.shadow;
  ctx.filter = `blur(${4 * k}px)`;
  roundRect(ctx, -26 * k + 3 * k, -14 * k + 4 * k, 54 * k, 30 * k, 9 * k);
  ctx.fill();
  ctx.filter = "none";
  ctx.restore();

  ctx.rotate(angle);

  // brake glow
  if (brake > 0.05) {
    const glow = ctx.createRadialGradient(-28 * k, 0, 1 * k, -28 * k, 0, 22 * k);
    glow.addColorStop(0, `rgba(255, 70, 70, ${0.42 * brake})`);
    glow.addColorStop(1, "transparent");
    ctx.fillStyle = glow;
    ctx.fillRect(-52 * k, -24 * k, 44 * k, 48 * k);
  }

  // wheels
  const wheel = (wx: number, wy: number, rot: number) => {
    ctx.save();
    ctx.translate(wx * k, wy * k);
    ctx.rotate(rot);
    ctx.fillStyle = PALETTE.tyre;
    roundRect(ctx, -8 * k, -4.2 * k, 16 * k, 8.4 * k, 3 * k);
    ctx.fill();
    ctx.fillStyle = PALETTE.rim;
    ctx.fillRect(-2.4 * k, -3.4 * k, 4.8 * k, 6.8 * k);
    ctx.restore();
  };
  const steerAngle = steer * 0.42;
  wheel(16, -13.5, steerAngle);
  wheel(16, 13.5, steerAngle);
  wheel(-17, -13.5, 0);
  wheel(-17, 13.5, 0);

  // chassis
  const body = ctx.createLinearGradient(0, -14 * k, 0, 14 * k);
  body.addColorStop(0, PALETTE.carTop);
  body.addColorStop(0.5, "#ef4038");
  body.addColorStop(1, PALETTE.carBottom);
  ctx.fillStyle = body;
  roundRect(ctx, -27 * k, -13 * k, 55 * k, 26 * k, 8.5 * k);
  ctx.fill();

  // top-down specular sheen
  const sheen = ctx.createLinearGradient(-27 * k, -13 * k, 27 * k, 13 * k);
  sheen.addColorStop(0, "rgba(255,255,255,0.34)");
  sheen.addColorStop(0.4, "rgba(255,255,255,0.05)");
  sheen.addColorStop(1, "rgba(0,0,0,0.16)");
  ctx.fillStyle = sheen;
  roundRect(ctx, -27 * k, -13 * k, 55 * k, 26 * k, 8.5 * k);
  ctx.fill();

  // nose + splitter
  ctx.fillStyle = PALETTE.carTrim;
  roundRect(ctx, 25 * k, -8 * k, 4.5 * k, 16 * k, 2 * k);
  ctx.fill();
  ctx.fillStyle = PALETTE.carDark;
  roundRect(ctx, -30 * k, -10 * k, 5 * k, 20 * k, 2 * k);
  ctx.fill();

  // cockpit
  ctx.fillStyle = PALETTE.carGlass;
  roundRect(ctx, -8 * k, -8.5 * k, 18 * k, 17 * k, 5.5 * k);
  ctx.fill();
  ctx.fillStyle = PALETTE.carGlassHi;
  ctx.globalAlpha = 0.55;
  roundRect(ctx, 0, -7 * k, 5 * k, 14 * k, 2.5 * k);
  ctx.fill();
  ctx.globalAlpha = 1;

  // racing stripe
  ctx.fillStyle = "rgba(255,255,255,0.86)";
  ctx.fillRect(-24 * k, -1.6 * k, 48 * k, 3.2 * k);

  // spoiler
  ctx.fillStyle = PALETTE.carDark;
  roundRect(ctx, -32 * k, -17 * k, 5.5 * k, 34 * k, 2.5 * k);
  ctx.fill();

  // headlights + tail lights
  const headAura = throttle > 0.05 ? 0.55 : 0.3;
  ctx.fillStyle = `rgba(255, 243, 208, ${headAura})`;
  roundRect(ctx, 24 * k, -10.5 * k, 4 * k, 7 * k, 1.6 * k);
  ctx.fill();
  roundRect(ctx, 24 * k, 3.5 * k, 4 * k, 7 * k, 1.6 * k);
  ctx.fill();
  ctx.fillStyle = brake > 0.05 ? "#ff5252" : "#a4161f";
  ctx.fillRect(-29.5 * k, -9.5 * k, 2.6 * k, 6.5 * k);
  ctx.fillRect(-29.5 * k, 3 * k, 2.6 * k, 6.5 * k);

  // speed shimmer
  if (speed > 380) {
    ctx.globalAlpha = Math.min(0.5, (speed - 380) / 700);
    ctx.fillStyle = "#dff3ff";
    for (let i = 0; i < 3; i++) {
      const x0 = (30 + i * 9) * k;
      ctx.fillRect(x0, (-9 + i * 7) * k, 16 * k, 1.6 * k);
    }
    ctx.globalAlpha = 1;
  }

  // drift smoke at the rear axle
  if (drift > 0.02) {
    const smoke = ctx.createRadialGradient(-26 * k, 0, 1 * k, -26 * k, 0, 30 * k);
    smoke.addColorStop(0, `rgba(226, 232, 245, ${0.4 * drift})`);
    smoke.addColorStop(1, "transparent");
    ctx.fillStyle = smoke;
    ctx.fillRect(-58 * k, -32 * k, 62 * k, 64 * k);
  }

  ctx.restore();
}