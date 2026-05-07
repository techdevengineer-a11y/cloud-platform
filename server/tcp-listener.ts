/**
 * TCP listener for Four-Faith F2X16V4 gateway devices.
 *
 * Frame parsing is informed by analysis of firmware
 *   F2X16V4_FF20260112000006_V1.0.2_260306.bin
 *
 * Two parser paths run side by side:
 *   1. Inferred DTU-manage binary frame ([len:2][opcode:1][payload][crc16:2])
 *   2. ASCII test frames "REG,..." / "HB,..." (used by our self-test)
 *
 * Anything we can't parse is dumped as hex so the operator can capture and
 * we can reverse-engineer the exact opcode table from real device traffic.
 */
import net from "net";
import path from "path";
import fs from "fs";
import Database from "better-sqlite3";
import { WebSocketServer, WebSocket } from "ws";
import {
  tryParseDtuFrame,
  tryParseDtuLogin,
  crc16Modbus,
  buildLongMgmtFrame,
  buildAtSetPayload,
} from "../lib/protocol";

const PORT = Number(process.env.TCP_PORT ?? 10000);
const HOST = process.env.TCP_HOST ?? "0.0.0.0";
const WS_PORT = Number(process.env.WS_PORT ?? 10001);
// ACK shape sent to the modem after login + after each heartbeat. Until a
// real F281 confirms which one keeps the socket alive, this is swappable
// at runtime: LOGIN_ACK=echo|zero|frame|none
//   echo  - write the same bytes back (default; matches generic Four-Faith)
//   zero  - write 0x00 (minimal liveness signal)
//   frame - [len:2 BE][0x00 status:1][crc16-modbus:2] OK frame
//   none  - send nothing (use only if device is fine without an ACK)
const LOGIN_ACK = (process.env.LOGIN_ACK ?? "echo").toLowerCase();

function buildAck(buf: Buffer): Buffer {
  switch (LOGIN_ACK) {
    case "zero": return Buffer.from([0x00]);
    case "frame": {
      const f = Buffer.alloc(5);
      f.writeUInt16BE(5, 0);
      f[2] = 0x00;
      f.writeUInt16BE(crc16Modbus(f.subarray(0, 3)), 3);
      return f;
    }
    case "none": return Buffer.alloc(0);
    case "echo":
    default: return buf;
  }
}

const DATA_DIR = path.join(process.cwd(), ".data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const PCAP_DIR = path.join(DATA_DIR, "captures");
if (!fs.existsSync(PCAP_DIR)) fs.mkdirSync(PCAP_DIR, { recursive: true });

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
  CREATE TABLE IF NOT EXISTS raw_captures (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    remote_addr TEXT,
    direction TEXT,
    bytes_hex TEXT,
    parsed_kind TEXT,
    ts INTEGER DEFAULT (strftime('%s','now') * 1000)
  );
  CREATE INDEX IF NOT EXISTS idx_captures_ts ON raw_captures(ts DESC);

  CREATE TABLE IF NOT EXISTS configs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_code TEXT UNIQUE NOT NULL,
    data TEXT NOT NULL,
    updated_at INTEGER DEFAULT (strftime('%s','now') * 1000)
  );
  CREATE TABLE IF NOT EXISTS config_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_code TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
    author TEXT,
    note TEXT
  );
  CREATE TABLE IF NOT EXISTS pending_commits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_code TEXT UNIQUE NOT NULL,
    previous_snapshot_id INTEGER,
    applied_at INTEGER NOT NULL,
    revert_at INTEGER NOT NULL,
    status TEXT DEFAULT 'pending'
  );
  CREATE TABLE IF NOT EXISTS device_logins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_code TEXT NOT NULL,
    remote_addr TEXT,
    bytes_hex TEXT NOT NULL,
    bytes_len INTEGER NOT NULL,
    printable_run TEXT,
    ts INTEGER DEFAULT (strftime('%s','now') * 1000)
  );
  CREATE INDEX IF NOT EXISTS idx_device_logins_ts ON device_logins(ts DESC);
`);

const upsertReg = db.prepare(`
  INSERT INTO devices (device_code, device_name, device_grouping, product_series, product_type,
                       product_model, software_version, cellular_module_version,
                       activate_time, last_heartbeat, status, remote_addr)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'online', ?)
  ON CONFLICT(device_code) DO UPDATE SET
    last_heartbeat = excluded.last_heartbeat,
    status = 'online',
    remote_addr = excluded.remote_addr,
    activate_time = COALESCE(devices.activate_time, excluded.activate_time)
