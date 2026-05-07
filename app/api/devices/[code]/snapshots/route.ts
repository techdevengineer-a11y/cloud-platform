import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { code: string } }) {
  const db = getDb();
  const rows = db.prepare(
    `SELECT id, created_at, author, note FROM config_snapshots WHERE device_code = ? ORDER BY created_at DESC LIMIT 50`
  ).all(params.code);
  return NextResponse.json({ snapshots: rows });
}

export async function POST(req: NextRequest, { params }: { params: { code: string } }) {
  // Restore from snapshot
  const { snapshotId } = await req.json();
  const db = getDb();
  const snap = db.prepare(`SELECT data FROM config_snapshots WHERE id = ? AND device_code = ?`).get(snapshotId, params.code) as
    | { data: string } | undefined;
  if (!snap) return NextResponse.json({ error: "snapshot_not_found" }, { status: 404 });

  const now = Date.now();
  const cur = db.prepare(`SELECT data FROM configs WHERE device_code = ?`).get(params.code) as { data: string } | undefined;
  db.transaction(() => {
    if (cur) {
      db.prepare(`INSERT INTO config_snapshots (device_code, data, author, note) VALUES (?, ?, ?, ?)`)
        .run(params.code, cur.data, "cloud-user", `auto-snapshot before restore`);
    }
    db.prepare(`
      INSERT INTO configs (device_code, data, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(device_code) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
    `).run(params.code, snap.data, now);
    db.prepare(`INSERT INTO events (device_code, kind, message, ts) VALUES (?, ?, ?, ?)`)
      .run(params.code, "config_restored", `Restored snapshot #${snapshotId}`, now);
  })();

  return NextResponse.json({ ok: true, restored_at: now });
}
