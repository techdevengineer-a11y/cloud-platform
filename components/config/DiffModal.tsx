"use client";
import { useMemo, useState } from "react";
import { ShieldAlert, ShieldCheck, ShieldQuestion, X, ArrowRight, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { diffConfig, validateConfig, type Risk, RISK_COLOR } from "@/lib/safety";

const RISK_ORDER: Risk[] = ["critical", "caution", "safe"];
const RISK_ICON = {
  critical: ShieldAlert,
  caution:  ShieldQuestion,
  safe:     ShieldCheck,
};

export function DiffModal({
  open, onClose, onConfirm, deviceCode, deviceName, oldConfig, newConfig, saving,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (typedCode: string) => Promise<void>;
  deviceCode: string;
  deviceName: string;
  oldConfig: any;
  newConfig: any;
  saving: boolean;
}) {
  const [typedCode, setTypedCode] = useState("");
  const [showAll, setShowAll] = useState(false);

  const changes = useMemo(() => diffConfig(oldConfig, newConfig), [oldConfig, newConfig]);
  const errors = useMemo(() => validateConfig(newConfig), [newConfig]);

  const counts = {
    safe:     changes.filter((c) => c.risk === "safe").length,
    caution:  changes.filter((c) => c.risk === "caution").length,
    critical: changes.filter((c) => c.risk === "critical").length,
  };
  const hasCritical = counts.critical > 0;
  const canConfirm = errors.length === 0 && (!hasCritical || typedCode === deviceCode);

  if (!open) return null;

  if (changes.length === 0) {
    return (
      <Backdrop onClose={onClose}>
        <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
          <Header onClose={onClose} title="No changes" />
          <div className="p-6 text-center text-slate-600">
            <ShieldCheck className="h-10 w-10 text-emerald-500 mx-auto mb-3" />
            <p>This config is identical to the saved version. Nothing to save.</p>
          </div>
          <div className="px-6 pb-5 flex justify-end">
            <Button variant="outline" onClick={onClose}>Close</Button>
          </div>
        </div>
      </Backdrop>
    );
  }

  return (
    <Backdrop onClose={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col">
        <Header onClose={onClose} title="Review Changes Before Save" subtitle={`${deviceName} · ${deviceCode}`} />

        {/* Risk summary */}
        <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50">
          <div className="grid grid-cols-3 gap-3">
            {(["critical","caution","safe"] as Risk[]).map((r) => {
              const Icon = RISK_ICON[r];
              const c = counts[r];
              const colors = RISK_COLOR[r];
              return (
                <div key={r} className={cn("rounded-lg border p-3 flex items-center gap-2", colors.bg, colors.border)}>
                  <Icon className={cn("h-4 w-4", colors.text)} />
                  <div className="leading-tight">
                    <div className={cn("text-sm font-semibold capitalize", colors.text)}>{c} {r}</div>
                    <div className="text-[11px] text-slate-500">change{c === 1 ? "" : "s"}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Validation errors */}
        {errors.length > 0 && (
          <div className="mx-6 mt-4 rounded-lg border border-red-200 bg-red-50 p-3">
            <div className="flex items-center gap-2 text-red-700 text-sm font-medium mb-2">
              <AlertTriangle className="h-4 w-4" /> Cannot save — these issues must be fixed first:
            </div>
            <ul className="text-xs text-red-700 space-y-1 ml-6 list-disc">
              {errors.map((e, i) => <li key={i}><span className="font-mono">{e.path}</span>: {e.message}</li>)}
            </ul>
          </div>
        )}

        {/* Diff list */}
        <div className="flex-1 overflow-y-auto p-6 space-y-2">
          {RISK_ORDER.flatMap((risk) => {
            const inRisk = changes.filter((c) => c.risk === risk);
            if (inRisk.length === 0) return [];
            const colors = RISK_COLOR[risk];
            return [
              <div key={`hdr-${risk}`} className={cn("text-xs font-semibold uppercase tracking-wider mt-2 first:mt-0", colors.text)}>
                {risk} ({inRisk.length})
              </div>,
              ...inRisk.map((c, i) => (
                <DiffRow key={`${risk}-${i}`} change={c} />
              )),
            ];
          })}
        </div>

        {/* Critical confirmation */}
        {hasCritical && (
          <div className="px-6 pt-4 pb-2 border-t border-slate-100 bg-red-50/40">
            <div className="flex items-start gap-2 text-sm text-red-700 mb-2">
              <ShieldAlert className="h-4 w-4 mt-0.5 shrink-0" />
              <div>
                <div className="font-semibold">Critical changes detected</div>
                <div className="text-xs text-red-600/80 mt-0.5">
                  These could disconnect the device. Type the device code <span className="font-mono font-semibold">{deviceCode}</span> below to confirm you want to proceed.
                </div>
              </div>
            </div>
            <Input
              value={typedCode}
              onChange={(e) => setTypedCode(e.target.value)}
              placeholder={`Type "${deviceCode}" to confirm`}
              className="font-mono"
            />
          </div>
        )}

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between bg-slate-50/40">
          <div className="text-xs text-slate-500">
            {hasCritical
              ? <>Auto-revert: 5 min after save</>
              : counts.caution > 0
                ? <>Auto-revert armed for caution changes</>
                : <>No watchdog needed (safe-only)</>}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button
              variant={hasCritical ? "danger" : "primary"}
              disabled={!canConfirm || saving}
              onClick={() => onConfirm(typedCode)}
            >
              {saving ? "Saving…" : hasCritical ? "Apply Critical Changes" : "Apply Changes"}
            </Button>
          </div>
        </div>
      </div>
    </Backdrop>
  );
}

function DiffRow({ change }: { change: { path: string; oldValue: any; newValue: any; risk: Risk } }) {
  const colors = RISK_COLOR[change.risk];
  return (
    <div className={cn("rounded-lg border p-3", colors.border, colors.bg)}>
      <div className="flex items-center gap-2 mb-1.5">
        <span className={cn("h-1.5 w-1.5 rounded-full", colors.dot)} />
        <span className="font-mono text-[11px] text-slate-700">{change.path}</span>
      </div>
      <div className="flex items-center gap-3 text-sm">
        <span className="text-slate-500 line-through truncate max-w-[200px]" title={String(change.oldValue)}>
          {formatVal(change.oldValue)}
        </span>
        <ArrowRight className="h-3 w-3 text-slate-400 shrink-0" />
        <span className={cn("font-medium truncate max-w-[200px]", colors.text)} title={String(change.newValue)}>
          {formatVal(change.newValue)}
        </span>
      </div>
    </div>
  );
}

function formatVal(v: any) {
  if (v === undefined || v === null) return <em className="text-slate-400">empty</em>;
  if (typeof v === "boolean") return v ? "On" : "Off";
  if (typeof v === "object") return JSON.stringify(v);
  if (v === "") return <em className="text-slate-400">empty</em>;
  return String(v);
}

function Backdrop({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full flex justify-center">{children}</div>
    </div>
  );
}

function Header({ title, subtitle, onClose }: { title: string; subtitle?: string; onClose: () => void }) {
  return (
    <div className="flex items-center justify-between px-6 h-14 border-b border-slate-100">
      <div>
        <div className="font-semibold text-slate-900">{title}</div>
        {subtitle && <div className="text-xs text-slate-500 font-mono mt-0.5">{subtitle}</div>}
      </div>
      <button onClick={onClose} className="h-8 w-8 rounded-md hover:bg-slate-100 flex items-center justify-center text-slate-500">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
