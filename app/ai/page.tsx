"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AppShell from "../components/AppShell";
import Stage, { type Scene } from "../components/Stage";
import {
  IconCpu,
  IconFlag,
  IconNetwork,
  IconPulse,
  IconRadar,
  IconRefresh,
  IconSteering,
} from "../components/icons";
import {
  KMH,
  MAX_LATERAL,
  MAX_SPEED,
  advanceProgress,
  clamp,
  driveStep,
  freshDrive,
  senseAt,
  simulateRun,
  steerAngle,
  type DriveState,
  type Run,
  type Sense,
} from "../lib/drive";
import { GENERATIONS, POPULATION, STEPS, nextPopulation } from "../lib/ga";
import {
  BRAIN_SIZE,
  HIDDEN,
  INPUTS,
  INPUT_LABELS,
  OUTPUTS,
  OUTPUT_LABELS,
  forward,
  randomBrain,
  type Activation,
  type Brain,
} from "../lib/net";
import { drawCar, renderScenery } from "../lib/scenery";
import { TRACK, TRACK_LENGTH, TRACK_LENGTH_KM } from "../lib/track";

const DT = 1 / 60;

type Phase = "training" | "drive";

type Telemetry = {
  speedKmh: number;
  throttle: number;
  steer: number;
  brake: number;
  progress: number;
  laps: number;
  drift: number;
  /** seconds into the current lap */
  lapTime: number;
  /** quickest completed lap, 0 until one is finished */
  bestLap: number;
  sense: Sense | null;
  activation: Activation | null;
};

const emptyTelemetry: Telemetry = {
  speedKmh: 0,
  throttle: 0,
  steer: 0,
  brake: 0,
  progress: 0,
  laps: 0,
  drift: 0,
  lapTime: 0,
  bestLap: 0,
  sense: null,
  activation: null,
};

const formatLap = (seconds: number) => (seconds > 0 ? `${seconds.toFixed(2)}s` : "–");

