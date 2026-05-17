// Live cmd=8 Read with the FULL expanded READ_KEYS set, against whatever
// device is currently connected. Proves the new field<->AT map works end-to-end.
import WebSocket from "ws";
const URL = "wss://54.254.49.133/ws";
const WANT = process.argv[2] || null; // null = first live device
const KEYS = [
  // Work Mode
  "PROMODE","MQTTCLIENTID","MQTTPRODUCTKEY","MQTTUSERNAME","MQTTPASSWORD",
  "MQTTRECVTOPIC","MQTTSENDTOPIC","MQTTREPORPERIOD","MQTTBATCHREPORT",
  "MQTTCACHEEANBLE","SETHITV","SETHSTR","DEBUG","SERHC",
  // Central Server
  "IPAD1","PORT1","IPAD2","PORT2","TRNPRO",
  // Serial Port
  "IPR","SERMODE","SERBINDCNT","SETIPR2","SERMODE2","SERBINDCNT2",
  "RS485IPR","RS485SERMODE","RS485BINDCNT","GPSIPR","GPSSERMODE","GPSBINDCNT",
  // Wireless Dialing
  "APN","USERNAME","PASSWORD","PAUTH","NETMODE","FINDNETMODE","RDLWT","RETRY",
  "DNSSVR","DNSSV2",
  // SMS + read-only diagnostics
  "PHON","IDNT","STRAIGHT","DEVMODE","ENHRT","HEXLOGIN","LPORT","HTTPREQMODE",
  "PHONENOSHOW","HEXSMS","ENCODEHEXSMS","CSQ",
];
const ws = new WebSocket(URL, { rejectUnauthorized: false });
let live = [], target = null, fired = 0;
const t0 = Date.now();
const log = (...a) => console.log(`+${((Date.now()-t0)/1000).toFixed(1)}s`, ...a);
function pick() { return WANT || live[0] || null; }
function fire() {
  target = pick();
  if (!target) return;
  fired++;
  log(`fire #${fired} query_config ${target} (${KEYS.length} keys)`);
  ws.send(JSON.stringify({ type: "query_config", deviceCode: target, keys: KEYS }));
}
ws.on("open", () => log("WSS connected"));
ws.on("error", (e) => log("WS error", e.message));
ws.on("message", (raw) => {
  let m; try { m = JSON.parse(raw.toString()); } catch { return; }
  if (m.type === "live_devices") { live = m.devices || []; log("live_devices:", JSON.stringify(live)); fire(); }
  else if (m.type === "device_online") { if (!live.includes(m.deviceCode)) live.push(m.deviceCode); log("device_online:", m.deviceCode); if (!target) fire(); }
  else if (["read_started","read_progress","read_result","read_error"].includes(m.type)) {
    if (m.type === "read_started") log("read_started", m.keys?.length, "keys");
    else if (m.type === "read_progress") log("progress:", Object.keys(m.values||{}).length, "values so far");
    else if (m.type === "read_error") { log("READ ERROR:", m.reason); ws.close(); process.exit(1); }
    else if (m.type === "read_result") {
      const v = m.values || {};
      const n = Object.keys(v).length;
      log(`read_result complete=${m.complete} — ${n}/${KEYS.length} values:`);
      for (const k of KEYS) if (k in v) console.log(`    ${k} = ${JSON.stringify(v[k])}`);
      const missing = KEYS.filter((k) => !(k in v));
      if (missing.length) log("no value for:", missing.join(","));
      ws.close(); process.exit(n > 0 ? 0 : 1);
    }
  }
});
setInterval(() => { if (!fired) fire(); }, 12000);
setTimeout(() => { log("END (no result in 90s)"); ws.close(); process.exit(1); }, 90000);
