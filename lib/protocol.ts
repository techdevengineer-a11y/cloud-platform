/**
 * Protocol facts for the F2X16V4 DTU manage channel (port 10000).
 *
 * Hardware:    Renesas RA6M4 (ARM Cortex-M33) + Quectel/Fibocom cellular module
 * Firmware:    V1.0.2 build 2026-03-06, customization SNGPL
 * Bootloader:  FF-DTU-BOOT 2015-08-06
 *
 * Frame format (verified from the 2026-05-06 UART capture, hello.txt):
 *
 *   Short frames (login, heartbeat, simple ACK):
 *     7E  LEN(2 LE)  DIR(1)  CMD(1)  MANAID(4 BCD)  PLEN(2 LE)  PAYLOAD  CRC16(2)  7E
 *
 *   Long cloud-pushed remote-command frames (cmd 7, 8, ...):
 *     7E  LEN(2 LE)  0x01 0x01  "<12-zero-pad>" 0x0D "<15-digit-msg-seq>"  CMD(1)
 *         AT_TEXT(N)  CRC16(2)  7E
 *
 *   - LEN counts bytes from DIR (or 0x01 0x01 prelude) through CRC16-byte-1 inclusive.
 *   - MANAID is BCD-packed: device code 99999998 -> 0x99 0x99 0x99 0x98.
 *   - CRC16 polynomial: Modbus (0xA001 reflected, init 0xFFFF).
 *   - Payload for cmd=7/8 is concatenated `AT+KEY=VALUE\r` or `AT+KEY?\r` lines —
 *     the device runs them through its WebMaster.c AT dispatcher (same as serial AT).
 *
 * Verified command codes (from hello.txt):
 *   1  cloud->device  Server-address sync   payload: "<ip>\r<port>"
 *   2  device->cloud  Login info            payload: \r-delimited build/net/IMEI/...
 *   2  cloud->device  Login ACK             payload: "LS"
 *   3  device->cloud  Heartbeat             payload: "26\r6" (signal\rRSSI?)
 *   3  cloud->device  Heartbeat reply       payload: 0x00
 *   7  cloud->device  Set AT vars / RESET   payload: AT+KEY=VALUE\r... or AT+RESET
 *   7  device->cloud  Set-result            payload: \r\nOK\r\n per line
 *   8  cloud->device  Query AT vars         payload: AT+KEY?\r...
 *   8  device->cloud  Query result          payload: \r\n+KEY: value\r\nOK\r\n per line
 *
 * Protocol modes the device supports (the "Work Agreement" selection):
 *   - DCTCP / DCUDP  – proprietary "data center" framed protocol (port 10000 default)
 *   - TRNS           – fully transparent passthrough
 *   - SMSCLI/SMSSER  – SMS-based client/server
 *   - HTTP           – HTTP POST telemetry
 *   - MTCP / MRTU    – Modbus TCP / Modbus RTU bridge
 *   - MQTT           – publishes to sngpl/telemetry/<deviceId>/data
 *
 * MQTT mode:
 *   - Default Send Topic format:  sngpl/telemetry/<deviceCode>/data
 *   - Take Over Topic = subscribe topic for downstream commands
 *
 * Firmware upgrade (OTA):
 *   - Quectel FOTA via AT+QFOTADL (downloads from URL)
 *   - AT+STPUPGRADE (local), AT+RMTUPGRADE (remote)
 */

export const FIRMWARE_INFO = {
  fileName: "F2X16V4_FF20260112000006_V1.0.2_260306 (1).bin",
  size: 498048,
  deviceType: "F2x16V4",
  application: "F2X16V4_FF20260112000006_V1.0.2",
  buildDate: "2026-03-06",
  bootloader: "FF-DTU-BOOT 2015-08-06 SW:08.06-01 HW:5.20-01",
  hardware: "Renesas RA6M4 (Cortex-M33), FreeRTOS, lwIP",
  cellularStack: "Quectel-style AT (Q*, AT^*)",
};

