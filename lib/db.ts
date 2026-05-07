import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const DATA_DIR = path.join(process.cwd(), ".data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, "fourfaith.db");

declare global {
  // eslint-disable-next-line no-var
  var __db: Database.Database | undefined;
}

function init(db: Database.Database) {
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
      updated_at INTEGER DEFAULT (strftime('%s','now') * 1000),
      FOREIGN KEY (device_code) REFERENCES devices(device_code) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS heartbeats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_code TEXT NOT NULL,
      ts INTEGER NOT NULL,
      signal INTEGER,
      rx_bytes INTEGER,
      tx_bytes INTEGER,
      FOREIGN KEY (device_code) REFERENCES devices(device_code) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_heartbeats_device_ts ON heartbeats(device_code, ts);

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_code TEXT,
      kind TEXT NOT NULL,
      message TEXT,
      ts INTEGER DEFAULT (strftime('%s','now') * 1000)
    );

    CREATE TABLE IF NOT EXISTS config_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_code TEXT NOT NULL,
      data TEXT NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
      author TEXT,
      note TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_snapshots_device ON config_snapshots(device_code, created_at DESC);

    CREATE TABLE IF NOT EXISTS pending_commits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_code TEXT UNIQUE NOT NULL,
      previous_snapshot_id INTEGER,
      applied_at INTEGER NOT NULL,
      revert_at INTEGER NOT NULL,
      status TEXT DEFAULT 'pending',
      FOREIGN KEY (previous_snapshot_id) REFERENCES config_snapshots(id)
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT DEFAULT 'admin',
      display_name TEXT,
      created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
      last_login INTEGER
    );
  `);

  // Seed default admin if no users
  const userCount = db.prepare(`SELECT COUNT(*) as n FROM users`).get() as { n: number };
  if (userCount.n === 0) {
    // Imported lazily to avoid circular deps
    const bcrypt = require("bcryptjs");
    const hash = bcrypt.hashSync("admin", 10);
    db.prepare(`INSERT INTO users (username, password_hash, role, display_name) VALUES (?, ?, ?, ?)`)
      .run("admin", hash, "admin", "Administrator");
    console.log("[db] seeded default admin user (username: admin / password: admin) — CHANGE THIS");
  }
}

export function getDb(): Database.Database {
  if (!global.__db) {
    const db = new Database(DB_PATH);
    init(db);
    global.__db = db;
  }
  return global.__db;
}

export type Device = {
  id: number;
  device_code: string;
  device_name: string;
  device_grouping: string | null;
  product_series: string | null;
  product_type: string | null;
  product_model: string | null;
  software_version: string | null;
  cellular_module_version: string | null;
  activate_time: number | null;
  last_heartbeat: number | null;
  online_duration: number;
  status: "online" | "offline" | "unactivated";
  remote_addr: string | null;
  tags: string | null;
  created_at: number;
};
