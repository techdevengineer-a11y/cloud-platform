import { Badge } from "@/components/ui/badge";

export function StatusBadge({ status }: { status: string }) {
  const v = status === "online" ? "online" : status === "offline" ? "offline" : "unactivated";
  const label = status === "online" ? "Online" : status === "offline" ? "Offline" : "Unactivated";
  return <Badge variant={v} withDot>{label}</Badge>;
}
