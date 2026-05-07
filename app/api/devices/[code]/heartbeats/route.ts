import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: { code: string } }) {
  const url = new URL(req.url);
  const limit = Number(url.searchParams.get("limit") ?? "60");
  const db = getDb();
  const rows = db.prepare(
    `SELECT ts, signal, rx_bytes, tx_bytes FROM heartbeats WHERE device_code = ? ORDER BY ts DESC LIMIT ?`
  ).all(params.code, limit) as Array<{ ts: number; signal: number; rx_bytes: number; tx_bytes: number }>;
  return NextResponse.json({ heartbeats: rows.reverse() });
}
