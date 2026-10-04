import { writeFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";

/**
 * Persists a hand-drawn track.
 *
 * The body is validated before it is written: this endpoint writes straight into
 * the repo, and a malformed payload used to be persisted as-is, which then made
 * `track.ts` throw at import time and took every page down until the file was
 * restored by hand.
 */
const MAX_POINTS = 5000;

function isPoint(value: unknown): value is { x: number; y: number } {
  if (!value || typeof value !== "object") return false;
  const p = value as Record<string, unknown>;
  return typeof p.x === "number" && Number.isFinite(p.x) && typeof p.y === "number" && Number.isFinite(p.y);
}

export async function POST(req: Request) {
  let points: unknown;
  try {
    points = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "body bukan JSON" }, { status: 400 });
  }

  if (!Array.isArray(points) || points.length < 3 || points.length > MAX_POINTS || !points.every(isPoint)) {
    return NextResponse.json(
      { ok: false, error: `butuh 3…${MAX_POINTS} titik {x, y} yang valid` },
      { status: 400 },
    );
  }

  try {
    await writeFile(path.join(process.cwd(), "app", "track-points.json"), JSON.stringify(points, null, 2));
    return NextResponse.json({ ok: true, count: points.length });
  } catch {
    return NextResponse.json({ ok: false, error: "gagal simpan" }, { status: 500 });
  }
}
