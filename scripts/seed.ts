import path from "path";
import fs from "fs";
import Database from "better-sqlite3";

const DATA_DIR = path.join(process.cwd(), ".data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new Database(path.join(DATA_DIR, "fourfaith.db"));
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS devices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_code TEXT UNIQUE NOT NULL,
    device_name TEXT NOT NULL,
    device_grouping TEXT,
    product_series TEXT,
    product_type TEXT,
    product_model TEXT,
    software_version TEXT,
    cellular_module_version TEXT,
    activate_time INTEGER,
    last_heartbeat INTEGER,
    online_duration INTEGER DEFAULT 0,
    status TEXT DEFAULT 'unactivated',
    remote_addr TEXT,
    tags TEXT,
    created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
  );
  CREATE TABLE IF NOT EXISTS configs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_code TEXT UNIQUE NOT NULL,
    data TEXT NOT NULL,
    updated_at INTEGER DEFAULT (strftime('%s','now') * 1000)
  );
  CREATE TABLE IF NOT EXISTS heartbeats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_code TEXT NOT NULL,
    ts INTEGER NOT NULL,
    signal INTEGER,
    rx_bytes INTEGER,
    tx_bytes INTEGER
  );
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_code TEXT,
    kind TEXT NOT NULL,
    message TEXT,
    ts INTEGER DEFAULT (strftime('%s','now') * 1000)
  );
`);

// Seed the 4 devices visible in the SCREENSHOTS/image.png dashboard
const now = Date.now();
const sample = [
  {
    code: "11990044",  name: "SHAHADT",      group: "SNGPL", series: "F-ZX", type: "DTU", model: "F2816 v4",
    sw: "F2X16V4_FF202601\n12000006_V1.0.2 03-26-03-6 11:42:18", cell: "-",
    activate: new Date("2026-04-16T19:26:48").getTime(),
    lastHb: new Date("2026-04-29T05:07:33").getTime(),
    duration: 3 * 3600 + 25 * 60 + 9, status: "online",
  },
  {
    code: "11331133",  name: "ALLAMA IQBAL", group: "SNGPL", series: "F-ZX", type: "DTU", model: "F2816",
    sw: "F2X16V4_Standard_V1.0.0 2025-07-02 14:17:43", cell: "-",
    activate: new Date("2025-11-04T12:16:32").getTime(),
    lastHb: new Date("2026-04-29T05:07:31").getTime(),
    duration: 3 * 3600 + 25 * 60 + 28, status: "online",
  },
  {
    code: "11223344556678999", name: "kohaaa",  group: "SNGPL", series: "F-ZX", type: "DTU", model: "F2816 v4",
    sw: null, cell: null, activate: null, lastHb: null, duration: 0, status: "unactivated",
  },
  {
    code: "3140816", name: "TESTING", group: "SNGPL", series: "F-ZX", type: "DTU", model: "F2816 v4",
    sw: null, cell: null, activate: null, lastHb: null, duration: 0, status: "unactivated",
  },
  {
    code: "99999998", name: "testing", group: "SNGPL", series: "F-2X", type: "DTU", model: "F2816 v4",
    sw: "F2X16V4_FF20260112000006_V1.0.2 2026-03-6 11:42:18", cell: "-",
    activate: new Date("2026-05-06T19:24:23").getTime(),
    lastHb: new Date("2026-05-06T19:24:23").getTime(),
    duration: 3, status: "online",
  },
];

const ins = db.prepare(`
  INSERT INTO devices (device_code, device_name, device_grouping, product_series, product_type, product_model,
                       software_version, cellular_module_version, activate_time, last_heartbeat, online_duration, status)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(device_code) DO UPDATE SET
    device_name = excluded.device_name,
    last_heartbeat = excluded.last_heartbeat,
    status = excluded.status,
    online_duration = excluded.online_duration
`);

for (const d of sample) {
  ins.run(d.code, d.name, d.group, d.series, d.type, d.model, d.sw, d.cell, d.activate, d.lastHb, d.duration, d.status);
}

// Generate 24 hours of synthetic heartbeats for the two online devices
const hbIns = db.prepare(`INSERT INTO heartbeats (device_code, ts, signal, rx_bytes, tx_bytes) VALUES (?,?,?,?,?)`);
db.prepare(`DELETE FROM heartbeats`).run();
for (const d of sample) {
  if (d.status !== "online") continue;
  for (let i = 0; i < 24 * 12; i++) {
    const ts = now - i * 5 * 60 * 1000;
    const sig = 18 + Math.floor(Math.random() * 14);
    const rx = 1024 * (40 + Math.floor(Math.random() * 200));
    const tx = 1024 * (20 + Math.floor(Math.random() * 100));
    hbIns.run(d.code, ts, sig, rx, tx);
  }
}

// Seed events
const evIns = db.prepare(`INSERT INTO events (device_code, kind, message, ts) VALUES (?,?,?,?)`);
db.prepare(`DELETE FROM events`).run();
const evs = [
  ["11990044", "device_online",   "SHAHADT registered from cellular network",   now - 10 * 60 * 1000],
  ["11331133", "config_updated",  "MQTT settings synchronized",                 now - 25 * 60 * 1000],
  ["11990044", "config_updated",  "Modbus polling interval changed to 30s",     now - 60 * 60 * 1000],
  ["11331133", "device_online",   "ALLAMA IQBAL came online",                   now - 90 * 60 * 1000],
  ["3140816",  "device_pending",  "TESTING awaiting activation",                now - 4 * 60 * 60 * 1000],
  ["99999998", "device_online",   "testing (F2816 v4, SN FK3130442675) registered via MANAID 99999998", new Date("2026-05-06T19:24:23").getTime()],
];
for (const [code, kind, msg, ts] of evs) evIns.run(code, kind, msg, ts);

console.log(`Seeded ${sample.length} devices.`);
console.log("Counts:", db.prepare("SELECT status, COUNT(*) as n FROM devices GROUP BY status").all());