export const SUPPORTED_MODES = [
  { code: "DCTCP",     name: "Data Center TCP",     defaultPort: 10000, file: "ff_modettcp.c" },
  { code: "DCUDP",     name: "Data Center UDP",     defaultPort: 10000, file: "ff_modetudp.c" },
  { code: "TRNS",      name: "Transparent",         defaultPort: null,  file: "ff_modettrn.c" },
  { code: "SMSCLI",    name: "SMS Client",          defaultPort: null,  file: "ff_modesmsdtu.c" },
  { code: "SMSSER",    name: "SMS Server",          defaultPort: null,  file: "ff_modesmsdtu.c" },
  { code: "HTTP",      name: "HTTP POST",           defaultPort: 80,    file: "ff_modehttp.c" },
  { code: "MTCP",      name: "Modbus TCP",          defaultPort: 502,   file: "ff_modembstcp.c" },
  { code: "MRTU",      name: "Modbus RTU bridge",   defaultPort: 502,   file: "ff_modembstcp.c" },
  { code: "MQTT",      name: "MQTT",                defaultPort: 1883,  file: "ff_modemqtt.c" },
  { code: "TCPCUSTOM", name: "TCP Custom (HEXLOGIN)", defaultPort: null, file: "CustApp_Std.c" },
];

/** DTU Manage frame heuristic — kept for legacy raw-byte tracking in the listener. */
export type DtuFrame = {
  totalLen: number;        // includes header bytes
  opcode: number | null;   // single byte opcode (heuristic)
  payload: Buffer;
  crc16: number | null;    // last two bytes
  raw: Buffer;
};

/**
 * Try to parse a DTU manage frame using the older heuristic
 *   [length:2 BE][opcode:1][payload:N][crc16:2]
 * Superseded by parseMgmtFrame() for cloud↔device traffic; kept because
 * tcp-listener still uses it as a cheap "does this look like a frame?" check.
 */
export function tryParseDtuFrame(buf: Buffer): DtuFrame | null {
  if (buf.length < 5) return null;
  const len = buf.readUInt16BE(0);
  if (len < 5 || len > buf.length || len > 2048) return null;
  const opcode = buf[2];
  const payload = buf.subarray(3, len - 2);
  const crc16 = buf.readUInt16BE(len - 2);
  return { totalLen: len, opcode, payload, crc16, raw: buf.subarray(0, len) };
}

// ---------------------------------------------------------------------------
// Verified DTU manage-channel frame format (from hello.txt, 2026-05-06)
// ---------------------------------------------------------------------------

export const MGMT_FRAME_DELIM = 0x7E;

export const MgmtCmd = {
  ServerAddrSync:    1,  // cloud→device first packet, then device reconnects
  Login:             2,  // device→cloud login info; cloud→device "LS" ACK
  Heartbeat:         3,  // device→cloud "<sig>\r<rssi>"; cloud→device 0x00
  SetVars:           7,  // cloud→device AT+KEY=VALUE\r...  (incl. AT+RESET)
  QueryVars:         8,  // cloud→device AT+KEY?\r...
} as const;

/**
 * Encode a numeric device code into 4 BCD bytes (8 digits).
 * MANAID 99999998 -> Buffer<99 99 99 98>. Pads with leading zeros if shorter.
 */
export function bcdEncodeManaId(deviceCode: string | number): Buffer {
  const digits = String(deviceCode).replace(/\D/g, "").padStart(8, "0").slice(-8);
  const out = Buffer.alloc(4);
  for (let i = 0; i < 4; i++) {
    out[i] = (parseInt(digits[i * 2], 10) << 4) | parseInt(digits[i * 2 + 1], 10);
  }
  return out;
}

/** Inverse of bcdEncodeManaId — returns up to 8 ASCII digits. */
export function bcdDecodeManaId(buf: Buffer): string {
  let s = "";
  for (let i = 0; i < buf.length; i++) {
    s += ((buf[i] >> 4) & 0xF).toString() + (buf[i] & 0xF).toString();
  }
  return s.replace(/^0+/, "") || "0";
}

export type MgmtFrame =
  | {
      kind: "short";
      dir: number;       // 0 = device→cloud, 0 = cloud→device for login ACK (the byte is reserved in practice)
      cmd: number;
      manaId: string;    // decoded BCD
      payload: Buffer;
      raw: Buffer;
    }
  | {
      kind: "long";
      cmd: number;
      sessionCustomerId: string; // 12-zero-pad (or assigned customer id)
      msgSeq: string;            // 15 ASCII digits
      atText: string;            // payload as ASCII
      raw: Buffer;
    };

/**
 * Parse a single complete management frame (7E ... 7E).
 * `buf` must start with 0x7E. Returns null if framing is malformed.
 */
