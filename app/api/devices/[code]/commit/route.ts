import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

// Confirm — device responded healthy after the change, cancel the auto-revert.
export async function POST(_req: NextRequest, { params }: { params: { code: string } }) {
  const db = getDb();
  const r = db.prepare(`UPDATE pending_commits SET status = 'confirmed' WHERE device_code = ? AND status = 'pending'`).run(params.code);
  if (r.changes > 0) {
    db.prepare(`INSERT INTO events (device_code, kind, message, ts) VALUES (?, ?, ?, ?)`)
      .run(params.code, "commit_confirmed", "Operator confirmed device healthy — auto-revert cancelled", Date.now());
  }
  return NextResponse.json({ ok: true, confirmed: r.changes });
}

// Manual revert — push the previous snapshot back as the active config.
export async function DELETE(_req: NextRequest, { params }: { params: { code: string } }) {
  const db = getDb();
  const pending = db.prepare(`SELECT previous_snapshot_id FROM pending_commits WHERE device_code = ? AND status = 'pending'`).get(params.code) as
    | { previous_snapshot_id: number } | undefined;
  if (!pending) return NextResponse.json({ error: "no_pending_commit" }, { status: 404 });

  const snap = db.prepare(`SELECT data FROM config_snapshots WHERE id = ?`).get(pending.previous_snapshot_id) as { data: string } | undefined;
  if (!snap) return NextResponse.json({ error: "snapshot_lost" }, { status: 500 });

  const now = Date.now();
  db.transaction(() => {
    db.prepare(`UPDATE configs SET data = ?, updated_at = ? WHERE device_code = ?`).run(snap.data, now, params.code);
    db.prepare(`UPDATE pending_commits SET status = 'reverted' WHERE device_code = ?`).run(params.code);
    db.prepare(`INSERT INTO events (device_code, kind, message, ts) VALUES (?, ?, ?, ?)`)
      .run(params.code, "commit_reverted", "Manual revert to previous config", now);
  })();

  return NextResponse.json({ ok: true });
}
