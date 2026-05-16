"use client";
import { useEffect, useMemo, useState } from "react";
import { X, Info, Save, RefreshCw, Settings as SettingsIcon, Loader2, Shield, History, ShieldCheck, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select, Label } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { DEFAULT_CONFIG, type AppConfig } from "@/lib/default-config";
import { useWebSocket } from "@/lib/use-ws";
import { DiffModal } from "./DiffModal";
import { SnapshotsModal } from "./SnapshotsModal";

/**
 * AT-key ↔ config-path mapping. Only high-confidence keys (verified by name +
 * the 2026-05-17 real-cloud Read capture) are folded back into the form so a
 * wrong guess can't corrupt the config. Every returned key is still shown raw
 * in the "Live device values" panel. `toCfg` parses the device string into the
 * config value; `toAt` formats the config value back into an AT value.
 */
type AtMapEntry = {
  path: [keyof AppConfig, string];
  toCfg: (s: string) => any;
  toAt: (v: any) => string;
};
const S = { toCfg: (s: string) => s, toAt: (v: any) => String(v ?? "") };
const N = { toCfg: (s: string) => (s === "" ? 0 : Number(s)), toAt: (v: any) => String(v ?? 0) };
const ONOFF = { toCfg: (s: string) => (s === "1" || s.toLowerCase() === "on" ? "On" : "Off"), toAt: (v: any) => (v === "On" || v === true ? "1" : "0") };

const AT_MAP: Record<string, AtMapEntry> = {
  PROMODE:         { path: ["workMode", "workAgreement"], ...S },
  MQTTCLIENTID:    { path: ["workMode", "clientId"], ...S },
  MQTTPRODUCTKEY:  { path: ["workMode", "productKey"], ...S },
  MQTTUSERNAME:    { path: ["workMode", "username"], ...S },
  MQTTPASSWORD:    { path: ["workMode", "password"], ...S },
  MQTTRECVTOPIC:   { path: ["workMode", "takeOverTopic"], ...S },
  MQTTSENDTOPIC:   { path: ["workMode", "sendTopic"], ...S },
  MQTTREPORPERIOD: { path: ["workMode", "reportInterval"], ...N },
  MQTTBATCHREPORT: { path: ["workMode", "batchReportsNum"], ...N },
  MQTTCACHEEANBLE: { path: ["workMode", "dataCache"], ...ONOFF },
  SETHSTR:         { path: ["workMode", "heartbeatString"], ...S },
  DEBUG:           { path: ["workMode", "debugLevel"], ...N },
};

// Keys the Read button queries from the device (cmd=8). The mapped set plus a
// few read-only diagnostics the real cloud also reads.
const READ_KEYS = [
  "PROMODE", "IDNT", "PHON", "STRAIGHT", "DEVMODE", "TRNPRO", "ENHRT", "HEXLOGIN",
  "LPORT", "HTTPREQMODE", "MQTTCLIENTID", "MQTTPRODUCTKEY", "MQTTUSERNAME",
  "MQTTREPORPERIOD", "MQTTPASSWORD", "MQTTBATCHREPORT", "MQTTRECVTOPIC",
  "MQTTCACHEEANBLE", "MQTTSENDTOPIC", "SETHITV", "SETHSTR", "DEBUG",
];

const TABS = [
  { key: "workMode",            label: "Work Mode" },
  { key: "centralServer",       label: "Central Server" },
  { key: "serialPort",          label: "Serial Port Config" },
  { key: "ioApp",               label: "I/O App" },
  { key: "wirelessDialing",     label: "Wireless Dialing" },
  { key: "globalParameters",    label: "Global Parameters" },
  { key: "smsSettings",         label: "SMS Settings" },
  { key: "deviceManager",       label: "Device Manager" },
  { key: "otherParameters",     label: "Other Parameters" },
  { key: "gpsSettings",         label: "GPS Settings" },
  { key: "modbusConfiguration", label: "Modbus Configuration" },
] as const;

type TabKey = typeof TABS[number]["key"];

