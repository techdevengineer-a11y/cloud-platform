"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, HelpCircle, Search, User, ChevronDown, LogOut } from "lucide-react";

export function TopBar() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [user, setUser] = useState<{ username: string; role: string } | null>(null);

  useEffect(() => {
    fetch("/api/auth/me").then(r => r.ok ? r.json() : null).then(d => d && setUser(d.user));
  }, []);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="h-14 border-b border-slate-200 bg-white flex items-center px-6 gap-4">
      <div className="flex-1 max-w-md relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <input
          placeholder="Search devices, codes, tags…"
          className="w-full h-9 pl-9 pr-3 rounded-md bg-slate-50 border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
        />
      </div>
      <div className="ml-auto flex items-center gap-2">
        <button className="hidden md:inline-flex items-center gap-1.5 px-3 h-9 rounded-md text-sm text-slate-600 hover:bg-slate-100">
          <span className="text-xs font-medium uppercase tracking-wider text-slate-400">Server</span>
          <span className="font-mono text-xs">159.138.121.43:10000</span>
        </button>
        <button className="h-9 w-9 rounded-md hover:bg-slate-100 flex items-center justify-center relative">
          <Bell className="h-4 w-4 text-slate-600" />
          <span className="absolute top-2 right-2 h-1.5 w-1.5 bg-red-500 rounded-full" />
        </button>
        <button className="h-9 w-9 rounded-md hover:bg-slate-100 flex items-center justify-center">
          <HelpCircle className="h-4 w-4 text-slate-600" />
        </button>
        <div className="h-6 w-px bg-slate-200 mx-1" />
        <div className="relative">
          <button onClick={() => setOpen(!open)} className="flex items-center gap-2 h-9 pl-1 pr-3 rounded-md hover:bg-slate-100">
            <div className="h-7 w-7 rounded-full bg-gradient-to-br from-blue-500 to-blue-700 text-white flex items-center justify-center text-xs font-semibold">
              <User className="h-3.5 w-3.5" />
            </div>
            <span className="text-sm font-medium text-slate-700">{user?.username ?? "…"}</span>
            <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
          </button>
          {open && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
              <div className="absolute right-0 mt-1 w-48 bg-white rounded-md shadow-lg border border-slate-200 z-20 py-1 text-sm">
                <div className="px-3 py-2 border-b border-slate-100">
                  <div className="text-sm font-medium text-slate-900">{user?.username}</div>
                  <div className="text-xs text-slate-500 capitalize">{user?.role}</div>
                </div>
                <button onClick={logout} className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-red-50 text-red-600">
                  <LogOut className="h-3.5 w-3.5" /> Sign out
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
