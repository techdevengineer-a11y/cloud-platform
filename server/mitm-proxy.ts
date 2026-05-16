/**
 * MITM capture proxy — sits between a real DTU and the real Four-Faith cloud
 * (iotplatform.fourfaith.com:10000) and logs every management frame both ways.
 *
 * Purpose: capture the EXACT wire bytes the real cloud emits for "Read"
 * (cmd=8 query) and "Set" (cmd=7) so we can implement them correctly in
 * fourfaith-cloud. We previously bricked the modem with a malformed cmd=8;
 * this proxy never synthesizes a long frame — it relays the real cloud's
 * already-correct bytes verbatim.
 *
 * The ONE active modification: the cloud→device cmd=1 (ServerAddrSync) reply
 * carries "<ip>\r<port>" telling the device where to (re)connect. Left alone,
 * the device would cut straight over to the real cloud and bypass us. We
 * rebuild that one short frame so it points back at this proxy, using the
 * verified buildShortMgmtFrame (correct LEN + Modbus CRC). Everything else is
 * forwarded byte-for-byte.
 *
 * Run:  tsx server/mitm-proxy.ts
 * Env:  MITM_LISTEN_PORT (10010) MITM_LISTEN_HOST (0.0.0.0)
 *       MITM_UPSTREAM_HOST (iotplatform.fourfaith.com) MITM_UPSTREAM_PORT (10000)
 *       MITM_PROXY_PUBLIC_IP (54.254.49.133) MITM_PROXY_PUBLIC_PORT (= listen port)
 *       MITM_LOG (.data/captures/mitm-<ts>.log) MITM_REWRITE_CMD1 (1)
 */
import net from "node:net";
import dns from "node:dns/promises";
import fs from "node:fs";
import path from "node:path";
import {
  parseMgmtFrame,
  buildShortMgmtFrame,
  MgmtCmd,
  MGMT_FRAME_DELIM,
} from "../lib/protocol";

const LISTEN_PORT = Number(process.env.MITM_LISTEN_PORT ?? 10010);
const LISTEN_HOST = process.env.MITM_LISTEN_HOST ?? "0.0.0.0";
const UPSTREAM_HOST = process.env.MITM_UPSTREAM_HOST ?? "iotplatform.fourfaith.com";
const UPSTREAM_PORT = Number(process.env.MITM_UPSTREAM_PORT ?? 10000);
const PUBLIC_IP = process.env.MITM_PROXY_PUBLIC_IP ?? "54.254.49.133";
const PUBLIC_PORT = Number(process.env.MITM_PROXY_PUBLIC_PORT ?? LISTEN_PORT);
const REWRITE_CMD1 = (process.env.MITM_REWRITE_CMD1 ?? "1") !== "0";
const MAX_INNER = 4096; // implausible LEN guard, matches the listener's resync behavior

const LOG_PATH =
  process.env.MITM_LOG ??
  path.join(
    process.cwd(),
    ".data",
    "captures",
    `mitm-${new Date().toISOString().replace(/[:.]/g, "-")}.log`,
  );
fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
const logStream = fs.createWriteStream(LOG_PATH, { flags: "a" });

function log(line: string) {
  const stamped = `${new Date().toISOString()} ${line}`;
  logStream.write(stamped + "\n");
  // eslint-disable-next-line no-console
  console.log(stamped);
}

function asciiPreview(buf: Buffer, max = 220): string {
  let s = "";
  for (let i = 0; i < Math.min(buf.length, max); i++) {
    const c = buf[i];
    s += c >= 0x20 && c <= 0x7e ? String.fromCharCode(c) : c === 0x0d ? "\\r" : c === 0x0a ? "\\n" : ".";
  }
  return s + (buf.length > max ? "…" : "");
}

type Dir = "DEV->CLOUD" | "CLOUD->DEV";

type NextResult =
  | { type: "frame"; raw: Buffer; consumed: number }
  | { type: "raw"; raw: Buffer; consumed: number }
  | { type: "need-more" };

/**
 * Pull the next unit off a per-direction buffer. Mirrors the tcp-listener's
 * framing: a unit is either a complete 7E…7E frame (LEN-delimited) or a run of
 * non-frame "raw" bytes (the FE+manaid heartbeat trailer, scanner garbage, or
 * a framing desync to resync past).
 */