export function ConfigModal({
  open,
  onClose,
  deviceCode,
  deviceName,
}: {
  open: boolean;
  onClose: () => void;
  deviceCode: string;
  deviceName: string;
}) {
  const [active, setActive] = useState<TabKey>("workMode");
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG);
  const [savedConfig, setSavedConfig] = useState<AppConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [pending, setPending] = useState<{ applied_at: number; revert_at: number } | null>(null);
  const [diffOpen, setDiffOpen] = useState(false);
  const [snapsOpen, setSnapsOpen] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [liveValues, setLiveValues] = useState<Record<string, string>>({});
  const [reading, setReading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [deviceMsg, setDeviceMsg] = useState<string | null>(null);

  function applyAtValuesToConfig(values: Record<string, string>) {
    setConfig((prev) => {
      const next: any = { ...prev };
      for (const [k, raw] of Object.entries(values)) {
        const m = AT_MAP[k];
        if (!m) continue;
        const [sec, field] = m.path;
        next[sec] = { ...(next[sec] as object), [field]: m.toCfg(raw) };
      }
      return next as AppConfig;
    });
  }

  const { liveDevices, send: wsSend } = useWebSocket((ev: any) => {
    if (ev?.deviceCode !== deviceCode) return;
    if (ev.type === "read_started") {
      setReading(true);
      setDeviceMsg(`Reading ${ev.keys.length} params from device…`);
    } else if (ev.type === "read_progress" || ev.type === "set_progress") {
      setLiveValues((p) => ({ ...p, ...ev.values }));
    } else if (ev.type === "read_result") {
      setLiveValues((p) => ({ ...p, ...ev.values }));
      applyAtValuesToConfig(ev.values);
      setReading(false);
      setDeviceMsg(
        ev.complete
          ? `Read complete — ${Object.keys(ev.values).length} live values`
          : `Read timed out — got ${Object.keys(ev.values).length} (${ev.reason ?? ""})`,
      );
    } else if (ev.type === "read_error") {
      setReading(false);
      setDeviceMsg(`Read failed: ${ev.reason}`);
    } else if (ev.type === "push_result") {
      setApplying(false);
      setDeviceMsg(ev.ok ? `Applied to device (cmd=7, ${ev.bytes}B)` : `Apply failed: ${ev.reason}`);
    } else if (ev.type === "set_result") {
      setDeviceMsg(ev.complete ? `Device acknowledged the change` : `Set ack timed out`);
    }
  });
  const deviceLive = liveDevices.has(deviceCode);

  useEffect(() => {
    if (!open || !deviceCode) return;
    setLoading(true);
    fetch(`/api/devices/${deviceCode}/config`)
      .then((r) => r.json())
      .then((data) => {
        const merged = { ...DEFAULT_CONFIG, ...data.data };
        setConfig(merged);
        setSavedConfig(merged);
        setSavedAt(data.updated_at);
        setPending(data.pending);
      })
      .finally(() => setLoading(false));
  }, [open, deviceCode]);

  if (!open) return null;

  const update = <K extends keyof AppConfig>(section: K, patch: Partial<AppConfig[K]>) => {
    setConfig((prev) => ({ ...prev, [section]: { ...(prev[section] as object), ...patch } }));
  };

  async function applySave(typedCode: string) {
    setSaving(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/devices/${deviceCode}/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config, confirmCriticalCode: typedCode }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.message ?? data.error ?? "Save failed");
        return;
      }
      setSavedConfig(config);
      setSavedAt(data.updated_at);
      if (data.auto_revert_at) {
        setPending({ applied_at: data.updated_at, revert_at: data.auto_revert_at });
      }
      setDiffOpen(false);
    } finally {
      setSaving(false);
    }
  }

  async function handleConfirmCommit() {
    await fetch(`/api/devices/${deviceCode}/commit`, { method: "POST" });
    setPending(null);
  }
  async function handleRevertCommit() {
    if (!confirm("Revert to the previous config? This will discard the change you just made.")) return;
    await fetch(`/api/devices/${deviceCode}/commit`, { method: "DELETE" });
    setPending(null);
    // reload config
    const data = await (await fetch(`/api/devices/${deviceCode}/config`)).json();
    setConfig({ ...DEFAULT_CONFIG, ...data.data });
    setSavedConfig({ ...DEFAULT_CONFIG, ...data.data });
    setSavedAt(data.updated_at);
  }

  // Read = live cmd=8 query of the device (like the real Four-Faith cloud).
  // Falls back to the stored DB config if the device isn't connected.
  async function handleRead() {
    setDeviceMsg(null);
    if (deviceLive) {
      const sent = wsSend({ type: "query_config", deviceCode, keys: READ_KEYS });
      if (sent) {
        setReading(true);
        return;
      }
      setDeviceMsg("WebSocket not ready — falling back to stored config");
    } else {
      setDeviceMsg("Device offline — showing last stored config (not live)");
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/devices/${deviceCode}/config`);
      const data = await res.json();
      const merged = { ...DEFAULT_CONFIG, ...data.data };
      setConfig(merged);
      setSavedConfig(merged);
      setSavedAt(data.updated_at);
      setPending(data.pending);
    } finally {
      setLoading(false);
    }
  }

  // Apply the mapped config fields to the device as a cmd=7 Set. The listener
  // enforces verify-then-send (frame must match the captured real-cloud format).
  function handleApplyDevice() {
    if (!deviceLive) {
      setDeviceMsg("Device offline — can't apply to device");
      return;
    }
    const atVars: Record<string, string> = {};
    for (const [atKey, m] of Object.entries(AT_MAP)) {
      const [sec, field] = m.path;
      atVars[atKey] = m.toAt((config[sec] as any)?.[field]);
    }
    const sent = wsSend({ type: "push_config", deviceCode, atVars });
    if (sent) {
      setApplying(true);
      setDeviceMsg(`Applying ${Object.keys(atVars).length} params to device…`);
    } else {
      setDeviceMsg("WebSocket not ready — try again");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="relative w-full max-w-5xl max-h-[92vh] bg-white rounded-xl shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 h-14 border-b border-slate-100 bg-slate-50/60">
          <div className="flex items-center gap-3">
            <SettingsIcon className="h-4 w-4 text-blue-600" />
            <span className="font-semibold text-slate-900">Config</span>
            <span className="text-sm text-slate-500">·</span>
            <span className="text-sm text-slate-600">{deviceName}</span>
            <span className="font-mono text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-600">{deviceCode}</span>
          </div>
          <button onClick={onClose} className="h-8 w-8 rounded-md hover:bg-slate-100 flex items-center justify-center text-slate-500">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Tip */}
        <div className="mx-6 mt-4 tip-banner rounded-lg p-3 flex items-start gap-3">
          <div className="h-7 w-7 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
            <Info className="h-4 w-4 text-blue-600" />
          </div>
          <div>
            <div className="text-sm font-semibold text-slate-900">Kind Tips</div>
            <div className="text-xs text-slate-600 mt-0.5">
              Remote config: 1. Modify config items, 2. Save Settings, 3. Apply, 4. Restart. The modified config takes effect only after the restart.
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 flex min-h-0 mt-4 mx-6 mb-4 border border-slate-100 rounded-lg overflow-hidden">
          <div className="w-52 bg-slate-50/50 border-r border-slate-100 overflow-y-auto py-2">
            <div className="px-4 py-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Config Panel</div>
            <nav className="space-y-0.5 px-2">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setActive(t.key)}
                  className={cn(
                    "w-full text-left px-3 py-2 rounded-md text-sm transition-colors",
                    active === t.key
                      ? "bg-blue-50 text-blue-700 font-medium"
                      : "text-slate-600 hover:bg-slate-100"
                  )}
                >
                  {t.label}
                </button>
              ))}
            </nav>
          </div>
          <div className="flex-1 overflow-y-auto p-6 bg-white">
            {loading ? (
              <div className="flex items-center justify-center h-40 text-slate-400 gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading config…
              </div>
            ) : (
              <TabPanel section={active} config={config} update={update} deviceCode={deviceCode} />
            )}
          </div>
        </div>

        {/* Pending commit banner */}
        {pending && (
          <div className="mx-6 mb-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 flex items-center justify-between text-sm">
            <div className="flex items-center gap-2 text-amber-800">
              <Clock className="h-4 w-4" />
              <span>
                <strong>Auto-revert pending:</strong> if device doesn't confirm by{" "}
                <span className="font-mono">{new Date(pending.revert_at).toLocaleTimeString()}</span>,
                previous config will be restored.
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={handleRevertCommit}>Revert Now</Button>
              <Button size="sm" variant="primary" onClick={handleConfirmCommit}>
                <ShieldCheck className="h-3 w-3" /> Confirm Healthy
              </Button>
            </div>
          </div>
        )}

        {/* Error banner */}
        {errorMsg && (
          <div className="mx-6 mb-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
            {errorMsg}
          </div>
        )}

        {/* Live device status / read-result banner */}
        {deviceMsg && (
          <div className="mx-6 mb-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm text-blue-700 flex items-center gap-2">
            {(reading || applying) && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            <span>{deviceMsg}</span>
            {Object.keys(liveValues).length > 0 && (
              <span className="ml-auto font-mono text-[11px] text-blue-500">
                {Object.keys(liveValues).length} live key(s) — see fields populated
              </span>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between px-6 h-14 border-t border-slate-100 bg-slate-50/60">
          <div className="flex items-center gap-3 text-xs text-slate-500">
            {savedAt
              ? <>Last saved <span className="font-mono">{new Date(savedAt).toLocaleString()}</span></>
              : <>Not yet saved</>}
            <span className="text-slate-300">·</span>
            <span className="inline-flex items-center gap-1 text-emerald-700">
              <Shield className="h-3 w-3" /> Safety guards active
            </span>
            <span className="text-slate-300">·</span>
            <span className={cn("inline-flex items-center gap-1", deviceLive ? "text-emerald-700" : "text-slate-400")}>
              <span className={cn("h-1.5 w-1.5 rounded-full", deviceLive ? "bg-emerald-500" : "bg-slate-300")} />
              {deviceLive ? "Device live" : "Device offline"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="md" onClick={() => setSnapsOpen(true)}>
              <History className="h-3.5 w-3.5" /> History
            </Button>
            <Button variant="outline" size="md" onClick={handleRead} disabled={loading || reading}>
              <RefreshCw className={cn("h-3.5 w-3.5", (loading || reading) && "animate-spin")} />
              {deviceLive ? "Read (live)" : "Read"}
            </Button>
            <Button variant="outline" size="md" onClick={handleApplyDevice} disabled={!deviceLive || applying} title="Push mapped params to the device as cmd=7 (verify-then-send)">
              <SettingsIcon className={cn("h-3.5 w-3.5", applying && "animate-spin")} />
              Apply to device
            </Button>
            <Button variant="primary" size="md" onClick={() => { setErrorMsg(null); setDiffOpen(true); }} disabled={saving}>
              <Save className="h-3.5 w-3.5" />
              Review & Save
            </Button>
          </div>
        </div>
      </div>

      <DiffModal
        open={diffOpen}
        onClose={() => setDiffOpen(false)}
        onConfirm={applySave}
        deviceCode={deviceCode}
        deviceName={deviceName}
        oldConfig={savedConfig}
        newConfig={config}
        saving={saving}
      />
      <SnapshotsModal
        open={snapsOpen}
        onClose={() => setSnapsOpen(false)}
        deviceCode={deviceCode}
        onRestored={handleRead}
      />
    </div>
  );
}

/* ---------- Section helpers ---------- */
function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
      {hint && <p className="text-[11px] text-slate-400">{hint}</p>}
    </div>
  );
}
function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h4 className="text-sm font-semibold text-slate-900 mb-3 mt-2 first:mt-0">{children}</h4>;
}

/* ---------- Tab panels ---------- */
function TabPanel({
  section, config, update, deviceCode,
}: {
  section: TabKey;
  config: AppConfig;
  update: <K extends keyof AppConfig>(s: K, p: Partial<AppConfig[K]>) => void;
  deviceCode: string;
}) {
  switch (section) {
    case "workMode":
      return <WorkModeTab c={config.workMode} u={(p) => update("workMode", p)} deviceCode={deviceCode} />;
    case "centralServer":
      return <CentralServerTab c={config.centralServer} u={(p) => update("centralServer", p)} />;
    case "serialPort":
      return <SerialPortTab c={config.serialPort} u={(p) => update("serialPort", p)} />;
    case "ioApp":
      return <IoAppTab c={config.ioApp} u={(p) => update("ioApp", p)} />;
    case "wirelessDialing":
      return <WirelessDialingTab c={config.wirelessDialing} u={(p) => update("wirelessDialing", p)} />;
    case "globalParameters":
      return <GlobalParametersTab c={config.globalParameters} u={(p) => update("globalParameters", p)} />;
    case "smsSettings":
      return <SmsSettingsTab c={config.smsSettings} u={(p) => update("smsSettings", p)} />;
    case "deviceManager":
      return <DeviceManagerTab c={config.deviceManager} u={(p) => update("deviceManager", p)} />;
    case "otherParameters":
      return <OtherParametersTab c={config.otherParameters} u={(p) => update("otherParameters", p)} />;
    case "gpsSettings":
      return <GpsSettingsTab c={config.gpsSettings} u={(p) => update("gpsSettings", p)} />;
    case "modbusConfiguration":
      return <ModbusConfigurationTab c={config.modbusConfiguration} u={(p) => update("modbusConfiguration", p)} />;
  }
}

function WorkModeTab({ c, u, deviceCode }: any) {
  return (
    <div className="space-y-6">
      <div>
        <SectionTitle>Connection Protocol Settings</SectionTitle>
        <div className="grid grid-cols-2 gap-x-6 gap-y-4">
          <Field label="Work Agreement:">
            <Select value={c.workAgreement} onChange={(e) => u({ workAgreement: e.target.value })}>
              {["DCUDP","DCTCP","TRNS","SMSCLI","SMSSER","HTTP","MTCP/MRTU","MQTT"].map((v) => <option key={v}>{v}</option>)}
            </Select>
          </Field>
          <Field label="Client ID:">
            <Input value={c.clientId || `FK${deviceCode}`} onChange={(e) => u({ clientId: e.target.value })} maxLength={40} />
          </Field>
          <Field label="Product KEY:">
            <Input value={c.productKey} onChange={(e) => u({ productKey: e.target.value })} />
          </Field>
          <Field label="Username:">
            <Input value={c.username} onChange={(e) => u({ username: e.target.value })} maxLength={40} />
          </Field>
          <Field label="Report Interval(min):">
            <Input type="number" value={c.reportInterval} onChange={(e) => u({ reportInterval: +e.target.value })} />
          </Field>
          <Field label="Password:">
            <Input type="password" value={c.password} onChange={(e) => u({ password: e.target.value })} maxLength={40} />
          </Field>
          <Field label="Batch Reports Num:">
            <Input type="number" value={c.batchReportsNum} onChange={(e) => u({ batchReportsNum: +e.target.value })} />
          </Field>
          <Field label="Take Over Topic:">
            <Input value={c.takeOverTopic} onChange={(e) => u({ takeOverTopic: e.target.value })} maxLength={79} />
          </Field>
          <Field label="Data Cache:">
            <Select value={c.dataCache} onChange={(e) => u({ dataCache: e.target.value })}>
              <option>Off</option><option>On</option>
            </Select>
          </Field>
          <Field label="Send Topic:">
            <Input value={c.sendTopic || `sngpl/telemetry/FK${deviceCode}/data`} onChange={(e) => u({ sendTopic: e.target.value })} maxLength={79} />
          </Field>
        </div>
      </div>
      <div>
        <SectionTitle>Heartbeat</SectionTitle>
        <div className="grid grid-cols-2 gap-x-6 gap-y-4">
          <Field label="Heartbeat Interval(s):">
            <Input type="number" value={c.heartbeatInterval} onChange={(e) => u({ heartbeatInterval: +e.target.value })} />
          </Field>
          <Field label="Heartbeat String:">
            <Input value={c.heartbeatString} onChange={(e) => u({ heartbeatString: e.target.value })} maxLength={127} />
          </Field>
        </div>
      </div>
      <div>
        <SectionTitle>Debug Info</SectionTitle>
        <div className="grid grid-cols-2 gap-x-6 gap-y-4">
          <Field label="Debug Level:">
            <Select value={c.debugLevel} onChange={(e) => u({ debugLevel: +e.target.value })}>
              {[0,1,2,3,4,5].map((n) => <option key={n} value={n}>{n}</option>)}
            </Select>
          </Field>
        </div>
      </div>
      <div>
        <SectionTitle>Other</SectionTitle>
        <div className="grid grid-cols-2 gap-x-6 gap-y-4">
          <Field label="Clear Serial Cache:">
            <Select value={c.clearSerialCache} onChange={(e) => u({ clearSerialCache: e.target.value })}>
              <option>Off</option><option>On</option>
            </Select>
          </Field>
        </div>
      </div>
    </div>
  );
}

function CentralServerTab({ c, u }: any) {
  return (
    <div className="space-y-6">
      <SectionTitle>Primary Server</SectionTitle>
      <div className="grid grid-cols-2 gap-x-6 gap-y-4">
        <Field label="Server IP:">
          <Input value={c.serverIp} onChange={(e) => u({ serverIp: e.target.value })} />
        </Field>
        <Field label="Server Port:">
          <Input type="number" value={c.serverPort} onChange={(e) => u({ serverPort: +e.target.value })} />
        </Field>
        <Field label="Protocol:">
          <Select value={c.protocol} onChange={(e) => u({ protocol: e.target.value })}>
            <option>TCP</option><option>UDP</option>
          </Select>
        </Field>
      </div>
      <SectionTitle>Backup Server</SectionTitle>
      <div className="grid grid-cols-2 gap-x-6 gap-y-4">
        <Field label="Backup Server IP:">
          <Input value={c.backupServerIp} onChange={(e) => u({ backupServerIp: e.target.value })} />
        </Field>
        <Field label="Backup Server Port:">
          <Input type="number" value={c.backupServerPort} onChange={(e) => u({ backupServerPort: +e.target.value })} />
        </Field>
      </div>
    </div>
  );
}

function SerialPortTab({ c, u }: any) {
  const Row = ({ title, port, k }: { title: string; port: any; k: string }) => (
    <div>
      <SectionTitle>{title}</SectionTitle>
      <div className="grid grid-cols-3 gap-x-6 gap-y-4">
        <Field label={k === "rs485" ? "RS485IPR:" : k === "gps" ? "GPS IPR:" : "IPR:"}>
          <Select value={port.ipr} onChange={(e) => u({ [k]: { ...port, ipr: +e.target.value } })}>
            {[2400,4800,9600,19200,38400,57600,115200,230400].map((v) => <option key={v} value={v}>{v}</option>)}
          </Select>
        </Field>
        <Field label="SER Mode:">
          <Select value={port.serMode} onChange={(e) => u({ [k]: { ...port, serMode: e.target.value } })}>
            {["8N1","8N2","8E1","8O1","7N1","7E1"].map((v) => <option key={v}>{v}</option>)}
          </Select>
        </Field>
        <Field label="Bind CNT:">
          <Select value={port.bindCnt} onChange={(e) => u({ [k]: { ...port, bindCnt: e.target.value } })}>
            {["ALL","None","RS232-1","RS232-2","RS485","GPS"].map((v) => <option key={v}>{v}</option>)}
          </Select>
        </Field>
      </div>
    </div>
  );
  return (
    <div className="space-y-5">
      <Row title="RS232-1" port={c.rs232_1} k="rs232_1" />
      <Row title="RS232-2" port={c.rs232_2} k="rs232_2" />
      <Row title="RS485"   port={c.rs485}   k="rs485" />
      <Row title="GPS"     port={c.gps}     k="gps" />
    </div>
  );
}

function IoAppTab({ c, u }: any) {
  return (
    <div className="space-y-6">
      <SectionTitle>I/O Application</SectionTitle>
      <div className="grid grid-cols-2 gap-x-6 gap-y-4">
        <Field label="Enabled:">
          <Select value={c.enabled ? "On" : "Off"} onChange={(e) => u({ enabled: e.target.value === "On" })}>
            <option>Off</option><option>On</option>
          </Select>
        </Field>
        <Field label="Digital Inputs:">
          <Input type="number" value={c.digitalInputs} onChange={(e) => u({ digitalInputs: +e.target.value })} />
        </Field>
        <Field label="Digital Outputs:">
          <Input type="number" value={c.digitalOutputs} onChange={(e) => u({ digitalOutputs: +e.target.value })} />
        </Field>
        <Field label="Analog Inputs:">
          <Input type="number" value={c.analogInputs} onChange={(e) => u({ analogInputs: +e.target.value })} />
        </Field>
      </div>
    </div>
  );
}

function WirelessDialingTab({ c, u }: any) {
  return (
    <div className="space-y-6">
      <div>
        <SectionTitle>PP Dial</SectionTitle>
        <div className="grid grid-cols-2 gap-x-6 gap-y-4">
          <Field label="Dial Number:"><Input value={c.dialNumber} onChange={(e) => u({ dialNumber: e.target.value })} /></Field>
          <Field label="Find Net Mode:">
            <Select value={c.findNetMode} onChange={(e) => u({ findNetMode: e.target.value })}>
              {["AUTO","2G","3G","4G","LTE","5G"].map((v) => <option key={v}>{v}</option>)}
            </Select>
          </Field>
          <Field label="APN:"><Input value={c.apn} onChange={(e) => u({ apn: e.target.value })} /></Field>
          <Field label="Username:"><Input value={c.username} onChange={(e) => u({ username: e.target.value })} /></Field>
          <Field label="Password:"><Input type="password" value={c.password} onChange={(e) => u({ password: e.target.value })} /></Field>
          <Field label="PPP Cert.:">
            <Select value={c.pppCert} onChange={(e) => u({ pppCert: e.target.value })}>
              {["AUTO","PAP","CHAP","NONE"].map((v) => <option key={v}>{v}</option>)}
            </Select>
          </Field>
          <Field label="Net Mode:">
            <Select value={c.netMode} onChange={(e) => u({ netMode: e.target.value })}>
              {["AUTO","Manual"].map((v) => <option key={v}>{v}</option>)}
            </Select>
          </Field>
        </div>
      </div>
      <div>
        <SectionTitle>PPP Redial Settings</SectionTitle>
        <div className="grid grid-cols-2 gap-x-6 gap-y-4">
          <Field label="PPP Redial Interval(s):"><Input type="number" value={c.pppRedialInterval} onChange={(e) => u({ pppRedialInterval: +e.target.value })} /></Field>
          <Field label="Redials Max Number:"><Input type="number" value={c.redialsMaxNumber} onChange={(e) => u({ redialsMaxNumber: +e.target.value })} /></Field>
        </div>
      </div>
      <div>
        <SectionTitle>DNS Service Settings</SectionTitle>
        <div className="grid grid-cols-2 gap-x-6 gap-y-4">
          <Field label="Primary DNS Server:"><Input value={c.primaryDns} onChange={(e) => u({ primaryDns: e.target.value })} /></Field>
          <Field label="Prepare DNS Server:"><Input value={c.prepareDns} onChange={(e) => u({ prepareDns: e.target.value })} /></Field>
        </div>
      </div>
    </div>
  );
}

function GlobalParametersTab({ c, u }: any) {
  return (
    <div className="space-y-6">
      <div>
        <SectionTitle>PPP Link Detection</SectionTitle>
        <div className="grid grid-cols-2 gap-x-6 gap-y-4">
          <Field label="PPP Layer Detection:">
            <Select value={c.pppLayerDetection} onChange={(e) => u({ pppLayerDetection: e.target.value })}>
              <option>Off</option><option>On</option>
            </Select>
          </Field>
        </div>
      </div>
      <div>
        <SectionTitle>Data Frame Settings</SectionTitle>
        <div className="grid grid-cols-2 gap-x-6 gap-y-4">
          <Field label="Data Frame Interval(MS):"><Input type="number" value={c.dataFrameInterval} onChange={(e) => u({ dataFrameInterval: +e.target.value })} /></Field>
          <Field label="MTU Length:"><Input type="number" value={c.mtuLength} onChange={(e) => u({ mtuLength: +e.target.value })} /></Field>
        </div>
      </div>
      <div>
        <SectionTitle>Data Sending Failure Parameter Settings</SectionTitle>
        <div className="grid grid-cols-2 gap-x-6 gap-y-4">
          <Field label="Res Wait(MS):"><Input type="number" value={c.resWait} onChange={(e) => u({ resWait: +e.target.value })} /></Field>
          <Field label="Max Res Times:"><Input type="number" value={c.maxResTimes} onChange={(e) => u({ maxResTimes: +e.target.value })} /></Field>
          <Field label="AFT Fail:">
            <Select value={c.aftFail} onChange={(e) => u({ aftFail: e.target.value })}>
              <option>Reconnect</option><option>Restart</option><option>Ignore</option>
            </Select>
          </Field>
          <Field label="Wait Fail(MS):"><Input type="number" value={c.waitFail} onChange={(e) => u({ waitFail: +e.target.value })} /></Field>
        </div>
      </div>
      <div>
        <SectionTitle>Other</SectionTitle>
        <div className="grid grid-cols-2 gap-x-6 gap-y-4">
          <Field label="SMS Center:"><Input value={c.smsCenter} onChange={(e) => u({ smsCenter: e.target.value })} maxLength={15} /></Field>
          <Field label="Heartbeat Interval:"><Input type="number" value={c.heartbeatInterval} onChange={(e) => u({ heartbeatInterval: +e.target.value })} /></Field>
        </div>
      </div>
      <div>
        <SectionTitle>MODBUS</SectionTitle>
        <div className="grid grid-cols-2 gap-x-6 gap-y-4">
          <Field label="MODBUS Device No:"><Input type="number" value={c.modbusDeviceNo} onChange={(e) => u({ modbusDeviceNo: +e.target.value })} /></Field>
        </div>
      </div>
    </div>
  );
}

function SmsSettingsTab({ c, u }: any) {
  return (
    <div className="space-y-6">
      <SectionTitle>SMS Settings</SectionTitle>
      <div className="grid grid-cols-2 gap-x-6 gap-y-4">
        <Field label="SMS Config:">
          <Select value={c.smsConfig} onChange={(e) => u({ smsConfig: e.target.value })}>
            <option>Off</option><option>On</option>
          </Select>
        </Field>
        {c.smsConfig === "On" && (
          <>
            <Field label="Authorized Phone Numbers:"><Input value={c.phoneNumbers} onChange={(e) => u({ phoneNumbers: e.target.value })} /></Field>
            <Field label="SMS Ack:">
              <Select value={c.smsAck} onChange={(e) => u({ smsAck: e.target.value })}>
                <option>Off</option><option>On</option>
              </Select>
            </Field>
          </>
        )}
      </div>
    </div>
  );
}

function DeviceManagerTab({ c, u }: any) {
  return (
    <div className="space-y-6">
      <div>
        <SectionTitle>Device Platform Settings</SectionTitle>
        <div className="grid grid-cols-2 gap-x-6 gap-y-4">
          <Field label="Manager Platform:">
            <Select value={c.managerPlatform} onChange={(e) => u({ managerPlatform: e.target.value })}>
              <option>On</option><option>Off</option>
            </Select>
          </Field>
          <Field label="Platform ID:"><Input value={c.platformId} onChange={(e) => u({ platformId: e.target.value })} maxLength={8} /></Field>
          <Field label="Transfer Protocol:">
            <Select value={c.transferProtocol} onChange={(e) => u({ transferProtocol: e.target.value })}>
              <option>TCP</option><option>UDP</option>
            </Select>
          </Field>
          <Field label="Server Ip:"><Input value={c.serverIp} onChange={(e) => u({ serverIp: e.target.value })} /></Field>
          <Field label="Port:"><Input type="number" value={c.port} onChange={(e) => u({ port: +e.target.value })} /></Field>
        </div>
      </div>
      <div>
        <SectionTitle>NTP School Time</SectionTitle>
        <div className="grid grid-cols-2 gap-x-6 gap-y-4">
          <Field label="NTP Interval:"><Input type="number" value={c.ntpInterval} onChange={(e) => u({ ntpInterval: +e.target.value })} /></Field>
          <Field label="NTP Server:"><Input value={c.ntpServer} onChange={(e) => u({ ntpServer: e.target.value })} /></Field>
        </div>
      </div>
    </div>
  );
}

function OtherParametersTab({ c, u }: any) {
  return (
    <div className="space-y-6">
      <SectionTitle>Web & Remote Access</SectionTitle>
      <div className="grid grid-cols-2 gap-x-6 gap-y-4">
        <Field label="Web Port:"><Input type="number" value={c.webPort} onChange={(e) => u({ webPort: +e.target.value })} /></Field>
        <Field label="Web Username:"><Input value={c.webUsername} onChange={(e) => u({ webUsername: e.target.value })} /></Field>
        <Field label="Web Password:"><Input type="password" value={c.webPassword} onChange={(e) => u({ webPassword: e.target.value })} /></Field>
        <Field label="Telnet Enabled:">
          <Select value={c.telnetEnabled ? "On" : "Off"} onChange={(e) => u({ telnetEnabled: e.target.value === "On" })}>
            <option>Off</option><option>On</option>
          </Select>
        </Field>
        <Field label="SSH Enabled:">
          <Select value={c.sshEnabled ? "On" : "Off"} onChange={(e) => u({ sshEnabled: e.target.value === "On" })}>
            <option>Off</option><option>On</option>
          </Select>
        </Field>
      </div>
    </div>
  );
}

function GpsSettingsTab({ c, u }: any) {
  return (
    <div className="space-y-6">
      <SectionTitle>GPS Parameters</SectionTitle>
      <div className="grid grid-cols-2 gap-x-6 gap-y-4">
        <Field label="Protocol Mode:">
          <Select value={c.protocolMode} onChange={(e) => u({ protocolMode: e.target.value })}>
            <option value="">Select…</option><option>NMEA</option><option>TAIP</option><option>Custom</option>
          </Select>
        </Field>
        <Field label="Output GPGSA:">
          <Select value={c.outputGPGSA} onChange={(e) => u({ outputGPGSA: e.target.value })}>
            <option value="">Select…</option><option>Output</option><option>Not Output</option>
          </Select>
        </Field>
        <Field label="GPS ID:"><Input value={c.gpsId} onChange={(e) => u({ gpsId: e.target.value })} maxLength={32} /></Field>
        <Field label="Output GPGSV:">
          <Select value={c.outputGPGSV} onChange={(e) => u({ outputGPGSV: e.target.value })}>
            <option>Not Output</option><option>Output</option>
          </Select>
        </Field>
        <Field label="GPS Interval:"><Input type="number" value={c.gpsInterval} onChange={(e) => u({ gpsInterval: +e.target.value })} /></Field>
        <Field label="Output GPGLL:">
          <Select value={c.outputGPGLL} onChange={(e) => u({ outputGPGLL: e.target.value })}>
            <option>Not Output</option><option>Output</option>
          </Select>
        </Field>
        <Field label="Output GPRMC:">
          <Select value={c.outputGPRMC} onChange={(e) => u({ outputGPRMC: e.target.value })}>
            <option>Not Output</option><option>Output</option>
          </Select>
        </Field>
        <Field label="GPS Center:"><Input value={c.gpsCenter} onChange={(e) => u({ gpsCenter: e.target.value })} /></Field>
        <Field label="Output GPVTG:">
          <Select value={c.outputGPVTG} onChange={(e) => u({ outputGPVTG: e.target.value })}>
            <option>Not Output</option><option>Output</option>
          </Select>
        </Field>
        <Field label="GPS Port:"><Input value={c.gpsPort} onChange={(e) => u({ gpsPort: e.target.value })} /></Field>
        <Field label="Output GPGGA:">
          <Select value={c.outputGPGGA} onChange={(e) => u({ outputGPGGA: e.target.value })}>
            <option>No Output</option><option>Output</option>
          </Select>
        </Field>
        <Field label="GPS Mode:">
          <Select value={c.gpsMode} onChange={(e) => u({ gpsMode: e.target.value })}>
            <option>TCP</option><option>UDP</option>
          </Select>
        </Field>
      </div>
    </div>
  );
}

function ModbusConfigurationTab({ c, u }: any) {
  function addRow() {
    u({
      devices: [
        ...c.devices,
        { deviceEnable: true, deviceAddress: 1, functionCode: 3, registerAddress: 0, dataType: "UINT16", decimalPlaces: 0, bindPort: "RS485", tagName: "", dataChange: "Off" },
      ],
    });
  }
  function setRow(i: number, patch: any) {
    const next = [...c.devices];
    next[i] = { ...next[i], ...patch };
    u({ devices: next });
  }
  function removeRow(i: number) {
    u({ devices: c.devices.filter((_: any, idx: number) => idx !== i) });
  }

  return (
    <div className="space-y-5">
      <SectionTitle>Modbus Configuration</SectionTitle>
      <div className="grid grid-cols-3 gap-x-6 gap-y-4">
        <Field label="Modbus Query Interval(s):"><Input type="number" value={c.modbusQueryInterval} onChange={(e) => u({ modbusQueryInterval: +e.target.value })} /></Field>
        <Field label="Query Timeout(ms):"><Input type="number" value={c.queryTimeout} onChange={(e) => u({ queryTimeout: +e.target.value })} /></Field>
        <Field label="Retry Count:"><Input type="number" value={c.retryCount} onChange={(e) => u({ retryCount: +e.target.value })} /></Field>
      </div>

      <div className="border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 flex items-center gap-2">
          <Button size="sm" variant="primary" onClick={addRow}>+ Add Register</Button>
          <span className="text-xs text-slate-500 ml-1">{c.devices.length} register(s)</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
              <tr>
                {["Enable","Addr","Func","Register","Type","Dec","Bind Port","Tag Name","Data Change",""].map((h) => (
                  <th key={h} className="px-2 py-2 text-left font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {c.devices.length === 0 ? (
                <tr><td colSpan={10} className="text-center py-12 text-slate-400">
                  <div className="flex flex-col items-center gap-2">
                    <div className="text-4xl">📭</div>
                    <div>No data — add a register to start polling</div>
                  </div>
                </td></tr>
              ) : c.devices.map((row: any, i: number) => (
                <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-2 py-1.5">
                    <input type="checkbox" checked={row.deviceEnable} onChange={(e) => setRow(i, { deviceEnable: e.target.checked })} className="h-4 w-4" />
                  </td>
                  <td className="px-2 py-1.5"><Input className="h-7 text-xs" type="number" value={row.deviceAddress} onChange={(e) => setRow(i, { deviceAddress: +e.target.value })} /></td>
                  <td className="px-2 py-1.5">
                    <Select className="h-7 text-xs" value={row.functionCode} onChange={(e) => setRow(i, { functionCode: +e.target.value })}>
                      {[1,2,3,4].map((v) => <option key={v} value={v}>{v}</option>)}
                    </Select>
                  </td>
                  <td className="px-2 py-1.5"><Input className="h-7 text-xs" type="number" value={row.registerAddress} onChange={(e) => setRow(i, { registerAddress: +e.target.value })} /></td>
                  <td className="px-2 py-1.5">
                    <Select className="h-7 text-xs" value={row.dataType} onChange={(e) => setRow(i, { dataType: e.target.value })}>
                      {["UINT16","INT16","UINT32","INT32","FLOAT32","BOOL"].map((v) => <option key={v}>{v}</option>)}
                    </Select>
                  </td>
                  <td className="px-2 py-1.5"><Input className="h-7 text-xs w-14" type="number" value={row.decimalPlaces} onChange={(e) => setRow(i, { decimalPlaces: +e.target.value })} /></td>
                  <td className="px-2 py-1.5">
                    <Select className="h-7 text-xs" value={row.bindPort} onChange={(e) => setRow(i, { bindPort: e.target.value })}>
                      {["RS232-1","RS232-2","RS485"].map((v) => <option key={v}>{v}</option>)}
                    </Select>
                  </td>
                  <td className="px-2 py-1.5"><Input className="h-7 text-xs" value={row.tagName} onChange={(e) => setRow(i, { tagName: e.target.value })} /></td>
                  <td className="px-2 py-1.5">
                    <Select className="h-7 text-xs" value={row.dataChange} onChange={(e) => setRow(i, { dataChange: e.target.value })}>
                      <option>Off</option><option>On</option>
                    </Select>
                  </td>
                  <td className="px-2 py-1.5">
                    <button onClick={() => removeRow(i)} className="text-red-500 hover:underline text-xs">Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
