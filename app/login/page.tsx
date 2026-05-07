"use client";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Cloud, Lock, User, Eye, EyeOff, AlertCircle, Shield, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export default function LoginPage() {
  const router = useRouter();
  const search = useSearchParams();
  const from = search.get("from") ?? "/dashboard";

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) {
        const d = await res.json();
        setError(d.error === "invalid_credentials" ? "Wrong username or password." : "Login failed.");
        return;
      }
      router.push(from);
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100">
      {/* Left visual */}
      <div className="hidden lg:flex flex-1 items-center justify-center relative overflow-hidden">
        <div className="absolute inset-0 gradient-header opacity-95" />
        <div className="absolute inset-0 bg-[url('data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2260%22 height=%2260%22%3E%3Cg fill=%22none%22 stroke=%22%23ffffff%22 stroke-opacity=%220.05%22%3E%3Cpath d=%22M0 30 L60 30 M30 0 L30 60%22/%3E%3C/g%3E%3C/svg%3E')]" />
        <div className="absolute -top-32 -left-32 h-96 w-96 rounded-full bg-cyan-400/20 blur-3xl" />
        <div className="absolute -bottom-32 -right-32 h-96 w-96 rounded-full bg-fuchsia-400/20 blur-3xl" />
        <div className="relative text-white max-w-md p-12">
          <div className="flex items-center gap-3 mb-8">
            <div className="h-12 w-12 rounded-xl bg-white/15 backdrop-blur flex items-center justify-center">
              <Cloud className="h-6 w-6" />
            </div>
            <div>
              <div className="text-xl font-semibold">Four-Faith Cloud</div>
              <div className="text-xs text-white/70 uppercase tracking-wider">Gateway Manager</div>
            </div>
          </div>
          <h2 className="text-3xl font-semibold leading-tight mb-4">
            Industrial gateways, centrally managed.
          </h2>
          <p className="text-white/80 leading-relaxed">
            Real-time monitoring, remote configuration, and OTA upgrades for your entire F2X16V4 fleet —
            with safety guards built in so a wrong click can't brick a device.
          </p>
          <div className="mt-10 grid grid-cols-2 gap-3 text-sm">
            <Feature label="Risk-tagged config" />
            <Feature label="Auto-revert watchdog" />
            <Feature label="Snapshot history" />
            <Feature label="Live capture" />
            <Feature label="WebSocket commands" />
            <Feature label="Firmware-aware parser" />
          </div>
        </div>
      </div>

      {/* Right form */}
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden text-center">
            <div className="inline-flex h-12 w-12 rounded-xl gradient-header items-center justify-center mb-3">
              <Cloud className="h-6 w-6 text-white" />
            </div>
            <h1 className="text-xl font-semibold text-slate-900">Four-Faith Cloud</h1>
          </div>

          <h1 className="text-2xl font-semibold text-slate-900">Sign in</h1>
          <p className="text-sm text-slate-500 mt-1">Welcome back. Enter your credentials to continue.</p>

          <form onSubmit={submit} className="mt-8 space-y-4">
            <div>
              <Label htmlFor="username" className="text-xs">Username</Label>
              <div className="relative mt-1">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input
                  id="username"
                  className="pl-9"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                  autoFocus
                  required
                />
              </div>
            </div>

            <div>
              <Label htmlFor="password" className="text-xs">Password</Label>
              <div className="relative mt-1">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input
                  id="password"
                  className="pl-9 pr-9"
                  type={showPwd ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPwd(!showPwd)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  tabIndex={-1}
                >
                  {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Sign in"}
            </Button>
          </form>

          <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            <div className="flex items-start gap-2">
              <Shield className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <div>
                <strong>First-time login:</strong> Default credentials are{" "}
                <code className="font-mono px-1 bg-amber-100 rounded">admin</code> /{" "}
                <code className="font-mono px-1 bg-amber-100 rounded">admin</code>.
                Change immediately in Settings.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Feature({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />
      <span className="text-white/90">{label}</span>
    </div>
  );
}