export function parseMgmtFrame(buf: Buffer): MgmtFrame | null {
  if (buf.length < 8 || buf[0] !== MGMT_FRAME_DELIM) return null;
  const innerLen = buf.readUInt16LE(1);
  // LEN counts everything from DIR through both CRC bytes inclusive.
  // Total wire = 1 (start 7E) + 2 (LEN) + innerLen + 1 (end 7E).
  // Verified against captured LS ACK (innerLen=0x000C, total 16 bytes) and
  // cmd=1 empty probe (innerLen=0x000A, total 14 bytes).
  const totalWire = 1 + 2 + innerLen + 1;
  if (buf.length < totalWire) return null;
  if (buf[totalWire - 1] !== MGMT_FRAME_DELIM) return null;

  // Long cloud-pushed format: marker 0x01, then ASCII session header, then payload.
  // No separate cmd byte — the firmware classifies by content (`AT+...?`→8, `AT+...=`→7, 0x00→3).
  if (buf[3] === 0x01) {
    const headerStart = 4;
    let p = headerStart;
    while (p < buf.length && buf[p] !== 0x0D) p++;
    if (p >= buf.length) return null;
    const customerId = buf.subarray(headerStart, p).toString("ascii");
    p++; // skip CR
    let q = p;
    while (q < buf.length && buf[q] >= 0x30 && buf[q] <= 0x39) q++;
    const msgSeq = buf.subarray(p, q).toString("ascii");
    // Payload runs from q to (totalWire - 3): the last 2 bytes inside framing are CRC.
    const payload = buf.subarray(q, totalWire - 3);
    const atText = payload.toString("ascii");
    const cmd = inferLongFrameCmd(payload);
    return {
      kind: "long",
      cmd,
      sessionCustomerId: customerId,
      msgSeq,
      atText,
      raw: buf.subarray(0, totalWire),
    };
  }

  // Short format
  const dir = buf[3];
  const cmd = buf[4];
  const manaId = bcdDecodeManaId(buf.subarray(5, 9));
  const plen = buf.readUInt16LE(9);
  const payload = buf.subarray(11, 11 + plen);
  return {
    kind: "short",
    dir,
    cmd,
    manaId,
    payload,
    raw: buf.subarray(0, totalWire),
  };
}

/**
 * Build a short cloud→device frame (login ACK, heartbeat reply, server-addr sync).
 * Layout: 7E LEN(2LE) DIR=0 CMD MANAID(4 BCD) PLEN(2LE) PAYLOAD CRC16 7E
 */
export function buildShortMgmtFrame(
  cmd: number,
  deviceCode: string | number,
  payload: Buffer | string,
): Buffer {
  const data = typeof payload === "string" ? Buffer.from(payload, "ascii") : payload;
  const mid = bcdEncodeManaId(deviceCode);
  const inner = Buffer.alloc(1 + 1 + 4 + 2 + data.length);
  // DIR(1)=0, CMD(1), MANAID(4), PLEN(2 LE), PAYLOAD
  inner[0] = 0x00;
  inner[1] = cmd & 0xFF;
  mid.copy(inner, 2);
  inner.writeUInt16LE(data.length, 6);
  data.copy(inner, 8);
  // LEN counts inner + 2 CRC bytes (observed 0x000C for 16-byte LS ACK; 0x000A for 14-byte cmd=1 probe).
  const innerLen = inner.length + 2;
  const head = Buffer.alloc(3);
  head[0] = MGMT_FRAME_DELIM;
  head.writeUInt16LE(innerLen, 1);
  // CRC-16 (Modbus) is computed over inner only (DIR..PAYLOAD), not LEN. Stored little-endian on
  // the wire — captured LS ACK CRC bytes "E0 38" decode as 0x38E0, the Modbus value over its inner.
  const crc = crc16Modbus(inner);
  const crcBuf = Buffer.alloc(2);
  crcBuf.writeUInt16LE(crc, 0);
  return Buffer.concat([head, inner, crcBuf, Buffer.from([MGMT_FRAME_DELIM])]);
}

/**
 * Split an AT-text payload (cmd=7/8) into individual `AT+...` lines.
 * Filters empty lines and trims trailing CR.
 */
export function parseAtCommandPayload(text: string): string[] {
  return text.split("\r").map((s) => s.trim()).filter(Boolean);
}

/**
 * Infer the cmd code of a long-format frame by sniffing the payload.
 * Mirrors the firmware's WebMaster.c dispatch: AT+...? → query (8),
 * AT+...= → set (7), single 0x00 → heartbeat reply (3).
 */
