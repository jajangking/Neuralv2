"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import Stage, { type Scene } from "../components/Stage";
import { IconFlag, IconSteering } from "../components/icons";
import { KMH, MAX_LATERAL, advanceProgress, arcAt, clamp, emptyProgress } from "../lib/drive";
import { drawCar, renderScenery } from "../lib/scenery";
import { ROAD_WIDTH, START_ANGLE, TRACK, TRACK_LENGTH, TRACK_LENGTH_KM, angleAt, nearestIndex } from "../lib/track";

const MAX_FORWARD = 620;

type Car = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  steer: number;
  gear: "D" | "R";
};

type Skid = { x: number; y: number; angle: number; life: number };

type Telemetry = {
  speed: number;
  lateral: number;
  gear: "D" | "R";
  progress: number;
  laps: number;
  onRoad: boolean;
  drift: number;
  offroad: number;
};

const KEYS = ["w", "a", "s", "d", "r", "arrowup", "arrowdown", "arrowleft", "arrowright", " "];

const emptyTelemetry: Telemetry = {
  speed: 0,
  lateral: 0,
  gear: "D",
  progress: 0,
  laps: 0,
  onRoad: true,
  drift: 0,
  offroad: 0,
};

export default function ManualDrive() {
  const bgRef = useRef<HTMLCanvasElement | null>(null);
  const carRef = useRef<Car>({
    x: TRACK[0].x,
    y: TRACK[0].y,
    vx: 0,
    vy: 0,
    angle: START_ANGLE,
    steer: 0,
    gear: "D",
  });
  const keysRef = useRef<Record<string, boolean>>({});
  const skidsRef = useRef<Skid[]>([]);
  const poseRef = useRef({ ...emptyProgress(), laps: 0, lastIndex: 0, offroad: 0, drift: 0 });
  const teleRef = useRef<Telemetry>(emptyTelemetry);
  const deckRef = useRef<HTMLDivElement | null>(null);
  const [snap, setSnap] = useState<Telemetry>(emptyTelemetry);
  const [pressed, setPressed] = useState<Record<string, boolean>>({});

  const invalidate = useCallback(() => {
    bgRef.current = null;
  }, []);

  /* ---------------- input ---------------- */
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (!KEYS.includes(key)) return;
      keysRef.current[key] = true;
      if (key === "r") carRef.current.gear = carRef.current.gear === "D" ? "R" : "D";
      setPressed((p) => ({ ...p, [key]: true }));
      e.preventDefault();
    };
    const up = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (!KEYS.includes(key)) return;
      keysRef.current[key] = false;
      setPressed((p) => ({ ...p, [key]: false }));
    };
    const blur = () => {
      keysRef.current = {};
      setPressed({});
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setSnap({ ...teleRef.current }), 100);
    return () => window.clearInterval(id);
  }, []);

  /* ---------------- touch controls (delegated) ---------------- */
  useEffect(() => {
    const deck = deckRef.current;
    if (!deck) return;

    const keyOf = (target: EventTarget | null) =>
      (target as HTMLElement | null)?.closest<HTMLElement>("[data-key]")?.dataset.key ?? null;

    const setKey = (key: string, value: boolean) => {
      keysRef.current[key] = value;
      setPressed((prev) => (prev[key] === value ? prev : { ...prev, [key]: value }));
    };

    const down = (e: PointerEvent) => {
      const key = keyOf(e.target);
      if (!key) return;
      e.preventDefault();
      const el = e.target as HTMLElement;
      el.setPointerCapture?.(e.pointerId);
      if (key === "gear") {
        carRef.current.gear = carRef.current.gear === "D" ? "R" : "D";
        return;
      }
      if (key === "reset") {
        carRef.current = {
          x: TRACK[0].x,
          y: TRACK[0].y,
          vx: 0,
          vy: 0,
          angle: angleAt(TRACK, 0),
          steer: 0,
          gear: "D",
        };
        poseRef.current = { ...emptyProgress(), laps: 0, lastIndex: 0, offroad: 0, drift: 0 };
        skidsRef.current = [];
        return;
      }
      setKey(key, true);
    };

    const up = (e: PointerEvent) => {
      const key = keyOf(e.target);
      if (key && key !== "gear" && key !== "reset") setKey(key, false);
    };

    const releaseAll = () => {
      if (Object.values(keysRef.current).some(Boolean)) {
        keysRef.current = {};
        setPressed({});
      }
    };

    deck.addEventListener("pointerdown", down);
    deck.addEventListener("pointerup", up);
    deck.addEventListener("pointercancel", up);
    window.addEventListener("pointerup", releaseAll);
    window.addEventListener("blur", releaseAll);
    return () => {
      deck.removeEventListener("pointerdown", down);
      deck.removeEventListener("pointerup", up);
      deck.removeEventListener("pointercancel", up);
      window.removeEventListener("pointerup", releaseAll);
      window.removeEventListener("blur", releaseAll);
    };
  }, []);

  /* ---------------- simulation + render ---------------- */
  const draw = useCallback((scene: Scene) => {
    const { ctx, dt } = scene;
    if (!bgRef.current) {
      const layer = document.createElement("canvas");
      renderScenery(layer, scene.k);
      bgRef.current = layer;
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(bgRef.current, 0, 0);
    ctx.restore();

    const step = dt > 0 ? Math.min(dt, 0.034) : 0;
    const car = carRef.current;
    const keys = keysRef.current;
    const pose = poseRef.current;

    const up = !!(keys.w || keys.arrowup);
    const downKey = !!(keys.s || keys.arrowdown);
    const left = !!(keys.a || keys.arrowleft);
    const right = !!(keys.d || keys.arrowright);
    const handbrake = !!keys[" "];

    if (step > 0) {
      const steerTarget = (right ? 1 : 0) - (left ? 1 : 0);
      const speedForward = car.vx * Math.cos(car.angle) + car.vy * Math.sin(car.angle);
      const steerLimit = 0.58 / (1 + Math.abs(speedForward) / 210);
      car.steer += (steerTarget * steerLimit - car.steer) * Math.min(1, step * 9);

      // lateral grip → drift when the handbrake is pulled
      let lateral = -car.vx * Math.sin(car.angle) + car.vy * Math.cos(car.angle);
      const grip = handbrake ? 1.6 : 11;
      lateral *= Math.exp(-grip * step);

      let force = 0;
      if (car.gear === "D") {
        if (up) force += 380;
        if (downKey && speedForward > 0) force -= 560;
      } else {
        if (up) force -= 280;
        if (downKey && speedForward < 0) force += 560;
      }

      const drag = 0.0019 * speedForward * Math.abs(speedForward);
      let next = speedForward + (force - drag) * step;
      // Rolling resistance opposes *motion*, not the direction the nose points —
      // in reverse the two differ, and the old `speedForward`-signed term pushed
      // the car forward, so it settled at a standstill instead of backing up.
      const rolling = Math.abs(next) > 1 ? 24 * Math.sign(next) : 0;
      next = clamp(next - rolling * step, -190, MAX_FORWARD);
      if (downKey && Math.sign(next) !== Math.sign(speedForward) && speedForward !== 0) next = 0;
      if (!up && !downKey && Math.abs(next) < 16) next = 0;

      car.angle += (next / 34) * Math.tan(car.steer) * step;
      car.vx = Math.cos(car.angle) * next - Math.sin(car.angle) * lateral;
      car.vy = Math.sin(car.angle) * next + Math.cos(car.angle) * lateral;
      // where the car was *before* this tick — `advanceProgress` caps the lap
      // credit at the distance actually covered, so this has to be sampled
      // before the move or the cap is always zero
      const from = { x: car.x, y: car.y };
      car.x += car.vx * step;
      car.y += car.vy * step;

      const hit = nearestIndex({ x: car.x, y: car.y }, TRACK);
      const wall = ROAD_WIDTH / 2 - 12;
      if (hit.dist > wall) {
        const nx = (car.x - hit.cx) / (hit.dist || 1);
        const ny = (car.y - hit.cy) / (hit.dist || 1);
        car.x = hit.cx + nx * wall;
        car.y = hit.cy + ny * wall;
        const f = car.vx * Math.cos(car.angle) + car.vy * Math.sin(car.angle);
        const l = -car.vx * Math.sin(car.angle) + car.vy * Math.cos(car.angle);
        const bounceF = f * 0.9;
        const bounceL = -l * 0.42;
        car.vx = Math.cos(car.angle) * bounceF - Math.sin(car.angle) * bounceL;
        car.vy = Math.sin(car.angle) * bounceF + Math.cos(car.angle) * bounceL;
      }

      // progress + offroad bookkeeping
      advanceProgress(poseRef.current, arcAt(hit.index, hit.t), hit.dist < MAX_LATERAL, Math.hypot(car.x - from.x, car.y - from.y));
      if (hit.dist >= MAX_LATERAL) pose.offroad = Math.min(6, pose.offroad + step);
      else pose.offroad = Math.max(0, pose.offroad - step * 1.5);
      pose.lastIndex = hit.index;
      if (pose.progress >= TRACK_LENGTH) {
        pose.progress -= TRACK_LENGTH;
        pose.laps += 1;
      }

      const drifting = Math.abs(lateral) > 46;
      pose.drift = clamp(pose.drift + (drifting ? step * 2.6 : -step * 2.4), 0, 1);
      if (drifting && Math.abs(next) > 120) {
        for (const side of [-1, 1]) {
          skidsRef.current.push({
            x: car.x - Math.cos(car.angle) * 17 - Math.sin(car.angle) * side * 13,
            y: car.y - Math.sin(car.angle) * 17 + Math.cos(car.angle) * side * 13,
            angle: car.angle + car.steer * 0.4,
            life: 1,
          });
        }
        if (skidsRef.current.length > 420) skidsRef.current.splice(0, skidsRef.current.length - 420);
      }
    }

    // skid marks
    if (skidsRef.current.length) {
      ctx.save();
      ctx.strokeStyle = "rgba(18, 20, 24, 0.5)";
      ctx.lineCap = "round";
      ctx.lineWidth = 3.2;
      for (const s of skidsRef.current) {
        ctx.globalAlpha = s.life * 0.6;
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(s.x - Math.cos(s.angle) * 9, s.y - Math.sin(s.angle) * 9);
        ctx.stroke();
      }
      ctx.restore();
      const alive: Skid[] = [];
      for (const s of skidsRef.current) {
        const life = s.life - step * 0.22;
        if (life > 0) alive.push({ x: s.x, y: s.y, angle: s.angle, life });
      }
      skidsRef.current = alive;
    }

    // off-road tint follows the car
    const near = nearestIndex({ x: car.x, y: car.y }, TRACK);
    if (near.dist > MAX_LATERAL) {
      ctx.save();
      ctx.globalAlpha = Math.min(0.5, (near.dist - MAX_LATERAL) / 26);
      ctx.fillStyle = "#4a3a1c";
      ctx.beginPath();
      ctx.arc(car.x, car.y, 46, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    drawCar(ctx, car.x, car.y, {
      angle: car.angle,
      steer: car.steer,
      throttle: up ? 1 : 0,
      brake: downKey ? 1 : 0,
      speed: Math.hypot(car.vx, car.vy),
      drift: pose.drift,
    });

    teleRef.current = {
      speed: Math.round(Math.hypot(car.vx, car.vy) * KMH),
      lateral: Math.round(near.dist),
      gear: car.gear,
      progress: clamp(pose.progress / TRACK_LENGTH, 0, 1),
      laps: pose.laps,
      onRoad: near.dist < MAX_LATERAL,
      drift: pose.drift,
      offroad: pose.offroad,
    };
  }, []);

const downKey = pressed.arrowdown || pressed.s;
  const progressPct = Math.round(snap.progress * 100);

  return (
    <div className="game-root">
      <div className="game-stage">
        <Stage draw={draw} onResize={invalidate} loop>
          <div className="stage-veil" />

          <div className="hud">
            <div className="hud-row">
              <div className="hud-stack">
                <div className="glass speedo">
                  <span className={`speedo-value mono${downKey ? " is-braking" : ""}`}>{snap.speed}</span>
                  <span className="speedo-unit">km/h</span>
                </div>
                {snap.drift > 0.25 ? (
                  <span className="chip is-violet">
                    <i className="dot is-live" /> drift
                  </span>
                ) : (
                  !snap.onRoad && (
                    <span className="chip is-danger">
                      <i className="dot is-live" /> off-road
                    </span>
                  )
                )}
              </div>

              <div className="hud-stack hud-stack-right">
                <div className={`gear${snap.gear === "R" ? " is-reverse" : ""}`}>{snap.gear}</div>
                <div className="stat-row">
                  <div className="glass stat">
                    <div className="stat-label">Lap</div>
                    <div className="stat-value">{snap.laps + 1}</div>
                  </div>
                  <div className="glass stat">
                    <div className="stat-label">Garis</div>
                    <div className="stat-value mono">{snap.lateral}m</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="hud-row" style={{ alignItems: "flex-end" }}>
              <div className="glass lap">
                <div className="lap-head">
                  <span>
                    <IconFlag size={11} /> {TRACK_LENGTH_KM.toFixed(2)} km
                  </span>
                  <b className="mono">{progressPct}%</b>
                </div>
                <div className="bar">
                  <i className="bar-fill is-sky" style={{ width: `${progressPct}%` }} />
                </div>
              </div>
              <Link className="chip" href="/ai">
                <IconSteering size={13} /> mode AI
              </Link>
            </div>
          </div>
        </Stage>
      </div>

      <div className="game-deck" ref={deckRef}>
        <div className="pad">
          <button
            data-key="arrowleft"
            className={`key${pressed.arrowleft || pressed.a ? " is-down" : ""}`}
            aria-label="Belok kiri"
          >
            ◀
          </button>
          <button
            data-key="arrowright"
            className={`key${pressed.arrowright || pressed.d ? " is-down" : ""}`}
            aria-label="Belok kanan"
          >
            ▶
          </button>
        </div>

        <div className="deck-hint">
          <span className="kbd">WASD</span>
          <span className="kbd">↑↓←→</span>
          <span className="kbd">Space</span>
          <span className="kbd">R</span>
          <span style={{ fontSize: 11, color: "var(--faint)" }}>spasi = drift · R = gigi</span>
        </div>

        <div className="pad" style={{ alignItems: "flex-end" }}>
          <div className="pad-col">
            <button data-key="gear" className="key key-gear" aria-label="Ganti gigi">
              {snap.gear}
            </button>
            <button data-key="reset" className="btn btn-sm btn-ghost">
              Reset
            </button>
          </div>
          <div className="pad">
            <button
              data-key=" "
              className={`key key-drift${pressed[" "] ? " is-down" : ""}`}
              aria-label="Drift"
            >
              DRIFT
            </button>
            <button
              data-key="arrowdown"
              className={`key key-brake${downKey ? " is-down" : ""}`}
              aria-label="Rem"
            >
              ⬇
            </button>
            <button
              data-key="arrowup"
              className={`key key-gas${pressed.arrowup || pressed.w ? " is-down" : ""}`}
              aria-label="Gas"
            >
              ⬆
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}