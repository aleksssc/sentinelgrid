import type { ComponentProps } from "react";
import { ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

export type StatusTone = "neutral" | "success" | "warning" | "danger" | "info";

const statusTones: Record<string, StatusTone> = {
  active: "success", online: "success", connected: "success", healthy: "success", success: "success", succeeded: "success",
  warning: "warning", pending: "warning", running: "warning",
  failed: "danger", error: "danger", expired: "danger",
  requested: "info",
};

export function StatusBadge({ status, tone, className, children, ...props }: ComponentProps<"span"> & {
  status: string;
  tone?: StatusTone;
}) {
  return <span {...props} className={cn("sg-badge sg-status-badge", className)} data-tone={tone ?? statusTones[status.toLowerCase()] ?? "neutral"}>
    <span className="sg-badge-dot" aria-hidden="true" />
    {children ?? (status.charAt(0).toUpperCase() + status.slice(1))}
  </span>;
}

export function RoleBadge({ role, className, ...props }: Omit<ComponentProps<"span">, "children"> & { role: string }) {
  return <span {...props} className={cn("sg-badge sg-role-badge", className)} data-tone="neutral">
    <ShieldCheck size={12} aria-hidden="true" />{role.charAt(0).toUpperCase() + role.slice(1)}
  </span>;
}