export function inferLongFrameCmd(payload: Buffer): number {
  if (payload.length === 0) return 0;
  if (payload.length === 1 && payload[0] === 0x00) return MgmtCmd.Heartbeat;
  const first = payload.toString("ascii", 0, Math.min(payload.length, 32));
  if (/^AT\+[A-Z0-9]+\?/i.test(first)) return MgmtCmd.QueryVars;
  if (/^AT\+[A-Z0-9]+(=|\b)/i.test(first)) return MgmtCmd.SetVars;
  return 0;
}

/**
 * Build a long cloud→device frame:
 *   7E LEN(2 LE) 0x01 "<customer-id>" 0x0D "<msg-seq>" PAYLOAD CRC16 7E
 *
 * `payload` should be the AT text (e.g. `AT+IDNT=74657374\rAT+RESET\r`) or `Buffer.from([0x00])`
 * for a heartbeat reply. Defaults match the live capture: 12-char customer id of all zeros,
 * 15-digit msg-seq derived from the current timestamp.
 */
export function buildLongMgmtFrame(
  payload: Buffer | string,
  opts?: { customerId?: string; msgSeq?: string },
): Buffer {
  const data = typeof payload === "string" ? Buffer.from(payload, "ascii") : payload;
  const customerId = (opts?.customerId ?? "000000000000").padStart(12, "0").slice(-12);
  const msgSeq = (opts?.msgSeq ?? defaultMsgSeq()).padStart(15, "0").slice(-15);

  // Inner content: marker(1) + customerId(12) + CR(1) + msgSeq(15) + payload(N) + CRC(2)
  const inner = Buffer.alloc(1 + 12 + 1 + 15 + data.length + 2);
  let off = 0;
  inner[off++] = 0x01;
  inner.write(customerId, off, 12, "ascii"); off += 12;
  inner[off++] = 0x0D;
  inner.write(msgSeq, off, 15, "ascii"); off += 15;
  data.copy(inner, off); off += data.length;

  // CRC-16 (Modbus) over inner content only — same convention as buildShortMgmtFrame.
  // Stored little-endian on the wire.
  const crc = crc16Modbus(inner.subarray(0, off));
  inner.writeUInt16LE(crc, off);

  const out = Buffer.alloc(1 + 2 + inner.length + 1);
  out[0] = MGMT_FRAME_DELIM;
  out.writeUInt16LE(inner.length, 1);
  inner.copy(out, 3);
  out[out.length - 1] = MGMT_FRAME_DELIM;
  return out;
}

/**
 * Convert a key→value map into the `AT+KEY=VALUE\r...` text payload the device expects.
 * Order is preserved from the input. Pass `{ reset: true }` to append `AT+RESET\r`.
 *
 * Separator is a single CR (0x0D) per query — verified against the real-cloud
 * capture (New folder/New Text Document.txt, 2026-05-17): the production cloud
 * sends `AT+X?\rAT+Y?\r…`, NOT `\r\n`. Every line (including the last) is
 * CR-terminated.
 */
export function buildAtSetPayload(
  vars: Record<string, string | number | boolean>,
  opts?: { reset?: boolean },
): Buffer {
  const lines: string[] = [];
  for (const [k, v] of Object.entries(vars)) {
    const value = typeof v === "boolean" ? (v ? "1" : "0") : String(v);
    lines.push(`AT+${k}=${value}`);
  }
  if (opts?.reset) lines.push("AT+RESET");
  return Buffer.from(lines.map((l) => l + "\r").join(""), "ascii");
}

/**
 * Build the cmd=8 (Read/Query) AT-text payload: `AT+KEY?\rAT+KEY?\r…`.
 * Matches the production cloud's Read frame exactly (every query CR-terminated).
 */
export function buildAtQueryPayload(keys: string[]): Buffer {
  return Buffer.from(keys.map((k) => `AT+${k}?\r`).join(""), "ascii");
}

/**
 * Parse a device→cloud cmd=8 response payload into a key→value map.
 * The device replies `\r\n+KEY: value\r\nOK\r\n` per query, concatenated
 * (verified from the real capture). Value may be empty. A Read spans several
 * response frames; call this per frame and merge the results.
 */
export function parseAtQueryResponse(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /\+([A-Z0-9_]+):[ \t]?([^\r\n]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out[m[1]] = m[2];
  }
  return out;
}

/** Public msg-seq generator (15 ASCII digits) so callers can track responses. */
export function newMsgSeq(): string {
  return defaultMsgSeq();
}

