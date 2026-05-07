import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 100), 500);
  const db = getDb();
  // Ensure table exists (TCP listener creates it but UI may load first)
  db.exec(`
    CREATE TABLE IF NOT EXISTS raw_captures (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      remote_addr TEXT,
      direction TEXT,
      bytes_hex TEXT,
      parsed_kind TEXT,
      ts INTEGER DEFAULT (strftime('%s','now') * 1000)
    );
  `);
  const rows = db.prepare(
    `SELECT id, remote_addr, direction, bytes_hex, parsed_kind, ts FROM raw_captures ORDER BY ts DESC LIMIT ?`
  ).all(limit);
  return NextResponse.json({ captures: rows });
}

export async function DELETE() {
  const db = getDb();
  db.prepare(`DELETE FROM raw_captures`).run();
  return NextResponse.json({ ok: true });
}
