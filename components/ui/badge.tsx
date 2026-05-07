import * as React from "react";
import { cn } from "@/lib/utils";

type Variant = "online" | "offline" | "unactivated" | "info" | "warn" | "neutral";

const styles: Record<Variant, string> = {
  online:      "bg-emerald-50 text-emerald-700 border-emerald-200",
  offline:     "bg-slate-100 text-slate-600 border-slate-200",
  unactivated: "bg-amber-50 text-amber-700 border-amber-200",
  info:        "bg-blue-50 text-blue-700 border-blue-200",
  warn:        "bg-orange-50 text-orange-700 border-orange-200",
  neutral:     "bg-slate-100 text-slate-700 border-slate-200",
};

const dotColor: Record<Variant, string> = {
  online: "bg-emerald-500",
  offline: "bg-slate-400",
  unactivated: "bg-amber-500",
  info: "bg-blue-500",
  warn: "bg-orange-500",
  neutral: "bg-slate-400",
};

export function Badge({
  variant = "neutral",
  children,
  withDot = false,
  className,
}: {
  variant?: Variant;
  children: React.ReactNode;
  withDot?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium",
        styles[variant],
        className
      )}
    >
      {withDot && <span className={cn("h-1.5 w-1.5 rounded-full", dotColor[variant])} />}
      {children}
    </span>
  );
}