/* ------------------------------------------------------------------ */

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) {
    return <div style={{ height: 54, display: "grid", placeItems: "center", fontSize: 12, color: "var(--faint)" }}>menunggu data…</div>;
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * 100;
      const y = 40 - ((v - min) / span) * 34;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
  const area = `0,44 ${pts} 100,44`;
  return (
    <svg viewBox="0 0 100 46" width="100%" height="54" preserveAspectRatio="none" role="img" aria-label="Grafik fitness">
      <defs>
        <linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(201,255,74,0.34)" />
          <stop offset="100%" stopColor="rgba(201,255,74,0)" />
        </linearGradient>
      </defs>
      <line x1="0" y1="6" x2="100" y2="6" stroke="rgba(255,255,255,0.07)" />
      <line x1="0" y1="23" x2="100" y2="23" stroke="rgba(255,255,255,0.07)" />
      <line x1="0" y1="40" x2="100" y2="40" stroke="rgba(255,255,255,0.07)" />
      <polygon points={area} fill="url(#spark-fill)" />
      <polyline points={pts} fill="none" stroke="var(--accent)" strokeWidth="1.4" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

function NetworkDiagram({ brain, activation }: { brain: Brain | null; activation: Activation | null }) {
  const w = 100;
  const h = 62;
  const colX = [7, 50, 93];
  const rows = [INPUTS, HIDDEN, OUTPUTS];
  const pos = (c: number, r: number) => ({
    x: colX[c],
    y: rows[c] === 1 ? h / 2 : 7 + (r * (h - 14)) / (rows[c] - 1),
  });

  const links: { x1: number; y1: number; x2: number; y2: number; w: number; on: boolean }[] = [];
  if (brain) {
    for (let h = 0; h < HIDDEN; h++) {
      for (let i = 0; i < INPUTS; i++) {
        const a = pos(0, i);
        const b = pos(1, h);
        links.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, w: brain[i * HIDDEN + h], on: activation ? Math.abs(activation.hidden[h]) > 0.35 : false });
      }
    }
    for (let o = 0; o < OUTPUTS; o++) {
      for (let h = 0; h < HIDDEN; h++) {
        const a = pos(1, h);
        const b = pos(2, o);
        links.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, w: brain[INPUTS * HIDDEN + HIDDEN + h * OUTPUTS + o], on: activation ? Math.abs(activation.outputs[o]) > 0.35 : false });
      }
    }
  }

  const nodeFill = (c: number, r: number) => {
    const act = c === 0 ? activation?.inputs[r] : c === 1 ? activation?.hidden[r] : activation?.outputs[r];
    if (act === undefined) return "rgba(255,255,255,0.18)";
    const t = (act + 1) / 2;
    return `rgba(${Math.round(92 + 137 * t)}, ${Math.round(200 + 55 * t)}, ${Math.round(255 - 205 * t)}, 0.95)`;
  };

  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height="104" role="img" aria-label="Diagram jaringan saraf">
      {links.map((l, idx) => (
        <line
          key={idx}
          x1={l.x1}
          y1={l.y1}
          x2={l.x2}
          y2={l.y2}
          stroke={l.on ? "rgba(201,255,74,0.75)" : "rgba(155,123,255,0.24)"}
          strokeWidth={Math.max(0.3, Math.min(1.1, Math.abs(l.w) / 1.6))}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {[0, 1, 2].map((c) =>
        Array.from({ length: rows[c] }, (_, r) => {
          const p = pos(c, r);
          return <circle key={`${c}-${r}`} cx={p.x} cy={p.y} r={c === 1 ? 2.3 : 2.8} fill={nodeFill(c, r)} />;
        }),
      )}
    </svg>
  );
}

/* ------------------------------------------------------------------ */

export default function NeuralDrive() {
  const [runId, setRunId] = useState(0);
  const [phase, setPhase] = useState<Phase>("training");
  const [gen, setGen] = useState(0);
  const [best, setBest] = useState(0);
  const [progress, setProgress] = useState(0);
  const [history, setHistory] = useState<number[]>([]);
  const [champion, setChampion] = useState<Brain | null>(null);
  const [snap, setSnap] = useState<Telemetry>(emptyTelemetry);

  const bgRef = useRef<HTMLCanvasElement | null>(null);
  const brainRef = useRef<Brain | null>(null);
  const ghostRef = useRef<{ path: { x: number; y: number }[]; speed: number[] }>({ path: [], speed: [] });
  const poseRef = useRef<DriveState>(freshDrive());
  const teleRef = useRef<Telemetry>(emptyTelemetry);
  const bestLapRef = useRef(0);

  const invalidate = useCallback(() => {
    bgRef.current = null;
  }, []);

  /* ---------------- training ---------------- */
  useEffect(() => {
    let raf = 0;
    let generation = 0;
    const championRef = { current: randomBrain() };
    const scoreRef = { current: -Infinity };
    let pool: Brain[] = [];

    const nextGen = () => {
      generation += 1;
      pool = nextPopulation(generation === 1 ? null : championRef.current);
    };
    nextGen();

    const tick = () => {
      const deadline = performance.now() + 9;
      let genBest: Brain | null = null;
      let genBestScore = -Infinity;
      let genBestRun: Run | null = null;

      while (pool.length && performance.now() < deadline) {
        const candidate = pool.pop()!;
        const run = simulateRun(candidate, STEPS);
        if (run.fitness > genBestScore) {
          genBestScore = run.fitness;
          genBest = candidate;
          genBestRun = run;
        }
      }

      if (!pool.length) {
        if (genBest && genBestScore > scoreRef.current) {
          scoreRef.current = genBestScore;
          championRef.current = genBest;
          brainRef.current = genBest;
          setChampion(genBest);
          ghostRef.current = { path: genBestRun?.path ?? [], speed: genBestRun?.speed ?? [] };
        }
        setGen(generation);
        setBest(scoreRef.current);
        setProgress(generation / GENERATIONS);
        setHistory((h) => [...h, scoreRef.current].slice(-40));

        if (generation >= GENERATIONS) {
          poseRef.current = freshDrive();
          teleRef.current = { ...emptyTelemetry };
          setPhase("drive");
          return;
        }
        nextGen();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [runId]);

  /* ---------------- low frequency HUD sync ---------------- */
  useEffect(() => {
    const id = window.setInterval(() => setSnap({ ...teleRef.current }), 100);
    return () => window.clearInterval(id);
  }, []);

  /* ---------------- canvas ---------------- */
  const draw = useCallback(
    (scene: Scene) => {
      const { ctx, dt, time } = scene;
      if (!bgRef.current) {
        const layer = document.createElement("canvas");
        renderScenery(layer, scene.k);
        bgRef.current = layer;
      }
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(bgRef.current, 0, 0);
      ctx.restore();

      const driving = phase === "drive";
      const pose = poseRef.current;
      const brain = brainRef.current;

      let car = { x: pose.x, y: pose.y, angle: pose.angle };
      let speed = pose.v;
      let steer = 0;
      let throttle = 0;
      const brake = 0;
      let drift = pose.drift;
      let sense: Sense | null = null;
      let activation: Activation | null = null;

      if (driving && brain) {
        const step = dt > 0 ? Math.min(dt, 1 / 30) : DT;
        sense = senseAt(pose.x, pose.y, pose.angle, pose.v, TRACK, pose.lastIndex);
        activation = forward(brain, sense.inputs);
        steer = activation.outputs[0];
        throttle = (activation.outputs[1] + 1) / 2;

        const from = { x: pose.x, y: pose.y };
        driveStep(pose, sense.onRoad, steer, throttle, step);

        if (!sense.onRoad) {
          drift = Math.min(1, drift + step * 2.4);
          pose.offroadTime += step;
        } else {
          drift = Math.max(0, drift - step * 2);
          pose.offroadTime = Math.max(0, pose.offroadTime - step * 1.6);
        }
        pose.v = clamp(pose.v, -120, MAX_SPEED);

        advanceProgress(pose, sense.arc, sense.onRoad, Math.hypot(pose.x - from.x, pose.y - from.y));
        pose.lastIndex = sense.index;
        if (pose.progress >= TRACK_LENGTH) {
          pose.progress -= TRACK_LENGTH;
          pose.laps += 1;
          // `elapsed` is the lap clock, so it has to start again on the line —
          // it used to run on, which meant the very first lap timed the whole
          // session and the drive was thrown away after 75s no matter how well
          // the champion was doing.
          if (pose.elapsed > 0) {
            bestLapRef.current = bestLapRef.current > 0 ? Math.min(bestLapRef.current, pose.elapsed) : pose.elapsed;
          }
          pose.elapsed = 0;
        }
        pose.elapsed += step;
        pose.drift = drift;

        if (pose.offroadTime > 3.2 || pose.elapsed > 75) {
          poseRef.current = freshDrive(pose.laps);
        }

        car = { x: pose.x, y: pose.y, angle: pose.angle };
        speed = pose.v;
      } else {
        // training: replay the champion so the screen is never static
        const ghost = ghostRef.current;
        if (ghost.path.length) {
          const idx = Math.floor(time * 60) % ghost.path.length;
          // heading comes from the *next* sample of the recorded lap; at the
          // end of the rollout the ghost restarts from the top of the lap it
          // was recorded over, so the two ends are neighbours on the track
          const nextIdx = (idx + 1) % ghost.path.length;
          const p = ghost.path[idx];
          const nxt = ghost.path[nextIdx];
          car = { x: p.x, y: p.y, angle: Math.atan2(nxt.y - p.y, nxt.x - p.x) };
          speed = ghost.speed[idx] ?? 0;
          steer = Math.sin(time * 2.2) * 0.08;
          throttle = 0.7;
          sense = senseAt(car.x, car.y, car.angle, speed);
          activation = brain ? forward(brain, sense.inputs) : null;
        } else {
          const pulse = 0.5 + 0.5 * Math.sin(time * 3);
          ctx.save();
          ctx.globalAlpha = 0.35 + pulse * 0.3;
          ctx.strokeStyle = "rgba(201,255,74,0.9)";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(0, ((time * 180) % 1280) - 40);
          ctx.lineTo(560, ((time * 180) % 1280) - 40);
          ctx.stroke();
          ctx.restore();
        }
      }

      // sensing overlay
      if (sense) {
        ctx.save();
        ctx.lineCap = "round";
        // road edge probe
        ctx.strokeStyle = sense.onRoad ? "rgba(92,200,255,0.5)" : "rgba(255,93,122,0.75)";
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 6]);
        ctx.beginPath();
        ctx.moveTo(car.x - sense.normal.x * MAX_LATERAL, car.y - sense.normal.y * MAX_LATERAL);
        ctx.lineTo(car.x + sense.normal.x * MAX_LATERAL, car.y + sense.normal.y * MAX_LATERAL);
        ctx.stroke();
        ctx.setLineDash([]);

        // lookahead beam
        const gradient = ctx.createLinearGradient(car.x, car.y, sense.ahead.x, sense.ahead.y);
        gradient.addColorStop(0, "rgba(201,255,74,0.85)");
        gradient.addColorStop(1, "rgba(201,255,74,0)");
        ctx.strokeStyle = gradient;
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.moveTo(car.x, car.y);
        ctx.lineTo(sense.ahead.x, sense.ahead.y);
        ctx.stroke();

        // target point
        ctx.fillStyle = "rgba(201,255,74,0.95)";
        ctx.beginPath();
        ctx.arc(sense.ahead.x, sense.ahead.y, 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(201,255,74,0.35)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(sense.ahead.x, sense.ahead.y, 9 + Math.sin(time * 4) * 2.5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      // world units — the scene transform already carries the device scale
      drawCar(ctx, car.x, car.y, {
        angle: car.angle,
        steer: steerAngle(steer, speed),
        throttle,
        brake,
        speed: Math.abs(speed),
        drift,
      });

      teleRef.current = {
        speedKmh: Math.round(Math.abs(speed) * KMH),
        throttle,
        steer: steerAngle(steer, speed),
        brake,
        // pose.progress is arc length in px, so TRACK_LENGTH is the divisor —
        // TRACK.length is the sample *count* and reads ~9× too small here.
        progress: Math.min(1, Math.max(0, driving ? pose.progress / TRACK_LENGTH : gen / GENERATIONS)),
        laps: pose.laps,
        drift,
        lapTime: pose.elapsed,
        bestLap: bestLapRef.current,
        sense,
        activation,
      };
    },
    [gen, phase],
  );

  const restart = () => {
    brainRef.current = null;
    ghostRef.current = { path: [], speed: [] };
    bestLapRef.current = 0;
    poseRef.current = freshDrive();
    teleRef.current = { ...emptyTelemetry };
    setGen(0);
    setBest(0);
    setProgress(0);
    setHistory([]);
    setChampion(null);
    setSnap({ ...emptyTelemetry });
    setPhase("training");
    setRunId((n) => n + 1);
  };

  const lapPct = useMemo(() => Math.round(snap.progress * 100), [snap.progress]);
  const steeringDeg = Math.round((snap.steer * 180) / Math.PI);

  return (
    <AppShell>
      <div className="page-head rise">
        <div>
          <span className="eyebrow">
            <IconCpu size={14} /> Evolutionary training
          </span>
          <h1>Jaringan saraf belajar mengendarai sendiri</h1>
          <p>
            Satu jalur 5-8-2 tanpa label. Setiap generasi {POPULATION} kandidat dievaluasi di track yang sama,
            yang terbaik dipecah lalu di-mutasi ulang. Tidak ada contoh yang ditulis manusia — hanya fitness.
          </p>
        </div>
        <div className="head-tags">
          <span className="chip is-accent">
            <i className="dot is-live" /> {phase === "training" ? `Gen ${gen}/${GENERATIONS}` : "Championship run"}
          </span>
          <span className="chip">
            <IconFlag size={13} /> {TRACK_LENGTH_KM.toFixed(2)} km
          </span>
          <span className="chip is-violet">
            <IconNetwork size={13} /> {BRAIN_SIZE} bobot
          </span>
        </div>
      </div>

      <div className="split rise rise-1">
        <div className="stage-col">
          <div className="stage-frame">
            <div className="stage-viewport">
              <Stage draw={draw} onResize={invalidate} loop>
                <div className="stage-veil" />
                <div className="stage-grain" />

              <div className="hud">
                <div className="hud-row">
                  <div className="hud-stack">
                    <div className="glass speedo">
                      <span className="speedo-value mono">{snap.speedKmh}</span>
                      <span className="speedo-unit">km/h</span>
                    </div>
                    <span className="chip" style={{ backdropFilter: "blur(8px)" }}>
                      <IconRadar size={13} /> {snap.sense?.onRoad === false ? "keluar aspal" : "di aspal"}
                    </span>
                  </div>

                  <div className="hud-stack hud-stack-right">
                    <span className={`chip ${phase === "training" ? "is-sky" : "is-accent"}`}>
                      <i className="dot is-live" /> {phase === "training" ? "evaluasi" : "champion"}
                    </span>
                    <div className="stat-row">
                      <div className="glass stat">
                        <div className="stat-label">Setir</div>
                        <div className="stat-value mono">{steeringDeg}°</div>
                      </div>
                      <div className="glass stat">
                        <div className="stat-label">Gas</div>
                        <div className="stat-value mono is-accent">{Math.round(snap.throttle * 100)}</div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="hud-row" style={{ alignItems: "flex-end" }}>
                  <div className="glass lap">
                    <div className="lap-head">
                      <span>{phase === "training" ? "Kemajuan evolusi" : `Lap ${snap.laps + 1}`}</span>
                      {phase === "drive" && (
                        <span className="mono">
                          {formatLap(snap.lapTime)}
                          {snap.bestLap > 0 ? ` · best ${formatLap(snap.bestLap)}` : ""}
                        </span>
                      )}
                      <b className="mono">{lapPct}%</b>
                    </div>
                    <div className="bar">
                      <i className={`bar-fill${phase === "training" ? " is-violet" : ""}`} style={{ width: `${lapPct}%` }} />
                    </div>
                  </div>
                </div>
              </div>
              </Stage>
            </div>

            <div className="stage-caption">
              <span>Garis hijau = titik incar yang dibaca otak · garis biru = probe lebar aspal</span>
              <span className="mono">60 fps · 560×1280</span>
            </div>
          </div>
        </div>

        <div className="rail">
          <section className="panel">
            <div className="panel-head">
              <span className="panel-title">
                <IconPulse size={14} /> Fitness
              </span>
              <span className="panel-note">pop {POPULATION}</span>
            </div>
            <div className="metrics">
              <div className="metric">
                <div className="metric-label">Generasi</div>
                <div className="metric-value">
                  {gen}
                  <small>/{GENERATIONS}</small>
                </div>
              </div>
              <div className="metric">
                <div className="metric-label">Fitness</div>
                <div className="metric-value is-accent">{best.toFixed(1)}</div>
              </div>
              <div className="metric">
                <div className="metric-label">Tempuh</div>
                <div className="metric-value is-sky">
                  {Math.round(progress * 100)}
                  <small>%</small>
                </div>
              </div>
              <div className="metric">
                <div className="metric-label">Waktu</div>
                <div className="metric-value">
                  {((STEPS * gen) / 60).toFixed(0)}
                  <small>s</small>
                </div>
              </div>
            </div>
            <div style={{ marginTop: 12 }}>
              <Sparkline values={history} />
            </div>
            <div className="panel-note" style={{ marginTop: 6 }}>
              Fitness = +100 untuk setiap lap tuntas, minus 25 dikali porsi waktu di rumput. Progres menang, tapi
              mobil yang asal jalan tetap tidak nilainya.
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <span className="panel-title">
                <IconRadar size={14} /> Input sensor
              </span>
              <span className="panel-note">real-time</span>
            </div>
            <div className="readout">
              {INPUT_LABELS.map((label, i) => {
                const v = snap.activation?.inputs[i] ?? snap.sense?.inputs[i] ?? 0;
                return (
                  <div className="readout-row" key={label}>
                    <span>{label}</span>
                    <b className="mono">{v.toFixed(2)}</b>
                    <div className="readout-track">
                      <i style={{ width: `${Math.min(100, Math.abs(v) * 100)}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <span className="panel-title">
                <IconNetwork size={14} /> Arsitektur
              </span>
              <span className="panel-note">
                {INPUTS} → {HIDDEN} → {OUTPUTS}
              </span>
            </div>
            <NetworkDiagram brain={champion} activation={snap.activation} />
            <div className="btn-row" style={{ marginTop: 12 }}>
              {OUTPUT_LABELS.map((label, i) => (
                <span className="chip is-accent" key={label} style={{ flex: 1, justifyContent: "center" }}>
                  {label} <b className="mono">{(snap.activation?.outputs[i] ?? 0).toFixed(2)}</b>
                </span>
              ))}
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <span className="panel-title">
                <IconSteering size={14} /> Kendali
              </span>
            </div>
            <div className="btn-row">
              <button className="btn btn-primary" onClick={restart}>
                <IconRefresh size={15} /> Latih ulang
              </button>
              <Link className="btn btn-ghost" href="/manual">
                <IconSteering size={15} /> Ambil alih
              </Link>
            </div>
            <div className="panel-note" style={{ marginTop: 10 }}>
              Setelah {GENERATIONS} generasi, synapse terbaik ambil alih mobil. Garis sensor menunjukkan
              persis apa yang dibaca otak sebelum keluaran setir dan gas.
            </div>
          </section>
        </div>
      </div>
    </AppShell>
  );
}