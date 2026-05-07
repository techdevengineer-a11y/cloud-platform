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

export async function DELETE(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  if (!code) return NextResponse.json({ error: "missing code" }, { status: 400 });
  const db = getDb();
  db.prepare(`DELETE FROM devices WHERE device_code = ?`).run(code);
  return NextResponse.json({ ok: true });
}
