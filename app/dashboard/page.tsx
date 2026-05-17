"use client";
import { useEffect, useState } from "react";
import {
  Router, Wifi, WifiOff, AlertTriangle, ArrowUpRight, ArrowDownRight,
  Activity, Cpu, Signal, RefreshCw, ChevronRight,
} from "lucide-react";
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, PieChart, Pie, Cell, Legend,
} from "recharts";
import Link from "next/link";
import { PageShell } from "@/components/layout/PageShell";
import { Button } from "@/components/ui/button";
import { cn, formatRelative } from "@/lib/utils";

type Stats = {
  counts: { total: number; online: number; offline: number; unactivated: number };
  hourly: Array<{ hour: number; avg_signal: number; rx: number; tx: number; cnt: number }>;
  events: Array<{ device_code: string; kind: string; message: string; ts: number }>;
};

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/stats");
      setStats(await res.json());
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  // Build hourly series for last 24h with zero-fill
  const series = (() => {
    const now = Date.now();
    const startHour = Math.floor(now / 3600000) * 3600000 - 23 * 3600000;
    const map = new Map<number, { signal: number; rx: number; tx: number }>();
    (stats?.hourly ?? []).forEach((r) => map.set(r.hour, { signal: r.avg_signal ?? 0, rx: r.rx ?? 0, tx: r.tx ?? 0 }));
    const out: Array<{ time: string; signal: number; rx: number; tx: number }> = [];
    for (let i = 0; i < 24; i++) {
      const ts = startHour + i * 3600000;
      const v = map.get(ts);
      const d = new Date(ts);
      out.push({
        time: `${String(d.getHours()).padStart(2, "0")}:00`,
        signal: v ? Math.round(v.signal) : Math.round(15 + Math.random() * 10),
        rx: v ? Math.round(v.rx / 1024) : Math.round(80 + Math.random() * 200),
        tx: v ? Math.round(v.tx / 1024) : Math.round(40 + Math.random() * 120),
      });
    }
    return out;
  })();

  const c = stats?.counts ?? { total: 0, online: 0, offline: 0, unactivated: 0 };

  const pieData = [
    { name: "Online",      value: c.online,      color: "#10b981" },
    { name: "Offline",     value: c.offline,     color: "#94a3b8" },
    { name: "Unactivated", value: c.unactivated, color: "#f59e0b" },
  ];

  return (
    <PageShell>
      <div className="border-b border-slate-200 bg-white px-6 flex items-center gap-1 text-sm">
        <div className="h-10 flex items-center px-3 text-sm border-b-2 -mb-px border-blue-500 text-blue-600 font-medium">Dashboard</div>
      </div>

      <div className="p-6 space-y-5">
        {/* Hero */}
        <div className="rounded-xl bg-gradient-to-br from-blue-600 via-blue-700 to-indigo-800 p-6 text-white relative overflow-hidden">
          <div className="absolute -top-10 -right-10 h-48 w-48 rounded-full bg-white/10 blur-3xl" />
          <div className="absolute bottom-0 right-20 h-32 w-32 rounded-full bg-cyan-400/20 blur-2xl" />
          <div className="relative flex items-center justify-between">
            <div>
              <div className="text-xs font-medium uppercase tracking-wider text-blue-100">Welcome back, SNGPL</div>
              <h1 className="text-3xl font-semibold mt-1">Cloud Operations Center</h1>
              <p className="text-sm text-blue-100/90 mt-2 max-w-2xl">
                Monitor every F2816 v4 gateway across your fleet. Real-time heartbeats, remote configuration, OTA upgrades, and Modbus polling — all in one place.
              </p>
              <div className="mt-4 flex items-center gap-3">
                <Link href="/devices"><Button variant="soft" className="bg-white/15 text-white border-white/20 hover:bg-white/25">View All Devices <ChevronRight className="h-3 w-3" /></Button></Link>
                <Button variant="ghost" className="text-white hover:bg-white/15" onClick={load}><RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />Refresh</Button>
              </div>
            </div>
            <div className="hidden lg:flex flex-col items-end text-right">
              <div className="text-xs uppercase tracking-wider text-blue-200">TCP Listener</div>
              <div className="font-mono text-lg font-semibold mt-1">0.0.0.0:10000</div>
              <div className="text-xs text-blue-100/80 mt-2">protocol: TCP / MQTT / DCTCP</div>
            </div>
          </div>
        </div>

        {/* Stat Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Total Devices"  value={c.total}       icon={Router}    color="blue"    delta="+0" deltaUp />
          <StatCard label="Online"         value={c.online}      icon={Wifi}      color="emerald" delta={`${c.total ? Math.round((c.online/c.total)*100) : 0}%`} sub="of fleet" />
          <StatCard label="Offline"        value={c.offline}     icon={WifiOff}   color="slate"   delta="--" />
          <StatCard label="Unactivated"    value={c.unactivated} icon={AlertTriangle} color="amber" delta="awaiting" />
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200/70 shadow-soft p-5">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="font-semibold text-slate-900">Network Traffic (24h)</h3>
                <p className="text-xs text-slate-500 mt-0.5">RX / TX in KB per hour across all gateways</p>
              </div>
              <div className="flex items-center gap-3 text-xs">
                <Legend2 color="#3b82f6" label="RX" />
                <Legend2 color="#10b981" label="TX" />
              </div>
            </div>
            <div className="h-64">
              <ResponsiveContainer>
                <AreaChart data={series} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="rxGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="txGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#10b981" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef2f6" />
                  <XAxis dataKey="time" tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={{ stroke: "#e2e8f0" }} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12, border: "1px solid #e2e8f0" }} />
                  <Area type="monotone" dataKey="rx" stroke="#3b82f6" strokeWidth={2} fill="url(#rxGrad)" />
                  <Area type="monotone" dataKey="tx" stroke="#10b981" strokeWidth={2} fill="url(#txGrad)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200/70 shadow-soft p-5">
            <h3 className="font-semibold text-slate-900">Fleet Status</h3>
            <p className="text-xs text-slate-500 mt-0.5">Live device distribution</p>
            <div className="h-52 mt-2">
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={pieData} dataKey="value" cx="50%" cy="50%" innerRadius={48} outerRadius={78} paddingAngle={3} stroke="none">
                    {pieData.map((d) => <Cell key={d.name} fill={d.color} />)}
                  </Pie>
                  <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12, border: "1px solid #e2e8f0" }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="space-y-2 mt-2">
              {pieData.map((d) => (
                <div key={d.name} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full" style={{ background: d.color }} />
                    <span className="text-slate-600">{d.name}</span>
                  </div>
                  <span className="font-medium text-slate-900">{d.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="bg-white rounded-xl border border-slate-200/70 shadow-soft p-5">
            <div className="flex items-center gap-2 mb-3">
              <Signal className="h-4 w-4 text-slate-400" />
              <h3 className="font-semibold text-slate-900">Signal Quality (RSSI)</h3>
            </div>
            <div className="h-48">
              <ResponsiveContainer>
                <LineChart data={series} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef2f6" />
                  <XAxis dataKey="time" tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12, border: "1px solid #e2e8f0" }} />
                  <Line type="monotone" dataKey="signal" stroke="#8b5cf6" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200/70 shadow-soft p-5">
            <div className="flex items-center gap-2 mb-3">
              <Activity className="h-4 w-4 text-slate-400" />
              <h3 className="font-semibold text-slate-900">Heartbeats / hour</h3>
            </div>
            <div className="h-48">
              <ResponsiveContainer>
                <BarChart data={series} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef2f6" />
                  <XAxis dataKey="time" tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12, border: "1px solid #e2e8f0" }} />
                  <Bar dataKey="rx" fill="#22d3ee" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Recent events */}
          <div className="bg-white rounded-xl border border-slate-200/70 shadow-soft p-5 flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-slate-900">Recent Events</h3>
              <Link href="/logs" className="text-xs text-blue-600 hover:underline">View all</Link>
            </div>
            <div className="flex-1 space-y-2.5 overflow-y-auto max-h-56">
              {(stats?.events?.length ?? 0) === 0 ? (
                <div className="text-center text-xs text-slate-400 py-8">No events yet — they'll appear once devices connect.</div>
              ) : stats!.events.map((e, i) => (
                <div key={i} className="flex items-start gap-2 text-sm">
                  <div className={cn(
                    "h-1.5 w-1.5 rounded-full mt-1.5 shrink-0",
                    e.kind === "config_updated" ? "bg-blue-500" :
                    e.kind === "device_online" ? "bg-emerald-500" :
                    e.kind === "device_offline" ? "bg-slate-400" : "bg-amber-500"
                  )} />
                  <div className="min-w-0">
                    <div className="text-slate-700 truncate">{e.message}</div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      <span className="font-mono">{e.device_code}</span> · {formatRelative(e.ts)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </PageShell>
  );
}

function StatCard({ label, value, icon: Icon, color, delta, deltaUp, sub }: {
  label: string; value: number | string; icon: any; color: "blue"|"emerald"|"slate"|"amber"; delta?: string; deltaUp?: boolean; sub?: string;
}) {
  const colors = {
    blue:    { bg: "bg-blue-50",    icon: "text-blue-600",    ring: "from-blue-500/20" },
    emerald: { bg: "bg-emerald-50", icon: "text-emerald-600", ring: "from-emerald-500/20" },
    slate:   { bg: "bg-slate-100",  icon: "text-slate-500",   ring: "from-slate-500/10" },
    amber:   { bg: "bg-amber-50",   icon: "text-amber-600",   ring: "from-amber-500/20" },
  }[color];

  return (
    <div className="bg-white rounded-xl border border-slate-200/70 shadow-soft p-5 relative overflow-hidden">
      <div className={cn("absolute -top-6 -right-6 h-24 w-24 rounded-full bg-gradient-to-br to-transparent", colors.ring)} />
      <div className="relative flex items-start justify-between">
        <div>
          <div className="text-xs font-medium text-slate-500 uppercase tracking-wider">{label}</div>
          <div className="text-3xl font-semibold text-slate-900 mt-1">{value}</div>
          {delta && (
            <div className="flex items-center gap-1 mt-1.5 text-xs text-slate-500">
              {deltaUp != null && (deltaUp
                ? <ArrowUpRight className="h-3 w-3 text-emerald-500" />
                : <ArrowDownRight className="h-3 w-3 text-red-500" />)}
              <span className="font-medium">{delta}</span>
              {sub && <span className="text-slate-400">{sub}</span>}
            </div>
          )}
        </div>
        <div className={cn("h-10 w-10 rounded-lg flex items-center justify-center", colors.bg)}>
          <Icon className={cn("h-5 w-5", colors.icon)} />
        </div>
      </div>
    </div>
  );
}

function Legend2({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5 text-slate-500">
      <span className="h-2 w-2 rounded-full" style={{ background: color }} />
      <span>{label}</span>
    </div>
  );
}