function nextUnit(buf: Buffer): NextResult {
  if (buf.length === 0) return { type: "need-more" };

  if (buf[0] !== MGMT_FRAME_DELIM) {
    const idx = buf.indexOf(MGMT_FRAME_DELIM, 1);
    if (idx === -1) return { type: "raw", raw: buf.subarray(0), consumed: buf.length };
    return { type: "raw", raw: buf.subarray(0, idx), consumed: idx };
  }

  if (buf.length < 4) return { type: "need-more" };
  const innerLen = buf.readUInt16LE(1);
  if (innerLen < 1 || innerLen > MAX_INNER) {
    // implausible length — drop the leading 7E as raw and resync
    return { type: "raw", raw: buf.subarray(0, 1), consumed: 1 };
  }
  const totalWire = innerLen + 4; // 1 (7E) + 2 (LEN) + innerLen + 1 (7E)
  if (buf.length < totalWire) return { type: "need-more" };
  if (buf[totalWire - 1] !== MGMT_FRAME_DELIM) {
    return { type: "raw", raw: buf.subarray(0, 1), consumed: 1 };
  }
  return { type: "frame", raw: buf.subarray(0, totalWire), consumed: totalWire };
}

let connSeq = 0;

const server = net.createServer((deviceSock) => {
  const id = `c${++connSeq}`;
  const devRemote = `${deviceSock.remoteAddress}:${deviceSock.remotePort}`;
  log(`[${id}] DEVICE connect from ${devRemote}`);

  const cloudSock = new net.Socket();
  let cloudReady = false;
  const pendingToCloud: Buffer[] = [];
  let devBuf = Buffer.alloc(0);
  let cloudBuf = Buffer.alloc(0);
  let tlsWarned = false;

  function flushToCloud() {
    if (!cloudReady) return;
    while (pendingToCloud.length) cloudSock.write(pendingToCloud.shift()!);
  }

  cloudSock.connect(UPSTREAM_PORT, RESOLVED_UPSTREAM_IP, () => {
    cloudReady = true;
    log(`[${id}] UPSTREAM connected ${RESOLVED_UPSTREAM_IP}:${UPSTREAM_PORT} (${UPSTREAM_HOST})`);
    flushToCloud();
  });

  // ---- device → cloud : log + forward verbatim ----
  deviceSock.on("data", (chunk) => {
    if (!tlsWarned && chunk.length && chunk[0] === 0x16 && chunk[1] === 0x03) {
      tlsWarned = true;
      log(`[${id}] !! WARNING: first DEV byte looks like a TLS ClientHello (0x16 0x03). ` +
          `The mgmt channel may be TLS — plain MITM relay will not see cleartext frames.`);
    }
    devBuf = Buffer.concat([devBuf, chunk]);
    for (;;) {
      const u = nextUnit(devBuf);
      if (u.type === "need-more") break;
      const seg = devBuf.subarray(0, u.consumed);
      if (u.type === "frame") {
        const f = parseMgmtFrame(u.raw);
        if (f && f.kind === "short") {
          log(`[${id}] DEV->CLOUD short cmd=${f.cmd} mana=${f.manaId} len=${u.raw.length} | ${asciiPreview(f.payload)} | ${u.raw.toString("hex")}`);
        } else if (f && f.kind === "long") {
          log(`[${id}] DEV->CLOUD long  cmd=${f.cmd} seq=${f.msgSeq} len=${u.raw.length} | ${asciiPreview(Buffer.from(f.atText, "ascii"))} | ${u.raw.toString("hex")}`);
        } else {
          log(`[${id}] DEV->CLOUD frame(unparsed) len=${u.raw.length} | ${u.raw.toString("hex")}`);
        }
      } else {
        log(`[${id}] DEV->CLOUD raw   len=${seg.length} | ${asciiPreview(seg)} | ${seg.toString("hex")}`);
      }
      if (cloudReady) cloudSock.write(seg);
      else pendingToCloud.push(Buffer.from(seg));
      devBuf = devBuf.subarray(u.consumed);
    }
  });

  // ---- cloud → device : log, rewrite cmd=1, forward ----
  cloudSock.on("data", (chunk) => {
    cloudBuf = Buffer.concat([cloudBuf, chunk]);
    for (;;) {
      const u = nextUnit(cloudBuf);
      if (u.type === "need-more") break;
      let outBytes: Buffer = cloudBuf.subarray(0, u.consumed);

      if (u.type === "frame") {
        const f = parseMgmtFrame(u.raw);
        if (f && f.kind === "short") {
          log(`[${id}] CLOUD->DEV short cmd=${f.cmd} mana=${f.manaId} len=${u.raw.length} | ${asciiPreview(f.payload)} | ${u.raw.toString("hex")}`);
          if (REWRITE_CMD1 && f.cmd === MgmtCmd.ServerAddrSync && f.payload.length > 0) {
            const rebuilt = buildShortMgmtFrame(
              MgmtCmd.ServerAddrSync,
              f.manaId,
              `${PUBLIC_IP}\r${PUBLIC_PORT}`,
            );
            log(`[${id}] CLOUD->DEV !! REWRITE cmd=1 server-addr "${asciiPreview(f.payload)}" -> "${PUBLIC_IP}\\r${PUBLIC_PORT}" ` +
                `orig=${u.raw.toString("hex")} new=${rebuilt.toString("hex")}`);
            outBytes = rebuilt;
          }
        } else if (f && f.kind === "long") {
          const txt = f.atText;
          log(`[${id}] CLOUD->DEV long  cmd=${f.cmd} seq=${f.msgSeq} len=${u.raw.length} | ${asciiPreview(Buffer.from(txt, "ascii"))} | ${u.raw.toString("hex")}`);
          if (/MANSVR(ADD|PORT)?/i.test(txt)) {
            log(`[${id}] CLOUD->DEV !! WARNING: cmd=${f.cmd} contains a service-address change (AT+MANSVR…). ` +
                `Left UNMODIFIED to keep the capture faithful — the device may redirect off this proxy after it applies.`);
          }
          if (/AT\+RESET/i.test(txt)) {
            log(`[${id}] CLOUD->DEV (note) cmd=${f.cmd} contains AT+RESET — device will reboot and re-handshake.`);
          }
        } else {
          log(`[${id}] CLOUD->DEV frame(unparsed) len=${u.raw.length} | ${u.raw.toString("hex")}`);
        }
      } else {
        log(`[${id}] CLOUD->DEV raw   len=${outBytes.length} | ${asciiPreview(outBytes)} | ${outBytes.toString("hex")}`);
      }

      deviceSock.write(outBytes);
      cloudBuf = cloudBuf.subarray(u.consumed);
    }
  });

  function shutdown(reason: string) {
    log(`[${id}] close (${reason})`);
    deviceSock.destroy();
    cloudSock.destroy();
  }
  deviceSock.on("close", () => shutdown("device closed"));
  cloudSock.on("close", () => shutdown("cloud closed"));
  deviceSock.on("error", (e) => log(`[${id}] device error ${e.message}`));
  cloudSock.on("error", (e) => log(`[${id}] cloud error ${e.message}`));
});

let RESOLVED_UPSTREAM_IP = UPSTREAM_HOST;

(async () => {
  try {
    const { address } = await dns.lookup(UPSTREAM_HOST, { family: 4 });
    RESOLVED_UPSTREAM_IP = address;
  } catch (e: any) {
    log(`!! DNS lookup of ${UPSTREAM_HOST} failed (${e.message}) — using literal as host`);
  }
  server.listen(LISTEN_PORT, LISTEN_HOST, () => {
    log(`MITM proxy listening on ${LISTEN_HOST}:${LISTEN_PORT}`);
    log(`  upstream  : ${UPSTREAM_HOST} -> ${RESOLVED_UPSTREAM_IP}:${UPSTREAM_PORT}`);
    log(`  rewrite   : cmd=1 server-addr -> ${PUBLIC_IP}:${PUBLIC_PORT} (${REWRITE_CMD1 ? "ON" : "OFF"})`);
    log(`  log file  : ${LOG_PATH}`);
  });
})();
