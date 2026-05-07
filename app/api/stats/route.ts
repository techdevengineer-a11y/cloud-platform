import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const db = getDb();
  const now = Date.now();
  const HEARTBEAT_TIMEOUT = 5 * 60 * 1000;

  const all = db.prepare(`SELECT activate_time, last_heartbeat FROM devices`).all() as Array<{
    activate_time: number | null;
    last_heartbeat: number | null;
  }>;

  let online = 0, offline = 0, unactivated = 0;
  for (const d of all) {
    if (!d.activate_time) unactivated++;
    else if (d.last_heartbeat && now - d.last_heartbeat < HEARTBEAT_TIMEOUT) online++;
    else offline++;
  }

  // Aggregate signal/traffic over last 24h, bucketed hourly
  const since = now - 24 * 3600 * 1000;
  const hourly = db.prepare(
    `SELECT (ts / 3600000) * 3600000 as hour, AVG(signal) as avg_signal,
            SUM(rx_bytes) as rx, SUM(tx_bytes) as tx, COUNT(*) as cnt
     FROM heartbeats WHERE ts >= ? GROUP BY hour ORDER BY hour ASC`
  ).all(since) as Array<{ hour: number; avg_signal: number; rx: number; tx: number; cnt: number }>;

  // Recent events
  const events = db.prepare(`SELECT device_code, kind, message, ts FROM events ORDER BY ts DESC LIMIT 10`).all();

  return NextResponse.json({
    counts: { total: all.length, online, offline, unactivated },
    hourly,
    events,
  });
}
