"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { AlertTriangle, Lock } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { RemoteFeatureAccess } from "@/lib/remote-feature-access";

type Props = {
  access: RemoteFeatureAccess;
  feature: "Device Actions" | "Terminal" | "Remote Desktop";
  children: ReactNode;
};

type GateCopy = {
  icon: typeof Lock;
  eyebrow: string;
  message: string;
  detail?: string;
  action: "Upgrade to Pro" | "Review billing" | null;
};

function gateCopy(access: RemoteFeatureAccess, feature: Props["feature"]): GateCopy {
  if (access.state === "permission_denied") {
    return {
      icon: Lock,
      eyebrow: "Access restricted",
      message: `You don't have permission to use ${feature}.`,
      detail: "Ask an organization owner to update your access.",
      action: null,
    };
  }

  if (access.state === "upgrade_required") {
    return {
      icon: Lock,
      eyebrow: "Pro feature",
      message: `${feature} is available on Pro.`,
      detail: "Upgrade your plan to enable remote access.",
      action: "Upgrade to Pro",
    };
  }

  return {
    icon: AlertTriangle,
    eyebrow: "Subscription attention",
    message: `${feature} is unavailable while the subscription requires attention.`,
    detail: "Restore an active subscription to continue.",
    action: access.canManageBilling ? "Review billing" : null,
  };
}

export function RemoteFeatureGate({ access, feature, children }: Props) {
  if (access.canUse) return <>{children}</>;

  const copy = gateCopy(access, feature);
  const Icon = copy.icon;
  const isUpgrade = access.state === "upgrade_required";

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`${feature}: ${copy.message}`}
          className="sg-button sg-button-secondary cursor-pointer text-surface-muted"
        >
          <Icon size={15} aria-hidden="true" />
          {feature}
          {isUpgrade && <span className="rounded border border-surface-edge bg-surface-inset px-1.5 py-0.5 text-[9px] font-semibold leading-none tracking-[0.12em] text-surface-muted">PRO</span>}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={8}
        collisionPadding={12}
        className="w-[min(20rem,calc(100vw-1.5rem))] overflow-hidden rounded-xl border-surface-edge bg-[var(--sg-surface)] p-0 shadow-2xl"
      >
        <div className="flex items-start gap-3 px-3.5 py-3.5">
          <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${isUpgrade ? "border-surface-edge bg-surface-inset text-surface-muted" : access.state === "subscription_restricted" ? "border-amber-400/20 bg-amber-400/10 text-amber-300" : "border-surface-edge bg-surface-inset text-surface-muted"}`} aria-hidden="true">
            <Icon size={15} />
          </span>
          <div className="min-w-0 pt-0.5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-surface-muted">{copy.eyebrow}</p>
            <p className="mt-1 text-sm font-medium leading-5 text-zinc-100">{copy.message}</p>
            {copy.detail && <p className="mt-1 text-xs leading-5 text-surface-muted">{copy.detail}</p>}
          </div>
        </div>
        {copy.action && (
          <div className="border-t border-surface-edge px-3.5 py-2.5">
            <Link href="/dashboard/billing" className="sg-button sg-button-primary min-h-9 w-full px-3 text-xs">
              {copy.action}
            </Link>
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