/**
 * Verify-then-send gate: assert a long frame is byte-structurally identical to
 * the production cloud's cmd=7/8 format before we put it on the wire to a real
 * modem. Re-parses the frame and re-checks LEN, the single 0x01 marker, the
 * 12-char customer id, the 0x0D, the 15-digit msgSeq, and the Modbus CRC.
 * Returns { ok:true } only if every check passes.
 */
export function isWellFormedLongFrame(
  frame: Buffer,
): { ok: boolean; reason?: string } {
  if (frame.length < 1 + 2 + 31 + 1) return { ok: false, reason: "too short" };
  if (frame[0] !== MGMT_FRAME_DELIM) return { ok: false, reason: "no leading 0x7E" };
  if (frame[frame.length - 1] !== MGMT_FRAME_DELIM) return { ok: false, reason: "no trailing 0x7E" };
  const innerLen = frame.readUInt16LE(1);
  if (innerLen !== frame.length - 4) {
    return { ok: false, reason: `LEN ${innerLen} != wire-4 ${frame.length - 4}` };
  }
  if (frame[3] !== 0x01) return { ok: false, reason: `marker ${frame[3].toString(16)} != 0x01` };
  const customerId = frame.subarray(4, 16).toString("ascii");
  if (!/^[0-9]{12}$/.test(customerId)) {
    return { ok: false, reason: `customerId "${customerId}" not 12 digits` };
  }
  if (frame[16] !== 0x0d) return { ok: false, reason: `byte[16] ${frame[16].toString(16)} != 0x0D` };
  const msgSeq = frame.subarray(17, 32).toString("ascii");
  if (!/^[0-9]{15}$/.test(msgSeq)) {
    return { ok: false, reason: `msgSeq "${msgSeq}" not 15 digits` };
  }
  // CRC is the last 2 bytes inside the framing; computed over inner (marker..payload).
  const inner = frame.subarray(3, frame.length - 3);
  const wireCrc = frame.readUInt16LE(frame.length - 3);
  const calc = crc16Modbus(inner);
  if (wireCrc !== calc) {
    return { ok: false, reason: `CRC wire ${wireCrc.toString(16)} != calc ${calc.toString(16)}` };
  }
  return { ok: true, reason: undefined };
}

let _seqCounter = 0;
function defaultMsgSeq(): string {
  // 15 digits, monotonically increasing within a process run.
  // First 13 digits = unix ms, last 2 digits = in-process counter.
  const ms = Date.now().toString().padStart(13, "0");
  _seqCounter = (_seqCounter + 1) % 100;
  return (ms + _seqCounter.toString().padStart(2, "0")).slice(-15);
}

/** Standard CRC-16 (Modbus) calculator. */
export function crc16Modbus(data: Buffer): number {
  let crc = 0xFFFF;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc & 1) ? (crc >>> 1) ^ 0xA001 : crc >>> 1;
    }
  }
  return crc;
}

/**
 * Best-effort parse of a Four-Faith DTU first-packet login.
 *
 * Observed in the F2816 COM4 capture: the modem sends ~14 bytes as the first
 * PSH,ACK after TCP connect. Format is binary (not ASCII "REG,..."). The
 * actual byte layout is governed by AT+HEXLOGIN configuration on the modem;
 * common shapes are:
 *   [ID:11–12 ASCII][trailer:2–3 binary]
 *   [len:1][ID:N ASCII][trailer]
 *   opaque hex blob
 *
 * We extract the longest printable-ASCII run as a device-ID candidate
 * (matches IMEI / FK-style serials / configured login strings). If nothing
 * usable falls out we fall back to a hex-based pseudo-ID so the device is
 * still uniquely tracked.
 */
export function tryParseDtuLogin(buf: Buffer): {
  candidateId: string;
  rawHex: string;
  printableRun: string | null;
  isLikelyLogin: boolean;
} | null {
  if (buf.length < 4 || buf.length > 64) return null;
  const rawHex = buf.toString("hex");

  let best = "";
  let cur = "";
  for (let i = 0; i < buf.length; i++) {
    const c = buf[i];
    if (c >= 0x20 && c <= 0x7e) {
      cur += String.fromCharCode(c);
      if (cur.length > best.length) best = cur;
    } else {
      cur = "";
    }
  }

  const printableRun = best.length >= 6 ? best : null;
  const isLikelyLogin = buf.length >= 8 && buf.length <= 32;

  return {
    candidateId: printableRun ?? `dev_${rawHex.slice(0, 16)}`,
    rawHex,
    printableRun,
    isLikelyLogin,
  };
}
