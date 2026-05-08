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
  parseMgmtFrame,
  buildShortMgmtFrame,
  buildLongMgmtFrame,
  buildAtSetPayload,
  MgmtCmd,
  MGMT_FRAME_DELIM,
} from "../lib/protocol";

const PORT = Number(process.env.TCP_PORT ?? 10000);
const HOST = process.env.TCP_HOST ?? "0.0.0.0";
const WS_PORT = Number(process.env.WS_PORT ?? 10001);
// Server address advertised back to the device on its initial cmd=1 probe.
// Must match what the DTU dialed (otherwise it'll reconnect to whatever we say).
const ADVERTISED_IP = process.env.PUBLIC_IP ?? "54.254.49.133";
const ADVERTISED_PORT = Number(process.env.PUBLIC_PORT ?? PORT);

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

/** ASCII test-harness parser (REG,... / HB,...). Real F2X16V4 traffic uses parseMgmtFrame. */
function parseAscii(buf: Buffer) {
  const asTxt = buf.toString("utf8").trim();
  if (/^REG,/.test(asTxt)) {
    const [, code, series, model, sw, cell] = asTxt.split(",");
    return { kind: "ascii_reg" as const, code, series, model, sw, cell };
  }
  if (/^HB,/.test(asTxt)) {
    const [, code, rssi, rx, tx] = asTxt.split(",");
    return { kind: "ascii_hb" as const, code, rssi: +rssi, rx: +rx, tx: +tx };
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

    // ASCII test frames first (used by our self-test harness, not real devices).
    const asciiHead = buf.toString("utf8").slice(0, 4);
    if (/^REG,/.test(asciiHead) || /^HB,/.test(asciiHead)) {
      const parsed = parseAscii(buf);
      insertCapture.run(remote, "in", buf.toString("hex"), parsed.kind, now);
      if (parsed.kind === "ascii_reg") {
        const { code, series, model, sw, cell } = parsed;
        upsertReg.run(code!, code!, "SNGPL", series ?? "F-ZX", "DTU",
          model ?? "F2816 v4", sw ?? null, cell ?? null, now, now, remote);
        insertEvent.run(code, "device_online", `Device registered (ASCII test) from ${remote}`, now);
        registered = code!;
        liveDevices.set(code!, socket);
        broadcast({ type: "device_online", deviceCode: code, remote, ts: now });
        console.log(`[tcp] ASCII REG ${code} (${remote})`);
        socket.write("ACK\n");
      } else if (parsed.kind === "ascii_hb") {
        updateHb.run(now, remote, parsed.code);
        insertHb.run(parsed.code, now, parsed.rssi ?? null, parsed.rx ?? 0, parsed.tx ?? 0);
        broadcast({ type: "device_heartbeat", deviceCode: parsed.code, ts: now });
        socket.write("ACK\n");
      }
      return;
    }

    // Real F2X16V4 traffic: framed by 0x7E ... 0x7E. A single TCP segment may
    // carry one or more frames back-to-back (rare but allowed by the spec), so
    // peel them off in a loop.
    let cursor = 0;
    while (cursor < buf.length) {
      if (buf[cursor] !== MGMT_FRAME_DELIM) {
        // Not a 7E-framed packet — log raw so we can RE later.
        const remaining = buf.subarray(cursor);
        insertCapture.run(remote, "in", remaining.toString("hex"), "unknown", now);
        console.log(`[tcp] UNKNOWN ${remaining.length}B from ${remote}: ${hexDump(remaining)}`);
        return;
      }
      const frame = parseMgmtFrame(buf.subarray(cursor));
      if (!frame) {
        // Malformed / partial — capture and bail.
        insertCapture.run(remote, "in", buf.subarray(cursor).toString("hex"), "malformed_frame", now);
        console.log(`[tcp] MALFORMED frame from ${remote}: ${hexDump(buf.subarray(cursor))}`);
        return;
      }
      cursor += frame.raw.length;

      if (frame.kind !== "short") {
        insertCapture.run(remote, "in", frame.raw.toString("hex"), `mgmt_long_cmd${frame.cmd}`, now);
        console.log(`[tcp] long frame cmd=${frame.cmd} from ${remote}: ${frame.atText.slice(0, 80)}`);
        continue;
      }

      const code = frame.manaId;
      insertCapture.run(remote, "in", frame.raw.toString("hex"), `mgmt_cmd${frame.cmd}`, now);
      broadcast({ type: "tcp_data", remote, deviceCode: code, kind: `mgmt_cmd${frame.cmd}`, hex: frame.raw.toString("hex"), ts: now });

      switch (frame.cmd) {
        case MgmtCmd.ServerAddrSync: {
          // Device asks "what's your address?" — reply with our public ip\rport.
          // Without this, firmware logs "get srv err1" and the protocol stalls.
          const payload = `${ADVERTISED_IP}\r${ADVERTISED_PORT}`;
          const reply = buildShortMgmtFrame(MgmtCmd.ServerAddrSync, code, payload);
          socket.write(reply);
          insertCapture.run(`->${remote}`, "out", reply.toString("hex"), "mgmt_cmd1_reply", now);
          console.log(`[tcp] cmd=1 probe from MANAID ${code} → replied ${ADVERTISED_IP}:${ADVERTISED_PORT}`);
          break;
        }
        case MgmtCmd.Login: {
          // Login info: \r-delimited build / netType / workMode / serialCfg / phone / ip:srcPort / model / imei
          const fields = frame.payload.toString("ascii").split("\r");
          const [build = "", netType = "", workMode = "", , , , model = "", imei = ""] = fields;
          upsertReg.run(
            code, code, "SNGPL", "F-ZX", "DTU",
            model || "F2816 v4", build || null, netType || null,
            now, now, remote
          );
          insertLogin.run(code, remote, frame.raw.toString("hex"), frame.raw.length, frame.payload.toString("ascii"));
          insertEvent.run(code, "device_login", `cmd=2 login (${frame.payload.length}B): ${imei || build}`, now);
          registered = code;
          liveDevices.set(code, socket);

          const reply = buildShortMgmtFrame(MgmtCmd.Login, code, "LS");
          socket.write(reply);
          insertCapture.run(`->${remote}`, "out", reply.toString("hex"), "mgmt_login_ack", now);
          broadcast({ type: "device_online", deviceCode: code, remote, login: frame.payload.toString("ascii"), ts: now });
          console.log(`[tcp] LOGIN ${code} netType=${netType} workMode=${workMode} imei=${imei}`);
          break;
        }
        case MgmtCmd.Heartbeat: {
          updateHb.run(now, remote, code);
          const text = frame.payload.toString("ascii");
          const sigMatch = text.match(/^(\d+)/);
          const signal = sigMatch ? Number(sigMatch[1]) : null;
          insertHb.run(code, now, signal, 0, 0);
          if (!registered) registered = code;
          broadcast({ type: "device_heartbeat", deviceCode: code, ts: now, signal });

          const reply = buildShortMgmtFrame(MgmtCmd.Heartbeat, code, Buffer.from([0x00]));
          socket.write(reply);
          insertCapture.run(`->${remote}`, "out", reply.toString("hex"), "mgmt_hb_ack", now);
          break;
        }
        case MgmtCmd.SetVars:
        case MgmtCmd.QueryVars: {
          // Result of a previously-pushed cmd=7/8 — store as event for the dashboard.
          const text = frame.payload.toString("ascii");
          insertEvent.run(code, `cmd${frame.cmd}_result`, text.slice(0, 500), now);
          console.log(`[tcp] cmd=${frame.cmd} result from ${code}: ${text.slice(0, 120)}`);
          break;
        }
        default: {
          console.log(`[tcp] unhandled cmd=${frame.cmd} from ${code}: ${hexDump(frame.payload)}`);
        }
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
  console.log(`[tcp] Four-Faith listener on ${HOST}:${PORT}  (advertise ${ADVERTISED_IP}:${ADVERTISED_PORT})`);
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
