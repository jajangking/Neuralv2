import { writeFile } from "fs/promises";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const points = await req.json();
    await writeFile(process.cwd() + "/app/track-points.json", JSON.stringify(points, null, 2));
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, error: "gagal simpan" }, { status: 500 });
  }
}