`);
const updateHb = db.prepare(`
  UPDATE devices SET last_heartbeat = ?, status = 'online', remote_addr = ?,
                     online_duration = COALESCE(online_duration, 0) + 60
  WHERE device_code = ?
`);
const insertHb = db.prepare(`INSERT INTO heartbeats (device_code, ts, signal, rx_bytes, tx_bytes) VALUES (?,?,?,?,?)`);
const insertEvent = db.prepare(`INSERT INTO events (device_code, kind, message, ts) VALUES (?,?,?,?)`);
const insertCapture = db.prepare(`INSERT INTO raw_captures (remote_addr, direction, bytes_hex, parsed_kind, ts) VALUES (?,?,?,?,?)`);
const insertLogin = db.prepare(`INSERT INTO device_logins (device_code, remote_addr, bytes_hex, bytes_len, printable_run) VALUES (?,?,?,?,?)`);

function hexDump(buf: Buffer, max = 64): string {
  const slice = buf.subarray(0, Math.min(buf.length, max));
  return slice.toString("hex").match(/.{1,2}/g)?.join(" ") ?? "";
}

/**
 * Try every parser we know. Returns one of:
 *   { kind: "ascii_reg", code, ... }
 *   { kind: "ascii_hb",  code, ... }
 *   { kind: "dtu_frame", opcode, ... }
 *   { kind: "unknown" }
 */
function parseAny(buf: Buffer) {
  // ASCII test frames first (used by our self-test client)
  const asTxt = buf.toString("utf8").trim();
  if (/^REG,/.test(asTxt)) {
    const [, code, series, model, sw, cell] = asTxt.split(",");
    return { kind: "ascii_reg" as const, code, series, model, sw, cell };
  }
  if (/^HB,/.test(asTxt)) {
    const [, code, rssi, rx, tx] = asTxt.split(",");
    return { kind: "ascii_hb" as const, code, rssi: +rssi, rx: +rx, tx: +tx };
  }

  // DTU manage binary frame
  const f = tryParseDtuFrame(buf);
  if (f && f.opcode !== null) {
    const expected = crc16Modbus(buf.subarray(0, f.totalLen - 2));
    const crcOk = expected === f.crc16;
    return { kind: "dtu_frame" as const, opcode: f.opcode, payload: f.payload, totalLen: f.totalLen, crcOk };
  }

  return { kind: "unknown" as const };
}

/* ---------- WebSocket bridge for real-time dashboard ---------- */
const wss = new WebSocketServer({ port: WS_PORT, host: HOST });
const wsClients = new Set<WebSocket>();
// Track which TCP sockets correspond to which device codes for live commands
const liveDevices = new Map<string, net.Socket>();

function broadcast(event: any) {
  const msg = JSON.stringify(event);
  for (const ws of wsClients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  }
}

wss.on("connection", (ws) => {
  wsClients.add(ws);
  console.log(`[ws] client connected (${wsClients.size} total)`);

  // Send initial state: which devices are currently connected
  ws.send(JSON.stringify({
    type: "live_devices",
    devices: Array.from(liveDevices.keys()),
  }));

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "push_config") {
        const sock = liveDevices.get(msg.deviceCode);
        if (!sock) {
          ws.send(JSON.stringify({ type: "push_result", deviceCode: msg.deviceCode, ok: false, reason: "device_not_connected" }));
          return;
        }
        // Build a real cmd=7 long-frame: 7E LEN 0x01 <12-zero> 0x0D <15-digit-seq> AT+KEY=VAL\r... CRC 7E
        // Verified against hello.txt 2026-05-06 capture. Accept either:
        //   msg.atVars: { KEY: value, ... }       (preferred — caller supplies pure AT keys)
        //   msg.atLines: ["AT+IDNT=...", ...]     (already-formatted AT command lines)
        // msg.reboot=true appends AT+RESET to trigger a device reboot.
        let atPayload: Buffer;
        if (Array.isArray(msg.atLines) && msg.atLines.length > 0) {
          const lines = msg.reboot ? [...msg.atLines, "AT+RESET"] : msg.atLines;
          atPayload = Buffer.from(lines.join("\r") + "\r", "ascii");
        } else if (msg.atVars && typeof msg.atVars === "object") {
          atPayload = buildAtSetPayload(msg.atVars, { reset: !!msg.reboot });
        } else if (msg.reboot) {
          atPayload = Buffer.from("AT+RESET\r", "ascii");
        } else {
          ws.send(JSON.stringify({ type: "push_result", deviceCode: msg.deviceCode, ok: false, reason: "missing_atVars_or_atLines" }));
          return;
        }
        const frame = buildLongMgmtFrame(atPayload);
        sock.write(frame);
        const len = frame.length;
        insertCapture.run(`->${sock.remoteAddress}`, "out", frame.toString("hex"), "cfg_push", Date.now());
        insertEvent.run(msg.deviceCode, "config_push", `Pushed cmd=7 (${len} bytes, ${atPayload.toString("ascii").trim().split("\r").length} AT lines${msg.reboot ? ", +RESET" : ""})`, Date.now());
        ws.send(JSON.stringify({ type: "push_result", deviceCode: msg.deviceCode, ok: true, bytes: len }));
        broadcast({ type: "config_pushed", deviceCode: msg.deviceCode, ts: Date.now() });
      }
    } catch (e: any) {
      ws.send(JSON.stringify({ type: "error", message: e.message }));
    }
  });

  ws.on("close", () => {
    wsClients.delete(ws);
    console.log(`[ws] client disconnected (${wsClients.size} total)`);
  });
});

console.log(`[ws] WebSocket bridge on ${HOST}:${WS_PORT}`);

/* ---------- TCP server ---------- */
const server = net.createServer((socket) => {
  const remote = `${socket.remoteAddress}:${socket.remotePort}`;
  let registered: string | null = null;
  // OS-level keepalive: probes every ~50s once the connection is idle. Keeps
  // the carrier-NAT mapping warm even if the modem's own 60s heartbeat slips.
  socket.setKeepAlive(true, 50_000);
  console.log(`[tcp] connect from ${remote}`);
  broadcast({ type: "tcp_connect", remote, ts: Date.now() });

  socket.on("data", (buf) => {
    const now = Date.now();

    // First-packet-as-login: the F2X16V4 firmware sends a binary HEXLOGIN
    // packet (~14 bytes) as the very first PSH,ACK after TCP handshake.
    // Public Four-Faith config server FIN'd it; we instead register the
    // device, persist the bytes for later opcode work, and echo an ACK so
    // the modem keeps the socket open for heartbeats and command push.
    if (!registered) {
      const asciiHead = buf.toString("utf8").slice(0, 4);
      if (!/^(REG|HB),/.test(asciiHead)) {
        const login = tryParseDtuLogin(buf);
        if (login && login.isLikelyLogin) {
          const code = login.printableRun ?? login.candidateId;
          upsertReg.run(
            code, code, "SNGPL", "F-ZX", "DTU",
            "F2816 v4", null, null, now, now, remote
          );
          insertLogin.run(code, remote, login.rawHex, buf.length, login.printableRun);
          insertCapture.run(remote, "in", login.rawHex, "dtu_login", now);
          insertEvent.run(code, "device_login", `Binary login (${buf.length}B): ${login.rawHex}`, now);
          registered = code;
          liveDevices.set(code, socket);
          broadcast({ type: "device_online", deviceCode: code, remote, login: login.rawHex, ts: now });
          // Send the configured login ACK. Firmware logs "Cust get login rsp"
          // so a response IS expected. Swap shapes via LOGIN_ACK env var if
          // the modem still tears the socket down after the default echo.
          const ack = buildAck(buf);
          if (ack.length > 0) {
            socket.write(ack);
            insertCapture.run(`->${remote}`, "out", ack.toString("hex"), `login_ack_${LOGIN_ACK}`, now);
          }
          console.log(`[tcp] LOGIN ${code} ${buf.length}B hex=${login.rawHex} from ${remote} (ack=${LOGIN_ACK})`);
          return;
        }
      }
    }

    const parsed = parseAny(buf);

    // ALWAYS log raw capture so we can reverse-engineer real device frames later
    insertCapture.run(remote, "in", buf.toString("hex"), parsed.kind, now);
    broadcast({ type: "tcp_data", remote, deviceCode: registered, kind: parsed.kind, hex: buf.toString("hex"), ts: now });

    switch (parsed.kind) {
      case "ascii_reg": {
        const { code, series, model, sw, cell } = parsed;
        upsertReg.run(code!, code!, "SNGPL", series ?? "F-ZX", "DTU",
          model ?? "F2816 v4", sw ?? null, cell ?? null, now, now, remote);
        insertEvent.run(code, "device_online", `Device registered (ASCII test) from ${remote}`, now);
        registered = code!;
        liveDevices.set(code!, socket);
        broadcast({ type: "device_online", deviceCode: code, remote, ts: now });
        console.log(`[tcp] ASCII REG ${code} (${remote})`);
        socket.write("ACK\n");
        return;
      }
      case "ascii_hb": {
        const { code } = parsed;
        updateHb.run(now, remote, code);
        insertHb.run(code, now, parsed.rssi ?? null, parsed.rx ?? 0, parsed.tx ?? 0);
        broadcast({ type: "device_heartbeat", deviceCode: code, ts: now });
        socket.write("ACK\n");
        return;
      }
      case "dtu_frame": {
        const status = parsed.crcOk ? "CRC-OK" : "CRC-FAIL";
        console.log(`[tcp] DTU frame opcode=0x${parsed.opcode.toString(16)} len=${parsed.totalLen} ${status} from ${remote}`);
        console.log(`       hex: ${hexDump(buf)}`);
        if (registered) {
          // Once registered, any binary frame on this socket is treated as a
          // heartbeat for liveness purposes — refines once opcode table is known.
          updateHb.run(now, remote, registered);
          insertHb.run(registered, now, null, 0, 0);
          broadcast({ type: "device_heartbeat", deviceCode: registered, ts: now });
          const ack = buildAck(buf);
          if (ack.length > 0) {
            socket.write(ack);
            insertCapture.run(`->${remote}`, "out", ack.toString("hex"), `hb_ack_${LOGIN_ACK}`, now);
          }
        }
        return;
      }
      case "unknown": {
        console.log(`[tcp] UNKNOWN ${buf.length} bytes from ${remote}: ${hexDump(buf)}`);
        return;
      }
    }
  });

  socket.on("close", () => {
    if (registered) {
      db.prepare(`UPDATE devices SET status = 'offline' WHERE device_code = ?`).run(registered);
      insertEvent.run(registered, "device_offline", `Connection closed from ${remote}`, Date.now());
      liveDevices.delete(registered);
      broadcast({ type: "device_offline", deviceCode: registered, ts: Date.now() });
    }
    broadcast({ type: "tcp_disconnect", remote, ts: Date.now() });
    console.log(`[tcp] disconnect ${remote}`);
  });

  socket.on("error", (err) => console.warn(`[tcp] err ${remote}: ${err.message}`));
});

server.listen(PORT, HOST, () => {
  console.log(`[tcp] Four-Faith listener on ${HOST}:${PORT}  (firmware-aware, capture-mode, ack=${LOGIN_ACK})`);
});

/* ---------- Background workers ---------- */

// 1. Mark stale devices offline
setInterval(() => {
  const cutoff = Date.now() - 5 * 60 * 1000;
  const stale = db.prepare(`SELECT device_code FROM devices WHERE status = 'online' AND last_heartbeat < ?`).all(cutoff) as Array<{ device_code: string }>;
  for (const s of stale) {
    db.prepare(`UPDATE devices SET status = 'offline' WHERE device_code = ?`).run(s.device_code);
    insertEvent.run(s.device_code, "device_offline", "Heartbeat timeout (5 min)", Date.now());
  }
}, 60_000);

// 2. Auto-revert pending commits whose window expired without heartbeat
setInterval(() => {
  const now = Date.now();
  const expired = db.prepare(
    `SELECT pc.device_code, pc.previous_snapshot_id, d.last_heartbeat, pc.applied_at
     FROM pending_commits pc
     JOIN devices d ON d.device_code = pc.device_code
     WHERE pc.status = 'pending' AND pc.revert_at < ?`
  ).all(now) as Array<{ device_code: string; previous_snapshot_id: number; last_heartbeat: number; applied_at: number }>;

  for (const row of expired) {
    if (row.last_heartbeat && row.last_heartbeat >= row.applied_at) {
      // Device heartbeated after we applied — assume healthy, auto-confirm
      db.prepare(`UPDATE pending_commits SET status = 'confirmed' WHERE device_code = ?`).run(row.device_code);
      insertEvent.run(row.device_code, "commit_auto_confirmed", "Device heartbeat received within window — config confirmed", now);
      continue;
    }
    // No heartbeat → revert
    const snap = db.prepare(`SELECT data FROM config_snapshots WHERE id = ?`).get(row.previous_snapshot_id) as { data: string } | undefined;
    if (!snap) {
      db.prepare(`UPDATE pending_commits SET status = 'lost' WHERE device_code = ?`).run(row.device_code);
      insertEvent.run(row.device_code, "commit_lost", "Auto-revert wanted but snapshot missing", now);
      continue;
    }
    db.prepare(`UPDATE configs SET data = ?, updated_at = ? WHERE device_code = ?`).run(snap.data, now, row.device_code);
    db.prepare(`UPDATE pending_commits SET status = 'auto_reverted' WHERE device_code = ?`).run(row.device_code);
    insertEvent.run(row.device_code, "commit_auto_reverted", "Device silent past 5-min window — config rolled back", now);
    console.log(`[safety] auto-reverted ${row.device_code}`);
  }
}, 30_000);
