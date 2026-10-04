"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import AppShell from "../components/AppShell";
import Stage, { type Scene } from "../components/Stage";
import { IconAlert, IconBrush, IconCheck, IconFlag, IconRefresh } from "../components/icons";
import { WORLD, smooth, type Point } from "../lib/track";

const MIN_POINTS = 8;

type Status = { kind: "idle" | "busy" | "ok" | "bad"; text: string };

export default function DrawTrack() {
  const canvasEl = useRef<HTMLCanvasElement | null>(null);
  const pointsRef = useRef<Point[]>([]);
  const [count, setCount] = useState(0);
  const [drawing, setDrawing] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "idle", text: "Sentuh kanvas untuk menggambar track." });
  const [version, setVersion] = useState(0);
  const drawingRef = useRef(false);

  /**
   * Forces a repaint of the static scene.
   *
   * Stage only repaints when `version` changes, so the stroke needs its own
   * counter — `setCount(pts.length)` re-renders with the same value while the
   * pointer is down and bails out, leaving the stroke unpainted until the
   * pointer is released.
   */
  const onDirty = useCallback(() => setVersion((v) => v + 1), []);

  /* ---------------- drawing ---------------- */
  useEffect(() => {
    const canvas = canvasEl.current;
    if (!canvas) return;

    const pos = (e: PointerEvent): Point => {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return { x: 0, y: 0 };
      // Normalised against the element's own CSS box, which is what the pointer
      // is over — Stage keeps that box at a fixed aspect ratio inside a wrapper
      // that may be larger, and the backing store is scaled by the device pixel
      // ratio on top of it.
      return {
        x: ((e.clientX - rect.left) / rect.width) * WORLD.w,
        y: ((e.clientY - rect.top) / rect.height) * WORLD.h,
      };
    };

    // Stage only repaints a static scene when `version` changes, so the stroke
    // has to be painted from here — it used to appear only on pointer-up.
    let repaint: number | null = null;
    const schedule = () => {
      if (repaint !== null) return;
      repaint = requestAnimationFrame(() => {
        repaint = null;
        onDirty();
      });
    };

    const down = (e: PointerEvent) => {
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      drawingRef.current = true;
      setDrawing(true);
      const p = pos(e);
      pointsRef.current = [p];
      setCount(1);
      schedule();
    };
    const move = (e: PointerEvent) => {
      if (!drawingRef.current) return;
      e.preventDefault();
      const p = pos(e);
      const pts = pointsRef.current;
      const last = pts[pts.length - 1];
      if (last && Math.hypot(p.x - last.x, p.y - last.y) < 2.4) return;
      pts.push(p);
      setCount(pts.length);
      schedule();
    };
    const up = (e: PointerEvent) => {
      if (!drawingRef.current) return;
      drawingRef.current = false;
      setDrawing(false);
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    };

    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    return () => {
      if (repaint !== null) cancelAnimationFrame(repaint);
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", up);
    };
  }, [onDirty]);

  /* ---------------- render ---------------- */
  const draw = useCallback((scene: Scene) => {
    const { ctx } = scene;
    // paper
    const paper = ctx.createLinearGradient(0, 0, WORLD.w * 0.4, WORLD.h);
    paper.addColorStop(0, "#12261a");
    paper.addColorStop(1, "#0c1a12");
    ctx.fillStyle = paper;
    ctx.fillRect(0, 0, WORLD.w, WORLD.h);

    // grid
    const cell = 40;
    ctx.strokeStyle = "rgba(140, 220, 160, 0.09)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = cell; x < WORLD.w; x += cell) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, WORLD.h);
    }
    for (let y = cell; y < WORLD.h; y += cell) {
      ctx.moveTo(0, y);
      ctx.lineTo(WORLD.w, y);
    }
    ctx.stroke();
    ctx.strokeStyle = "rgba(140, 220, 160, 0.16)";
    ctx.beginPath();
    for (let x = cell * 4; x < WORLD.w; x += cell * 4) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, WORLD.h);
    }
    for (let y = cell * 4; y < WORLD.h; y += cell * 4) {
      ctx.moveTo(0, y);
      ctx.lineTo(WORLD.w, y);
    }
    ctx.stroke();

    // centre cross
    ctx.strokeStyle = "rgba(201, 255, 74, 0.22)";
    ctx.setLineDash([6, 8]);
    ctx.beginPath();
    ctx.moveTo(WORLD.w / 2, 0);
    ctx.lineTo(WORLD.w / 2, WORLD.h);
    ctx.moveTo(0, WORLD.h / 2);
    ctx.lineTo(WORLD.w, WORLD.h / 2);
    ctx.stroke();
    ctx.setLineDash([]);

    const pts = smooth(pointsRef.current, 1);
    if (pts.length < 2) return;

    const trace = () => {
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.closePath();
    };

    // asphalt preview
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.strokeStyle = "rgba(0,0,0,0.5)";
    ctx.filter = `blur(${8 * scene.k}px)`;
    ctx.lineWidth = 128;
    trace();
    ctx.stroke();
    ctx.filter = "none";
    ctx.strokeStyle = "#20242b";
    ctx.lineWidth = 104;
    trace();
    ctx.stroke();
    const sheen = ctx.createLinearGradient(0, 0, WORLD.w, WORLD.h);
    sheen.addColorStop(0, "rgba(90, 100, 115, 0.55)");
    sheen.addColorStop(1, "rgba(40, 45, 54, 0.55)");
    ctx.strokeStyle = sheen;
    ctx.lineWidth = 70;
    trace();
    ctx.stroke();

    // crisp guide line on top
    ctx.strokeStyle = "rgba(201, 255, 74, 0.9)";
    ctx.lineWidth = 2.4;
    trace();
    ctx.stroke();

    // start marker
    const a = pts[0];
    const b = pts[1];
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    ctx.save();
    ctx.translate(a.x, a.y);
    ctx.rotate(ang);
    ctx.fillStyle = "#c9ff4a";
    ctx.fillRect(-6, -5, 12, 10);
    ctx.restore();
    ctx.strokeStyle = "rgba(201,255,74,0.55)";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(a.x, a.y, 16 + Math.sin(scene.time * 3) * 3, 0, Math.PI * 2);
    ctx.stroke();
  }, []);

  const save = async () => {
    setStatus({ kind: "busy", text: "Menyimpan track…" });
    try {
      const res = await fetch("/api/save-track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pointsRef.current),
      });
      const data = await res.json();
      setStatus(
        data.ok
          ? { kind: "ok", text: "Tersimpan. Jalankan ulang dev server agar track point ter-load." }
          : { kind: "bad", text: `Gagal: ${data.error}` },
      );
    } catch {
      setStatus({ kind: "bad", text: "Gagal menyimpan — server tidak merespons." });
    }
  };

  const clear = () => {
    pointsRef.current = [];
    drawingRef.current = false;
    setDrawing(false);
    setCount(0);
    setStatus({ kind: "idle", text: "Kanvas dikosongkan." });
  };

  const undo = () => {
    pointsRef.current = pointsRef.current.slice(0, -12);
    setCount(pointsRef.current.length);
  };

  const ready = count >= MIN_POINTS;

  return (
    <AppShell>
      <div className="page-head rise">
        <div>
          <span className="eyebrow">
            <IconBrush size={14} /> Track editor
          </span>
          <h1>Gambar lintasan sendiri</h1>
          <p>
            Tarik jari atau mouse di kanvas. Track disimpan ke <code className="mono">app/track-points.json</code>{" "}
            lalu dipakai ulang oleh mode AI dan manual.
          </p>
        </div>
        <div className="head-tags">
          <span className="chip">
            <span className="mono">{count}</span> titik
          </span>
          <span className="chip is-violet">
            <IconFlag size={13} /> {WORLD.w}×{WORLD.h}
          </span>
        </div>
      </div>

      <div className="editor-grid rise rise-1">
        <div className="stage-frame">
          <div className="stage-viewport">
            <Stage draw={draw} version={version} canvasRef={canvasEl}>
              <div className="stage-veil" />
              <div className="hud">
                <div className="hud-row">
                  <span className="chip">
                    <i className={`dot${drawing ? " is-live" : ""}`} /> {drawing ? "menggambar" : "mode gambar"}
                  </span>
                </div>
                <div className="hud-row" style={{ alignItems: "flex-end" }}>
                  <span className="chip">
                    <span className="mono">{Math.round((count / 300) * 100)}%</span> kepadatan
                  </span>
                </div>
              </div>
            </Stage>
          </div>
          <div className="stage-caption">
            <span>Jalan tidak otomatis — sentuh kanvas untuk mulai.</span>
            <span className="mono">{ready ? "siap disimpan" : `butuh ≥ ${MIN_POINTS} titik`}</span>
          </div>
        </div>

        <div className="rail">
          <section className="panel">
            <div className="panel-head">
              <span className="panel-title">Aksi</span>
            </div>
            <div className="btn-row">
              <button className="btn btn-primary" onClick={save} disabled={!ready || status.kind === "busy"}>
                Simpan track
              </button>
              <button className="btn" onClick={undo} disabled={count === 0}>
                <IconRefresh size={15} /> Undo
              </button>
              <button className="btn btn-ghost" onClick={clear} disabled={count === 0}>
                Bersihkan
              </button>
            </div>
            <div className={`toast${status.kind === "ok" ? " is-ok" : status.kind === "bad" ? " is-bad" : ""}`} style={{ marginTop: 12 }}>
              {status.kind === "ok" ? <IconCheck size={14} /> : status.kind === "bad" ? <IconAlert size={14} /> : <i className="dot" />}
              {status.text}
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <span className="panel-title">Legenda</span>
            </div>
            <div className="swatch-row">
              <div className="swatch">
                <i style={{ background: "linear-gradient(90deg,#3a3f48,#5a6472)" }} />
                <b>Aspal</b>
                <span>92 px</span>
              </div>
              <div className="swatch">
                <i style={{ background: "linear-gradient(90deg,#e2493c,#f2f5fa)" }} />
                <b>Kerb</b>
                <span>tikungan</span>
              </div>
              <div className="swatch">
                <i style={{ background: "#c9ff4a" }} />
                <b>Start</b>
                <span>garis finis</span>
              </div>
            </div>
            <div className="panel-note" style={{ marginTop: 12 }}>
              Setelah disimpan, gambar dihaluskan 4×, di-resample ke 300 titik, lalu tiap tikungan dibulatkan
              sampai radiusnya ≥140 px — jadi garis kasar tidak membuat mobil “gemetar”, dan aspalnya tidak
              melipat di tikungan tajam.
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <span className="panel-title">Lanjut ke</span>
            </div>
            <div className="btn-row">
              <Link className="btn btn-ghost" href="/">
                Mode AI
              </Link>
              <Link className="btn btn-ghost" href="/manual">
                Mode manual
              </Link>
            </div>
          </section>
        </div>
      </div>
    </AppShell>
  );
}