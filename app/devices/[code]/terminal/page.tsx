"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Terminal, ArrowLeft, Trash2, Pause, Play, Wifi, WifiOff, Zap, Download } from "lucide-react";
import { PageShell } from "@/components/layout/PageShell";
import { Button } from "@/components/ui/button";
import { useWebSocket } from "@/lib/use-ws";
import { cn } from "@/lib/utils";

type Line = {
  ts: number;
  direction: "in" | "out" | "evt";
  remote?: string;
  kind?: string;
  hex?: string;
  ascii?: string;
  message?: string;
};

export default function DeviceTerminalPage({ params }: { params: { code: string } }) {
  const code = params.code;
  const [lines, setLines] = useState<Line[]>([]);
  const [paused, setPaused] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  const { connected, liveDevices } = useWebSocket((ev) => {
    if (paused) return;
    if (ev.type === "tcp_data" && ev.deviceCode === code) {
      addLine({
        ts: ev.ts, direction: "in", remote: ev.remote, kind: ev.kind, hex: ev.hex,
        ascii: hexToAscii(ev.hex),
      });
    } else if (ev.type === "device_online" && ev.deviceCode === code) {
      addLine({ ts: ev.ts, direction: "evt", message: `Device connected from ${ev.remote}` });
    } else if (ev.type === "device_offline" && ev.deviceCode === code) {
      addLine({ ts: ev.ts, direction: "evt", message: `Device disconnected` });
    } else if (ev.type === "device_heartbeat" && ev.deviceCode === code) {
      addLine({ ts: ev.ts, direction: "evt", message: `❤️ heartbeat received` });
    } else if (ev.type === "config_pushed" && ev.deviceCode === code) {
      addLine({ ts: ev.ts, direction: "out", message: `▶ config pushed via WebSocket` });
    }
  });

  function addLine(l: Line) {
    setLines((prev) => {
      const next = [...prev, l];
      return next.length > 1000 ? next.slice(-1000) : next;
    });
  }

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines, autoScroll]);

  // Load recent captures for this device on mount
  useEffect(() => {
    fetch(`/api/captures?limit=200`).then((r) => r.json()).then((d) => {
      const recent = d.captures
        .filter((c: any) => c.remote_addr) // any captures from this device's address
        .reverse()
        .map((c: any) => ({
          ts: c.ts,
          direction: (c.direction === "out" ? "out" : "in") as "in" | "out",
          remote: c.remote_addr,
          kind: c.parsed_kind,
          hex: c.bytes_hex,
          ascii: hexToAscii(c.bytes_hex),
        }));
      setLines(recent);
    });
  }, [code]);

  const isLive = liveDevices.has(code);

  function exportLog() {
    const text = lines.map((l) =>
      `${new Date(l.ts).toISOString()} ${l.direction.padEnd(3)} ${l.kind ?? ""} ${l.hex ?? l.message ?? ""}`
    ).join("\n");
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `terminal-${code}-${Date.now()}.log`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <PageShell>
      <div className="border-b border-slate-200 bg-white px-6 flex items-center gap-1 text-sm">
        <Link href="/devices" className="h-10 flex items-center px-3 text-sm text-slate-500 hover:text-slate-700">
          <ArrowLeft className="h-3.5 w-3.5 mr-1" /> Back
        </Link>
        <div className="h-10 flex items-center px-3 text-sm border-b-2 -mb-px border-blue-500 text-blue-600 font-medium">
          Terminal · {code}
        </div>
      </div>

      <div className="p-6">
        {/* Status bar */}
        <div className="bg-white rounded-t-xl border border-slate-200/70 shadow-soft px-5 py-3 flex items-center gap-4 border-b-0">
          <div className="flex items-center gap-2">
            <Terminal className="h-4 w-4 text-slate-400" />
            <h2 className="font-semibold text-slate-900">Live Terminal</h2>
          </div>
          <div className={cn(
            "inline-flex items-center gap-1.5 px-2.5 h-7 rounded-md text-xs font-medium",
            connected ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-slate-100 text-slate-500 border border-slate-200"
          )}>
            <span className={cn("h-1.5 w-1.5 rounded-full", connected ? "bg-emerald-500 animate-pulse" : "bg-slate-400")} />
            WS {connected ? "connected" : "disconnected"}
          </div>
          <div className={cn(
            "inline-flex items-center gap-1.5 px-2.5 h-7 rounded-md text-xs font-medium",
            isLive ? "bg-blue-50 text-blue-700 border border-blue-200" : "bg-slate-100 text-slate-500 border border-slate-200"
          )}>
            {isLive ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
            Device TCP {isLive ? "live" : "offline"}
          </div>
          <div className="text-xs text-slate-500 ml-auto">{lines.length} lines</div>
          <Button size="sm" variant="outline" onClick={() => setPaused(!paused)}>
            {paused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
            {paused ? "Resume" : "Pause"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setLines([])}>
            <Trash2 className="h-3 w-3" /> Clear
          </Button>
          <Button size="sm" variant="outline" onClick={exportLog}>
            <Download className="h-3 w-3" /> Export
          </Button>
        </div>

        {/* Console */}
        <div
          ref={scrollRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
            setAutoScroll(atBottom);
          }}
          className="bg-slate-950 rounded-b-xl border border-slate-200/70 shadow-soft text-xs font-mono p-4 h-[60vh] overflow-y-auto"
        >
          {lines.length === 0 ? (
            <div className="text-slate-500 text-center py-12">
              No traffic yet. {isLive ? "Device is live — packets will appear here." : "Waiting for device to connect."}
            </div>
          ) : lines.map((l, i) => (
            <div key={i} className="flex items-start gap-2 leading-5 hover:bg-slate-900/60 -mx-2 px-2 rounded">
              <span className="text-slate-500 shrink-0">{new Date(l.ts).toLocaleTimeString("en-US", { hour12: false })}</span>
              <span className={cn(
                "shrink-0 w-8 font-bold",
                l.direction === "in"  ? "text-emerald-400" :
                l.direction === "out" ? "text-blue-400"    : "text-amber-400"
              )}>
                {l.direction === "in" ? "← IN" : l.direction === "out" ? "OUT→" : "EVT"}
              </span>
              {l.kind && (
                <span className="shrink-0 text-purple-400 w-20 truncate">{l.kind}</span>
              )}
              <div className="min-w-0 flex-1">
                {l.message ? (
                  <div className="text-slate-200">{l.message}</div>
                ) : (
                  <>
                    <div className="text-slate-300 break-all">
                      {l.hex?.match(/.{1,2}/g)?.join(" ")}
                    </div>
                    {l.ascii && <div className="text-slate-500 mt-0.5 break-all italic">{l.ascii}</div>}
                  </>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Hint */}
        <div className="mt-4 text-xs text-slate-500">
          {paused && <span className="text-amber-600 font-medium">⏸ Paused</span>}
          {!paused && !autoScroll && <span className="text-slate-600">Scroll locked — scroll to bottom to resume auto-scroll</span>}
          {!paused && autoScroll && <span>Auto-scroll on. Up to 1000 lines retained.</span>}
        </div>
      </div>
    </PageShell>
  );
}

function hexToAscii(hex: string): string {
  let out = "";
  for (let i = 0; i < hex.length; i += 2) {
    const b = parseInt(hex.substr(i, 2), 16);
    out += (b >= 0x20 && b < 0x7F) ? String.fromCharCode(b) : ".";
  }
  return out;
}
