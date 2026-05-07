import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { DEFAULT_CONFIG } from "@/lib/default-config";
import { validateConfig, diffConfig } from "@/lib/safety";

export const dynamic = "force-dynamic";

const REVERT_WINDOW_MS = 5 * 60 * 1000; // 5 minutes — commit-confirmed

export async function GET(_req: NextRequest, { params }: { params: { code: string } }) {
  const db = getDb();
  const row = db.prepare(`SELECT data, updated_at FROM configs WHERE device_code = ?`).get(params.code) as
    | { data: string; updated_at: number }
    | undefined;
  const pending = db.prepare(`SELECT * FROM pending_commits WHERE device_code = ? AND status = 'pending'`).get(params.code) as any;
  if (!row) {
    return NextResponse.json({ data: DEFAULT_CONFIG, updated_at: null, pending: null });
  }
  return NextResponse.json({
    data: JSON.parse(row.data),
    updated_at: row.updated_at,
    pending: pending ? { applied_at: pending.applied_at, revert_at: pending.revert_at } : null,
  });
}

export async function PUT(req: NextRequest, { params }: { params: { code: string } }) {
  const body = await req.json();
  const { config: newConfig, confirmCriticalCode, note } = body;

  // ---- Layer 2: Validation ----
  const errors = validateConfig(newConfig);
  if (errors.length > 0) {
    return NextResponse.json({ error: "validation_failed", errors }, { status: 400 });
  }

  const db = getDb();
  const oldRow = db.prepare(`SELECT data FROM configs WHERE device_code = ?`).get(params.code) as { data: string } | undefined;
  const oldConfig = oldRow ? JSON.parse(oldRow.data) : DEFAULT_CONFIG;

  // ---- Layer 1: Critical-change confirmation gate ----
  const changes = diffConfig(oldConfig, newConfig);
  const criticalChanges = changes.filter((c) => c.risk === "critical");
  if (criticalChanges.length > 0 && confirmCriticalCode !== params.code) {
    return NextResponse.json({
      error: "confirmation_required",
      message: `${criticalChanges.length} critical change(s) require typing the device code (${params.code}) to confirm.`,
      criticalChanges,
    }, { status: 409 });
  }

  const now = Date.now();
  const txn = db.transaction(() => {
    // ---- Layer 5: Snapshot history ----
    const snap = db.prepare(`INSERT INTO config_snapshots (device_code, data, author, note) VALUES (?, ?, ?, ?)`)
      .run(params.code, JSON.stringify(oldConfig), "cloud-user", note ?? "before update");

    // Save new config
    db.prepare(`
      INSERT INTO configs (device_code, data, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(device_code) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
    `).run(params.code, JSON.stringify(newConfig), now);

    // ---- Layer 4: Commit-confirmed auto-revert ----
    // Only arm the watchdog if there are caution/critical changes — safe-only changes don't need it.
    const hasRiskyChange = changes.some((c) => c.risk !== "safe");
    if (hasRiskyChange) {
      db.prepare(`
        INSERT INTO pending_commits (device_code, previous_snapshot_id, applied_at, revert_at, status)
        VALUES (?, ?, ?, ?, 'pending')
        ON CONFLICT(device_code) DO UPDATE SET
          previous_snapshot_id = excluded.previous_snapshot_id,
          applied_at = excluded.applied_at,
          revert_at = excluded.revert_at,
          status = 'pending'
      `).run(params.code, snap.lastInsertRowid, now, now + REVERT_WINDOW_MS);
    }

    db.prepare(`INSERT INTO events (device_code, kind, message, ts) VALUES (?, ?, ?, ?)`)
      .run(params.code, "config_updated",
        `Config saved (${changes.length} change${changes.length === 1 ? "" : "s"}, ${criticalChanges.length} critical)`,
        now);
  });
  txn();

  return NextResponse.json({
    ok: true,
    updated_at: now,
    changes,
    auto_revert_at: changes.some((c) => c.risk !== "safe") ? now + REVERT_WINDOW_MS : null,
  });
}
