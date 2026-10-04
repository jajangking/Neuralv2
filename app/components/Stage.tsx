"use client";

import { useEffect, useRef, type ReactNode, type Ref, type RefObject } from "react";
import { WORLD } from "../lib/track";

export type Scene = {
  ctx: CanvasRenderingContext2D;
  /** css pixels */
  width: number;
  height: number;
  /** css pixels per world unit */
  scale: number;
  /** device pixels per world unit */
  k: number;
  /** device pixels */
  px: number;
  py: number;
  dt: number;
  time: number;
};

type StageProps = {
  /** called every frame (loop) or on demand (static) with a ready transform */
  draw: (scene: Scene) => void;
  /** fires whenever the backing store is (re)sized */
  onResize?: (scene: Scene) => void;
  /** change this to force a repaint of a static scene */
  version?: unknown;
  /** hand the raw canvas to the parent (pointer handling, exports…) */
  canvasRef?: Ref<HTMLCanvasElement>;
  loop?: boolean;
  className?: string;
  children?: ReactNode;
};

/**
 * Fits the 560×1280 logical world into whatever space it is given, keeps the
 * backing store crisp on any DPR, and hands the scene a ready-to-use transform.
 * Children are rendered on top of the canvas, aligned to its box.
 */
export default function Stage({
  draw,
  onResize,
  version,
  canvasRef,
  loop = false,
  className,
  children,
}: StageProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const ownCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawRef = useRef(draw);
  const resizeCbRef = useRef(onResize);
  const sceneRef = useRef<Scene | null>(null);
  const paintRef = useRef<(() => void) | null>(null);

  // keep the latest callbacks reachable from the loop without re-initialising it
  useEffect(() => {
    drawRef.current = draw;
    resizeCbRef.current = onResize;
  });

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = ownCanvasRef.current;
    if (!wrap || !canvas) return;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;

    const paint = () => {
      const scene = sceneRef.current;
      if (!scene) return;
      scene.ctx.setTransform(scene.k, 0, 0, scene.k, 0, 0);
      drawRef.current(scene);
    };
    paintRef.current = paint;

    const fit = () => {
      const rect = wrap.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return;
      const scale = Math.min(rect.width / WORLD.w, rect.height / WORLD.h);
      const width = WORLD.w * scale;
      const height = WORLD.h * scale;
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      const px = Math.round(width * dpr);
      const py = Math.round(height * dpr);
      const changed = canvas.width !== px || canvas.height !== py;
      if (changed) {
        canvas.width = px;
        canvas.height = py;
      }
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      // Pin the inner box to the fitted size. Shrink-wrapping would work only
      // while the canvas stays in flow; sizing it here keeps the overlay box and
      // the centring correct no matter how the canvas itself is positioned.
      const box = boxRef.current;
      if (box) {
        box.style.width = `${width}px`;
        box.style.height = `${height}px`;
      }
      const scene: Scene = { ctx, width, height, scale, k: dpr * scale, px, py, dt: 0, time: 0 };
      sceneRef.current = scene;
      if (changed) resizeCbRef.current?.(scene);
      paint();
    };

    const ro = new ResizeObserver(fit);
    ro.observe(wrap);
    fit();

    return () => {
      ro.disconnect();
      paintRef.current = null;
      sceneRef.current = null;
    };
  }, []);

  // static scenes repaint whenever the caller bumps `version`
  useEffect(() => {
    paintRef.current?.();
  }, [version]);

  useEffect(() => {
    if (!loop) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const scene = sceneRef.current;
      const dt = Math.min(0.034, Math.max(0, (now - last) / 1000));
      last = now;
      if (scene) {
        scene.dt = dt;
        scene.time = now / 1000;
        scene.ctx.setTransform(scene.k, 0, 0, scene.k, 0, 0);
        drawRef.current(scene);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [loop]);

  return (
    <div
      ref={wrapRef}
      className={className}
      style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", overflow: "hidden" }}
    >
      <div ref={boxRef} style={{ position: "relative", lineHeight: 0 }}>
        <canvas ref={mergeRefs(ownCanvasRef, canvasRef)} />
        {children}
      </div>
    </div>
  );
}

function mergeRefs<T>(own: RefObject<T | null>, external?: Ref<T>) {
  return (node: T | null) => {
    own.current = node;
    if (typeof external === "function") external(node);
    else if (external) (external as RefObject<T | null>).current = node;
  };
}