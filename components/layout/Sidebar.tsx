"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Router,
  Activity,
  Map,
  Bell,
  FileText,
  Users,
  Settings,
  Cable,
  Cloud,
  Cpu,
} from "lucide-react";
import { cn } from "@/lib/utils";

const items = [
  { href: "/dashboard",  label: "Dashboard",         icon: LayoutDashboard },
  { href: "/devices",    label: "Gateway Devices",   icon: Router },
  { href: "/firmware",   label: "Firmware Insights", icon: Cpu },
  { href: "/telemetry",  label: "Telemetry",         icon: Activity },
  { href: "/modbus",     label: "Modbus Tags",       icon: Cable },
  { href: "/map",        label: "GPS Map",           icon: Map },
  { href: "/alerts",     label: "Alerts",            icon: Bell },
  { href: "/logs",       label: "Logs",              icon: FileText },
  { href: "/users",      label: "Users",             icon: Users },
  { href: "/settings",   label: "Settings",          icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="hidden lg:flex flex-col w-60 border-r border-slate-200 bg-white">
      <div className="h-14 flex items-center gap-2 px-5 border-b border-slate-200">
        <div className="h-8 w-8 rounded-lg gradient-header flex items-center justify-center">
          <Cloud className="h-4 w-4 text-white" />
        </div>
        <div className="flex flex-col leading-tight">
          <span className="text-sm font-semibold text-slate-900">SNGPL Cloud</span>
          <span className="text-[10px] text-slate-500 uppercase tracking-wider">Gateway Manager</span>
        </div>
      </div>
      <nav className="flex-1 py-3 px-3 space-y-0.5 overflow-y-auto">
        {items.map((item) => {
          const active = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href));
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                active
                  ? "bg-blue-50 text-blue-700"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              )}
            >
              <Icon className={cn("h-4 w-4", active ? "text-blue-600" : "text-slate-400")} />
              <span>{item.label}</span>
              {active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-blue-500" />}
            </Link>
          );
        })}
      </nav>
      <div className="p-4 border-t border-slate-100">
        <div className="rounded-lg bg-gradient-to-br from-blue-500 to-blue-700 p-3 text-white">
          <div className="text-xs opacity-90 font-medium">TCP Listener</div>
          <div className="text-sm font-mono mt-0.5">0.0.0.0:10000</div>
          <div className="mt-2 flex items-center gap-1.5 text-[11px]">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-300 animate-pulse" />
            <span>Running</span>
          </div>
        </div>
      </div>
    </aside>
  );
}
