// Live cmd=8 Read via the production WSS bridge — no SSH needed.
import WebSocket from "ws";
const URL = "wss://54.254.49.133/ws";
const WANT = process.argv[2] || "99999998";
const KEYS = ["PROMODE","IDNT","PHON","STRAIGHT","DEVMODE","TRNPRO","ENHRT","HEXLOGIN","LPORT","MQTTCLIENTID","MQTTREPORPERIOD","MQTTSENDTOPIC","MQTTRECVTOPIC","DEBUG"];
const ws = new WebSocket(URL, { rejectUnauthorized: false });
let live = [], fired = 0;
const t0 = Date.now();
const log = (...a) => console.log(`+${((Date.now()-t0)/1000).toFixed(1)}s`, ...a);
function fire() {
  if (!live.includes(WANT)) return;
  fired++;
  log(`fire #${fired} query_config ${WANT}`);
  ws.send(JSON.stringify({ type: "query_config", deviceCode: WANT, keys: KEYS }));
}
ws.on("open", () => log("WSS connected"));
ws.on("error", (e) => log("WS error", e.message));
ws.on("close", () => log("WS closed"));
ws.on("message", (raw) => {
  let m; try { m = JSON.parse(raw.toString()); } catch { return; }
  if (m.type === "live_devices") { live = m.devices || []; log("live_devices:", JSON.stringify(live)); fire(); }
  else if (m.type === "device_online") { if (!live.includes(m.deviceCode)) live.push(m.deviceCode); log("device_online:", m.deviceCode); if (m.deviceCode===WANT) fire(); }
  else if (m.type === "device_offline" && m.deviceCode===WANT) { log("device_offline:", WANT); }
  else if (["read_started","read_progress","read_result","read_error","set_result"].includes(m.type)) {
    log("EVENT", m.type, JSON.stringify({ msgSeq:m.msgSeq, complete:m.complete, reason:m.reason, n:m.values?Object.keys(m.values).length:0, values:m.values, raw:(m.raw||"").slice(0,400) }));
    if (m.type === "read_result" && m.values && Object.keys(m.values).length) { log("SUCCESS — live values received"); ws.close(); process.exit(0); }
  }
});
// Re-fire every 12s for ~3min to catch a connected window.
setInterval(fire, 12000);
setTimeout(() => { log("END (3min, no populated read_result)"); ws.close(); process.exit(1); }, 180000);
