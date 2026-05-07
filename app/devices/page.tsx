"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Plus, Repeat, Tag, Trash2, Download, Search, RefreshCw, ChevronDown, MoreHorizontal,
  Eye, Pencil, Bug, Globe, Settings as SettingsIcon, Upload, Zap, Terminal, Wifi, WifiOff,
} from "lucide-react";
import { PageShell } from "@/components/layout/PageShell";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { StatusBadge } from "@/components/devices/StatusBadge";
import { ConfigModal } from "@/components/config/ConfigModal";
import { formatDate, formatDuration, formatRelative, cn } from "@/lib/utils";
import { useWebSocket } from "@/lib/use-ws";

type Device = {
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
};

type Counts = { total: number; online: number; offline: number; unactivated: number };

const FILTERS: Array<{ key: "all" | "online" | "offline" | "unactivated"; label: string; color: string }> = [
  { key: "all",         label: "All",         color: "text-slate-700" },
  { key: "online",      label: "Online",      color: "text-emerald-600" },
  { key: "offline",     label: "Offline",     color: "text-slate-500" },
  { key: "unactivated", label: "Unactivated", color: "text-amber-600" },
];

export default function DevicesPage() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [counts, setCounts] = useState<Counts>({ total: 0, online: 0, offline: 0, unactivated: 0 });
  const [filter, setFilter] = useState<"all"|"online"|"offline"|"unactivated">("all");
  const [search, setSearch] = useState("");
  const [grouping, setGrouping] = useState("");
  const [loading, setLoading] = useState(true);
  const [configFor, setConfigFor] = useState<Device | null>(null);
  const { connected: wsConnected, liveDevices, send } = useWebSocket((ev) => {
    // Refresh on device events to keep counts/status in sync
    if (ev.type === "device_online" || ev.type === "device_offline" || ev.type === "device_heartbeat") {
      load();
    }
  });

  async function pushConfigNow(d: Device) {
    if (!liveDevices.has(d.device_code)) {
      alert("Device is not currently connected via TCP. Push will be queued for next connection.");
      return;
    }
    if (!confirm(`Push the saved config to ${d.device_name} right now?`)) return;
    const cfg = await fetch(`/api/devices/${d.device_code}/config`).then((r) => r.json());
    const ok = send({ type: "push_config", deviceCode: d.device_code, config: cfg.data });
    if (!ok) alert("WebSocket not connected.");
    else alert("Push sent. Watch the terminal for response bytes.");
  }

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/devices");
      const data = await res.json();
      setDevices(data.devices);
      setCounts(data.counts);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    return devices.filter((d) => {
      if (filter !== "all" && d.status !== filter) return false;
      if (grouping && d.device_grouping !== grouping) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!d.device_name.toLowerCase().includes(q) && !d.device_code.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [devices, filter, search, grouping]);

  const groupings = useMemo(() => Array.from(new Set(devices.map((d) => d.device_grouping).filter(Boolean))) as string[], [devices]);

  return (
    <PageShell>
      {/* Breadcrumb tabs */}
      <div className="border-b border-slate-200 bg-white px-6 flex items-center gap-1 text-sm">
        <BreadCrumbTab label="Dashboard" />
        <BreadCrumbTab label="Gateway Device Manager" active />
      </div>

      <div className="p-6 space-y-5">
        {/* Page Header */}
        <div className="bg-gradient-to-br from-blue-50 via-white to-blue-50/30 rounded-xl border border-slate-200/70 p-5 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-slate-900 flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-blue-500 animate-pulse" />
              Gateway Device Manager
            </h1>
            <p className="text-sm text-slate-600 mt-1 max-w-3xl leading-relaxed">
              Gateway device management not only covers device basic information management, but also can monitor the device status in real time, obtain the device networking, support configuration, upgrade, debugging, and log acquisition to ensure the stable and efficient operation of the device. Through centralized monitoring and management, real-time monitoring of device status, fault early warning, and remote control are achieved.
            </p>
          </div>
          <div className="hidden md:flex items-center gap-2">
            <div className={cn(
              "inline-flex items-center gap-1.5 px-2.5 h-8 rounded-md text-xs font-medium",
              wsConnected ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-slate-100 text-slate-500 border border-slate-200"
            )}>
              <span className={cn("h-1.5 w-1.5 rounded-full", wsConnected ? "bg-emerald-500 animate-pulse" : "bg-slate-400")} />
              {wsConnected ? "Live · WebSocket" : "WS disconnected"}
            </div>
            <div className="text-xs text-slate-500">
              <span className="font-semibold text-slate-700">{liveDevices.size}</span> live TCP
            </div>
            <Button variant="outline" size="sm" onClick={load}><RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />Refresh</Button>
          </div>
        </div>

        {/* Filter row */}
        <div className="bg-white rounded-xl border border-slate-200/70 shadow-soft">
          <div className="flex items-center px-4 h-12 border-b border-slate-100 gap-1">
            {FILTERS.map((f) => {
              const count = f.key === "all" ? counts.total : counts[f.key];
              const active = filter === f.key;
              return (
                <button
                  key={f.key}
                  onClick={() => setFilter(f.key)}
                  className={cn(
                    "px-3 py-1.5 rounded-md text-sm transition-colors flex items-center gap-1.5",
                    active ? "bg-blue-50 text-blue-700 font-medium" : "text-slate-600 hover:bg-slate-50"
                  )}
                >
                  <span className={cn(active ? "" : f.color)}>{f.label}</span>
                  <span className={cn("text-xs px-1.5 py-0.5 rounded", active ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-500")}>{count}</span>
                </button>
              );
            })}
            <div className="ml-auto flex items-center gap-2">
              <Select className="h-9 w-44" value={grouping} onChange={(e) => setGrouping(e.target.value)}>
                <option value="">Device Grouping</option>
                {groupings.map((g) => <option key={g}>{g}</option>)}
              </Select>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                <Input className="pl-8 w-56" placeholder="Device Code or Device Name" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <Input className="w-32" placeholder="Tags" />
              <Button variant="primary" size="md">Search</Button>
              <Button variant="outline" size="md" onClick={() => { setFilter("all"); setSearch(""); setGrouping(""); }}>Reset</Button>
            </div>
          </div>

          {/* Action toolbar */}
          <div className="px-4 h-12 flex items-center gap-2 border-b border-slate-100">
            <Button size="sm" variant="primary" onClick={async () => {
              const code = prompt("Device Code (e.g. 11990044):");
              if (!code) return;
              const name = prompt("Device Name:") ?? code;
              await fetch("/api/devices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ device_code: code, device_name: name }) });
              load();
            }}><Plus className="h-3.5 w-3.5" />Add</Button>
            <Button size="sm" variant="outline"><Repeat className="h-3.5 w-3.5" />Device Handover</Button>
            <Button size="sm" variant="outline"><Tag className="h-3.5 w-3.5" />Add New Tags</Button>
            <Button size="sm" variant="outline"><Trash2 className="h-3.5 w-3.5" />Delete Label</Button>
            <Button size="sm" variant="outline"><Trash2 className="h-3.5 w-3.5" />Batch Delete</Button>
            <Button size="sm" variant="outline"><Download className="h-3.5 w-3.5" />Export</Button>
            <div className="ml-auto text-xs text-slate-500">{filtered.length} of {devices.length} devices</div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50/80 text-slate-500 text-xs uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-3 text-left font-medium w-10"><input type="checkbox" className="h-4 w-4" /></th>
                  <th className="px-3 py-3 text-left font-medium">Index</th>
                  <th className="px-3 py-3 text-left font-medium">Status</th>
                  <th className="px-3 py-3 text-left font-medium">Device Name</th>
                  <th className="px-3 py-3 text-left font-medium">Device Code</th>
                  <th className="px-3 py-3 text-left font-medium">Grouping</th>
                  <th className="px-3 py-3 text-left font-medium">Series</th>
                  <th className="px-3 py-3 text-left font-medium">Type</th>
                  <th className="px-3 py-3 text-left font-medium">Model</th>
                  <th className="px-3 py-3 text-left font-medium">Software Version</th>
                  <th className="px-3 py-3 text-left font-medium">Activate Time</th>
                  <th className="px-3 py-3 text-left font-medium">Cellular Ver.</th>
                  <th className="px-3 py-3 text-left font-medium">Last Heartbeat</th>
                  <th className="px-3 py-3 text-left font-medium">Online Duration</th>
                  <th className="px-3 py-3 text-right font-medium pr-6">Operate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr><td colSpan={15} className="text-center py-16 text-slate-400">Loading…</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={15} className="text-center py-16 text-slate-400">No devices found. Click "Add" to register one.</td></tr>
                ) : filtered.map((d, i) => {
                  const isLive = liveDevices.has(d.device_code);
                  return (
                  <tr key={d.device_code} className="hover:bg-blue-50/30 transition-colors">
                    <td className="px-4 py-3"><input type="checkbox" className="h-4 w-4" /></td>
                    <td className="px-3 py-3 text-slate-500">{i + 1}</td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-1.5">
                        <StatusBadge status={d.status} />
                        {isLive && (
                          <span title="Connected via TCP right now" className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded">
                            <Zap className="h-2.5 w-2.5" /> Live
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-3 font-medium text-slate-900">{d.device_name}</td>
                    <td className="px-3 py-3 font-mono text-xs text-slate-700">{d.device_code}</td>
                    <td className="px-3 py-3 text-slate-600">{d.device_grouping ?? "-"}</td>
                    <td className="px-3 py-3 text-slate-600">{d.product_series ?? "-"}</td>
                    <td className="px-3 py-3"><span className="text-xs px-2 py-0.5 rounded border border-amber-200 bg-amber-50 text-amber-700">{d.product_type ?? "-"}</span></td>
                    <td className="px-3 py-3 text-slate-600">{d.product_model ?? "-"}</td>
                    <td className="px-3 py-3 text-slate-600 text-xs font-mono">{d.software_version ?? "-"}</td>
                    <td className="px-3 py-3 text-slate-600 text-xs">{formatDate(d.activate_time)}</td>
                    <td className="px-3 py-3 text-slate-600 text-xs">{d.cellular_module_version ?? "-"}</td>
                    <td className="px-3 py-3 text-slate-600 text-xs">{formatDate(d.last_heartbeat)}</td>
                    <td className="px-3 py-3 text-slate-600 text-xs">{formatDuration(d.online_duration)}</td>
                    <td className="px-3 py-3 text-right pr-6">
                      <div className="inline-flex items-center gap-1 text-xs">
                        <ActionLink icon={Eye} label="View" />
                        <ActionLink icon={Pencil} label="Edit" />
                        <RowMenu device={d} live={isLive} onConfig={() => setConfigFor(d)} onPush={() => pushConfigNow(d)} onRefresh={load} />
                      </div>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {configFor && (
        <ConfigModal
          open={!!configFor}
          onClose={() => setConfigFor(null)}
          deviceCode={configFor.device_code}
          deviceName={configFor.device_name}
        />
      )}
    </PageShell>
  );
}

function ActionLink({ icon: Icon, label, onClick }: { icon: any; label: string; onClick?: () => void }) {
  return (
    <button onClick={onClick} className="inline-flex items-center gap-1 px-2 py-1 rounded text-blue-600 hover:bg-blue-50">
      <Icon className="h-3 w-3" />{label}
    </button>
  );
}

function BreadCrumbTab({ label, active = false }: { label: string; active?: boolean }) {
  return (
    <div className={cn(
      "h-10 flex items-center px-3 text-sm border-b-2 -mb-px",
      active ? "border-blue-500 text-blue-600 font-medium" : "border-transparent text-slate-500 hover:text-slate-700"
    )}>
      {label}
    </div>
  );
}

function RowMenu({ device, live, onConfig, onPush, onRefresh }: { device: Device; live: boolean; onConfig: () => void; onPush: () => void; onRefresh: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)} className="inline-flex items-center gap-1 px-2 py-1 rounded text-blue-600 hover:bg-blue-50">
        <MoreHorizontal className="h-3 w-3" />More <ChevronDown className="h-3 w-3" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-1 w-52 bg-white rounded-md shadow-lg border border-slate-200 z-20 py-1 text-sm">
            <MenuItem icon={SettingsIcon} label="Config" onClick={() => { setOpen(false); onConfig(); }} />
            <MenuItem
              icon={Zap}
              label={live ? "Push Config Now" : "Push (device offline)"}
              disabled={!live}
              onClick={() => { setOpen(false); onPush(); }}
            />
            <Link href={`/devices/${device.device_code}/terminal`} onClick={() => setOpen(false)} className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-slate-50 text-slate-700">
              <Terminal className="h-3.5 w-3.5" /> Live Terminal
            </Link>
            <div className="my-1 h-px bg-slate-100" />
            <MenuItem icon={Bug} label="Debug" onClick={() => setOpen(false)} />
            <MenuItem icon={Globe} label="Intranet Pen…" onClick={() => setOpen(false)} />
            <MenuItem icon={Upload} label="Upgrade" onClick={() => setOpen(false)} />
            <div className="my-1 h-px bg-slate-100" />
            <MenuItem icon={Trash2} label="Delete" danger onClick={async () => {
              setOpen(false);
              if (!confirm(`Delete device ${device.device_code}?`)) return;
              await fetch(`/api/devices?code=${device.device_code}`, { method: "DELETE" });
              onRefresh();
            }} />
          </div>
        </>
      )}
    </div>
  );
}

function MenuItem({ icon: Icon, label, onClick, danger, disabled }: { icon: any; label: string; onClick: () => void; danger?: boolean; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "w-full flex items-center gap-2 px-3 py-1.5 text-left",
        disabled ? "text-slate-300 cursor-not-allowed" : danger ? "text-red-600 hover:bg-red-50" : "text-slate-700 hover:bg-slate-50"
      )}
    >
      <Icon className="h-3.5 w-3.5" />{label}
    </button>
  );
}
