"use client";
import { useEffect, useState } from "react";
import { X, History, RotateCcw, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDate, formatRelative } from "@/lib/utils";

type Snapshot = { id: number; created_at: number; author: string | null; note: string | null };

export function SnapshotsModal({
  open, onClose, deviceCode, onRestored,
}: {
  open: boolean;
  onClose: () => void;
  deviceCode: string;
  onRestored: () => void;
}) {
  const [snaps, setSnaps] = useState<Snapshot[]>([]);
  const [loading, setLoading] = useState(false);
  const [restoringId, setRestoringId] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetch(`/api/devices/${deviceCode}/snapshots`)
      .then((r) => r.json())
      .then((d) => setSnaps(d.snapshots ?? []))
      .finally(() => setLoading(false));
  }, [open, deviceCode]);

  async function restore(id: number) {
    if (!confirm(`Restore snapshot #${id}? Current config will be saved as a new snapshot first.`)) return;
    setRestoringId(id);
    try {
      await fetch(`/api/devices/${deviceCode}/snapshots`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ snapshotId: id }),
      });
      onRestored();
      onClose();
    } finally {
      setRestoringId(null);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 h-14 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-blue-600" />
            <span className="font-semibold text-slate-900">Configuration History</span>
            <span className="text-xs text-slate-500 font-mono">{deviceCode}</span>
          </div>
          <button onClick={onClose} className="h-8 w-8 rounded-md hover:bg-slate-100 flex items-center justify-center text-slate-500">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center h-32 text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          ) : snaps.length === 0 ? (
            <div className="text-center py-12 text-sm text-slate-400">
              No snapshots yet. They'll be created automatically when you save changes.
            </div>
          ) : (
            <div className="space-y-2">
              {snaps.map((s) => (
                <div key={s.id} className="border border-slate-200 rounded-lg p-3 hover:bg-slate-50 transition-colors flex items-center justify-between">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-slate-900">Snapshot #{s.id}</div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {formatDate(s.created_at)} · {formatRelative(s.created_at)}
                    </div>
                    {s.note && <div className="text-xs text-slate-600 mt-1 italic">"{s.note}"</div>}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={restoringId === s.id}
                    onClick={() => restore(s.id)}
                  >
                    {restoringId === s.id
                      ? <Loader2 className="h-3 w-3 animate-spin" />
                      : <RotateCcw className="h-3 w-3" />}
                    Restore
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="px-6 py-3 border-t border-slate-100 text-xs text-slate-500 bg-slate-50/40">
          Restoring will save the current config as a new snapshot first — nothing is ever lost.
        </div>
      </div>
    </div>
  );
}
