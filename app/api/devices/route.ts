import { NextRequest, NextResponse } from "next/server";
import { getDb, type Device } from "@/lib/db";
import { DEFAULT_CONFIG } from "@/lib/default-config";

export const dynamic = "force-dynamic";

export async function GET() {
  const db = getDb();
  const now = Date.now();
  const HEARTBEAT_TIMEOUT = 5 * 60 * 1000;

  const rows = db.prepare(`SELECT * FROM devices ORDER BY created_at DESC`).all() as Device[];

  // Recompute online status by heartbeat freshness
  const devices = rows.map((d) => ({
    ...d,
    status: d.activate_time
      ? d.last_heartbeat && now - d.last_heartbeat < HEARTBEAT_TIMEOUT
        ? "online"
        : "offline"
      : "unactivated",
  }));

  const counts = {
    total: devices.length,
    online: devices.filter((d) => d.status === "online").length,
    offline: devices.filter((d) => d.status === "offline").length,
    unactivated: devices.filter((d) => d.status === "unactivated").length,
  };

  return NextResponse.json({ devices, counts });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO devices (device_code, device_name, device_grouping, product_series, product_type, product_model)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  try {
    const result = stmt.run(
      body.device_code,
      body.device_name ?? body.device_code,
      body.device_grouping ?? "SNGPL",
      body.product_series ?? "F-ZX",
      body.product_type ?? "DTU",
      body.product_model ?? "F2816 v4"
    );
    db.prepare(`INSERT OR IGNORE INTO configs (device_code, data) VALUES (?, ?)`)
      .run(body.device_code, JSON.stringify(DEFAULT_CONFIG));
    return NextResponse.json({ id: result.lastInsertRowid });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}

// Full delete: device row + all related rows (FK CASCADE isn't enforced unless
// PRAGMA foreign_keys=ON, so clean every table explicitly — no orphans left).
const RELATED = ["configs", "heartbeats", "events", "config_snapshots", "pending_commits", "device_logins"];
function purgeCodes(db: ReturnType<typeof getDb>, codes: string[]) {
  const tx = db.transaction((list: string[]) => {
    for (const c of list) {
      for (const t of RELATED) {
        try { db.prepare(`DELETE FROM ${t} WHERE device_code = ?`).run(c); } catch {}
      }
      db.prepare(`DELETE FROM devices WHERE device_code = ?`).run(c);
    }
  });
  tx(codes);
}

export async function DELETE(req: NextRequest) {
  const url = new URL(req.url);
  const db = getDb();
  // ?all=1 → wipe every device; ?code=a,b,c → batch; ?code=a → single.
  let codes: string[];
  if (url.searchParams.get("all") === "1") {
    codes = (db.prepare(`SELECT device_code FROM devices`).all() as Array<{ device_code: string }>).map((r) => r.device_code);
  } else {
    const raw = url.searchParams.get("code");
    if (!raw) return NextResponse.json({ error: "missing code" }, { status: 400 });
    codes = raw.split(",").map((s) => s.trim()).filter(Boolean);
  }
  purgeCodes(db, codes);
  return NextResponse.json({ ok: true, deleted: codes.length, codes });
}

// Edit device metadata (name / grouping / tags).
export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const code = body.device_code;
  if (!code) return NextResponse.json({ error: "missing device_code" }, { status: 400 });
  const db = getDb();
  const sets: string[] = [];
  const vals: any[] = [];
  for (const f of ["device_name", "device_grouping", "tags"]) {
    if (typeof body[f] === "string") { sets.push(`${f} = ?`); vals.push(body[f]); }
  }
  if (!sets.length) return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  vals.push(code);
  const r = db.prepare(`UPDATE devices SET ${sets.join(", ")} WHERE device_code = ?`).run(...vals);
  return NextResponse.json({ ok: true, changed: r.changes });
}
