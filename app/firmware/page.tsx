"use client";
import { useEffect, useState } from "react";
import { Cpu, FileCode, Shield, Cable, RefreshCw, Trash2, ArrowDown, Wifi, Radio, HardDrive, GitBranch } from "lucide-react";
import { PageShell } from "@/components/layout/PageShell";
import { Button } from "@/components/ui/button";
import { cn, formatRelative } from "@/lib/utils";

type FirmwareInfo = {
  info: {
    fileName: string;
    size: number;
    deviceType: string;
    application: string;
    buildDate: string;
    bootloader: string;
    hardware: string;
    cellularStack: string;
  };
  modes: Array<{ code: string; name: string; defaultPort: number | null; file: string }>;
  onDisk: { exists: boolean; size?: number; sha256?: string; modified?: number };
  findings: Record<string, any>;
};

type Capture = { id: number; remote_addr: string; direction: string; bytes_hex: string; parsed_kind: string; ts: number };

export default function FirmwarePage() {
  const [fw, setFw] = useState<FirmwareInfo | null>(null);
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const [fwRes, capRes] = await Promise.all([
        fetch("/api/firmware").then((r) => r.json()),
        fetch("/api/captures?limit=100").then((r) => r.json()),
      ]);
      setFw(fwRes);
      setCaptures(capRes.captures);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function clearCaptures() {
    if (!confirm("Clear all captured packets?")) return;
    await fetch("/api/captures", { method: "DELETE" });
    load();
  }

  return (
    <PageShell>
      <div className="border-b border-slate-200 bg-white px-6 flex items-center gap-1 text-sm">
        <div className="h-10 flex items-center px-3 text-sm border-b-2 -mb-px border-blue-500 text-blue-600 font-medium">Firmware Insights</div>
      </div>

      <div className="p-6 space-y-5">
        {/* Hero */}
        <div className="rounded-xl bg-gradient-to-br from-indigo-600 via-purple-700 to-fuchsia-700 p-6 text-white relative overflow-hidden">
          <div className="absolute -top-10 -right-10 h-48 w-48 rounded-full bg-white/10 blur-3xl" />
          <div className="relative">
            <div className="text-xs font-medium uppercase tracking-wider text-purple-100">Reverse-Engineering Report</div>
            <h1 className="text-2xl font-semibold mt-1">F2X16V4 Firmware Analysis</h1>
            <p className="text-sm text-purple-100/90 mt-2 max-w-2xl">
              Static analysis of the F2X16V4 firmware binary reveals the protocol details, supported modes, and OTA mechanism — used to inform our cloud platform's parser and safety guards.
            </p>
            {fw?.onDisk?.exists ? (
              <div className="mt-4 flex flex-wrap items-center gap-3 text-xs">
                <Pill label="Size" value={`${(fw.onDisk.size! / 1024).toFixed(1)} KB`} />
                <Pill label="SHA256" value={fw.onDisk.sha256!.slice(0, 16) + "…"} mono />
                <Pill label="Modified" value={formatRelative(fw.onDisk.modified)} />
              </div>
            ) : (
              <div className="mt-4 text-xs text-purple-100/80">Firmware file not found on disk.</div>
            )}
          </div>
        </div>

        {loading ? (
          <div className="text-center py-12 text-slate-400">Loading firmware analysis…</div>
        ) : fw && (
          <>
            {/* Identity */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <Card title="Device Identity" icon={Cpu} accent="indigo">
                <KV k="Device Type"   v={fw.info.deviceType} />
                <KV k="Application"   v={fw.info.application} mono />
                <KV k="Build Date"    v={fw.info.buildDate} />
                <KV k="Hardware"      v={fw.info.hardware} />
                <KV k="Cellular Stack" v={fw.info.cellularStack} />
              </Card>

              <Card title="Bootloader" icon={HardDrive} accent="purple">
                <p className="text-xs text-slate-600 leading-relaxed font-mono">{fw.info.bootloader}</p>
                <div className="mt-3 text-xs text-slate-500">
                  Bootloader is from 2015 — supports recovery if main firmware fails.
                </div>
              </Card>

              <Card title="Wire Protocol" icon={Cable} accent="fuchsia">
                <div className="space-y-2 text-xs">
                  <div className="font-mono p-2 bg-slate-50 border border-slate-200 rounded">
                    [length:2 BE] [opcode:1] [payload:N] [crc16:2]
                  </div>
                  <div className="text-slate-600">
                    CRC: <span className="font-mono">CRC-16/Modbus</span> (poly 0xA001, init 0xFFFF)
                  </div>
                  <div className="text-slate-600">
                    MQTT topic: <span className="font-mono text-blue-600">sngpl/telemetry/&lt;deviceCode&gt;/data</span>
                  </div>
                </div>
              </Card>
            </div>

            {/* Supported modes */}
            <div className="bg-white rounded-xl border border-slate-200/70 shadow-soft p-5">
              <div className="flex items-center gap-2 mb-3">
                <GitBranch className="h-4 w-4 text-slate-400" />
                <h3 className="font-semibold text-slate-900">Supported Protocol Modes</h3>
                <span className="text-xs text-slate-500">{fw.modes.length} modes</span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                {fw.modes.map((m) => (
                  <div key={m.code} className="border border-slate-200 rounded-lg p-3 hover:bg-slate-50 transition-colors">
                    <div className="font-mono text-sm font-semibold text-blue-700">{m.code}</div>
                    <div className="text-xs text-slate-700 mt-0.5">{m.name}</div>
                    <div className="text-[10px] text-slate-400 font-mono mt-1">
                      {m.defaultPort ? `port ${m.defaultPort}` : "—"} · {m.file}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* OTA */}
            <div className="bg-white rounded-xl border border-slate-200/70 shadow-soft p-5">
              <div className="flex items-center gap-2 mb-3">
                <ArrowDown className="h-4 w-4 text-slate-400" />
                <h3 className="font-semibold text-slate-900">Firmware Upgrade (OTA)</h3>
              </div>
              <div className="text-sm text-slate-600 mb-3">
                Three OTA mechanisms found in firmware. <strong>Firmware push is the highest-risk operation</strong> — disabled in this cloud platform until protocol is fully captured.
              </div>
              <div className="space-y-2">
                {(fw.findings.otaCommands as string[]).map((cmd) => (
                  <div key={cmd} className="font-mono text-xs bg-slate-50 border border-slate-200 rounded px-3 py-1.5">{cmd}</div>
                ))}
              </div>
            </div>

            {/* Captures table */}
            <div className="bg-white rounded-xl border border-slate-200/70 shadow-soft">
              <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
                <div>
                  <div className="flex items-center gap-2">
                    <Radio className="h-4 w-4 text-slate-400" />
                    <h3 className="font-semibold text-slate-900">Live TCP Capture</h3>
                    <span className="text-xs text-slate-500">{captures.length} packets</span>
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    Every byte received on port 10000 is logged here so we can reverse-engineer real device traffic. Connect a real F2X16V4 to capture live packets.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={load}>
                    <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} /> Refresh
                  </Button>
                  <Button size="sm" variant="outline" onClick={clearCaptures}>
                    <Trash2 className="h-3 w-3" /> Clear
                  </Button>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50/80 text-slate-500 uppercase tracking-wider">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium w-32">Timestamp</th>
                      <th className="px-4 py-2 text-left font-medium w-32">Remote</th>
                      <th className="px-4 py-2 text-left font-medium w-24">Kind</th>
                      <th className="px-4 py-2 text-left font-medium">Bytes (hex)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {captures.length === 0 ? (
                      <tr><td colSpan={4} className="text-center py-12 text-slate-400">
                        No packets captured yet. Point a device at this server's IP on port 10000 and packets will appear here.
                      </td></tr>
                    ) : captures.map((c) => (
                      <tr key={c.id} className="hover:bg-slate-50">
                        <td className="px-4 py-2 text-slate-600 font-mono">{new Date(c.ts).toLocaleTimeString()}</td>
                        <td className="px-4 py-2 text-slate-600 font-mono">{c.remote_addr}</td>
                        <td className="px-4 py-2">
                          <KindBadge kind={c.parsed_kind} />
                        </td>
                        <td className="px-4 py-2 font-mono text-slate-700 break-all">
                          {c.bytes_hex.slice(0, 96).match(/.{1,2}/g)?.join(" ") ?? ""}
                          {c.bytes_hex.length > 96 && <span className="text-slate-400"> … ({c.bytes_hex.length / 2} bytes total)</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Next-step note */}
            <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4 flex items-start gap-3">
              <Shield className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
              <div className="text-sm text-amber-900">
                <div className="font-semibold">Next step: capture one real packet</div>
                <p className="mt-1 text-amber-800/90 leading-relaxed">
                  Point one F2X16V4 device's <strong>Device Manager → Server IP</strong> at this machine for ~5 minutes. The TCP listener will record every byte the device sends. With one real frame, we can map the opcode table and write a 100% accurate parser, no more guessing. The listener is in <strong>passive mode</strong> — it only ACKs and never sends config back, so the device can't be misconfigured by accident.
                </p>
              </div>
            </div>
          </>
        )}
      </div>
    </PageShell>
  );
}

function Card({ title, icon: Icon, accent, children }: { title: string; icon: any; accent: "indigo"|"purple"|"fuchsia"; children: React.ReactNode }) {
  const colors = {
    indigo:  "bg-indigo-50 text-indigo-600",
    purple:  "bg-purple-50 text-purple-600",
    fuchsia: "bg-fuchsia-50 text-fuchsia-600",
  }[accent];
  return (
    <div className="bg-white rounded-xl border border-slate-200/70 shadow-soft p-5">
      <div className="flex items-center gap-2 mb-4">
        <div className={cn("h-8 w-8 rounded-lg flex items-center justify-center", colors)}>
          <Icon className="h-4 w-4" />
        </div>
        <h3 className="font-semibold text-slate-900">{title}</h3>
      </div>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function KV({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-xs">
      <span className="text-slate-500 shrink-0">{k}</span>
      <span className={cn("text-slate-800 text-right", mono && "font-mono")}>{v}</span>
    </div>
  );
}

function Pill({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-md bg-white/15 border border-white/20 px-2.5 py-1">
      <span className="text-purple-200 mr-1.5">{label}:</span>
      <span className={cn("font-medium", mono && "font-mono")}>{value}</span>
    </div>
  );
}

function KindBadge({ kind }: { kind: string }) {
  const map: Record<string, { bg: string; text: string; label: string }> = {
    ascii_reg:  { bg: "bg-emerald-50", text: "text-emerald-700", label: "ASCII REG" },
    ascii_hb:   { bg: "bg-emerald-50", text: "text-emerald-700", label: "ASCII HB" },
    dtu_frame:  { bg: "bg-blue-50",    text: "text-blue-700",    label: "DTU Frame" },
    unknown:    { bg: "bg-amber-50",   text: "text-amber-700",   label: "Unknown" },
  };
  const m = map[kind] ?? map.unknown;
  return <span className={cn("px-2 py-0.5 rounded text-[10px] font-medium", m.bg, m.text)}>{m.label}</span>;
}
