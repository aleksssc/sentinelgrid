"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, KeyRound, Loader2, ShieldCheck, ShieldOff, Trash2, UserRoundCheck } from "lucide-react";
import ViewportDialog from "@/components/dashboard/viewport-dialog";
import { changePlatformRoleAction, deleteUserAction, restoreUserAction, sendPasswordResetAction, suspendUserAction } from "@/app/admin/users/actions";
import type { PlatformRole } from "@/lib/platform-access";

type Action = "suspend" | "restore" | "reset" | "role" | "delete";
type ActionResult = { error?: string; success?: string };

export function UserActions({ userId, email, suspended, platformRole, self }: { userId: string; email: string | null; suspended: boolean; platformRole: PlatformRole | null; self: boolean }) {
  const router = useRouter();
  const [action, setAction] = useState<Action | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const closeDialog = () => {
    if (!pending) setAction(null);
  };

  const execute = (operation: () => Promise<ActionResult>) => startTransition(async () => {
    setMessage(null);
    const state = await operation();
    if (state.error) {
      setMessage(state.error);
      return;
    }
    setMessage(state.success ?? null);
    closeDialog();
    router.refresh();
  });

  const title = action === "delete" ? "Delete user permanently" : action === "suspend" ? "Suspend login" : action === "restore" ? "Restore login" : action === "reset" ? "Send password reset" : "Manage platform access";
  const roleLabel = platformRole === "developer" ? "Developer" : platformRole === "platform_admin" ? "Platform Admin" : "No platform access";

  return <>
    <div className="sg-admin-action-stack">
      <button type="button" className="sg-button sg-button-secondary sg-button-sm" onClick={() => setAction("reset")}><KeyRound size={14} />Send password reset</button>
      {suspended
        ? <button type="button" className="sg-button sg-button-secondary sg-button-sm" onClick={() => setAction("restore")}><UserRoundCheck size={14} />Restore login</button>
        : <button type="button" disabled={self} className="sg-button sg-button-secondary sg-button-sm" onClick={() => setAction("suspend")}><ShieldOff size={14} />Suspend login</button>}
      <button type="button" disabled={self} className="sg-button sg-button-secondary sg-button-sm" onClick={() => setAction("role")}><ShieldCheck size={14} />Manage platform access</button>
      <button type="button" disabled={self} className="sg-button sg-button-danger sg-button-sm" onClick={() => setAction("delete")}><Trash2 size={14} />Delete account</button>
    </div>
    {self && <p className="mt-3 text-xs text-surface-muted">You cannot suspend, delete or remove platform access from your own platform account.</p>}
    {message && <p role="status" className="sg-inline-notice mt-4">{message}</p>}
    {action && <ViewportDialog label={title} onDismiss={closeDialog}>
      <div className={`sg-admin-confirm-dialog${action === "delete" ? " sg-admin-confirm-dialog-danger" : ""}`}>
        {action === "delete" && <span className="sg-admin-confirm-icon" aria-hidden="true"><AlertTriangle size={18} /></span>}
        <div className="sg-admin-confirm-heading">
          <p>{action === "delete" ? "Danger zone" : "Confirm action"}</p>
          <h2>{title}</h2>
        </div>
        {action === "suspend" && <p>Suspending login blocks new sign-ins while preserving this user&apos;s organizations, memberships and history.</p>}
        {action === "restore" && <p>This restores the user&apos;s ability to sign in.</p>}
        {action === "reset" && <p>Send the official password recovery email to {email ?? "this account"}. Passwords are never shown or set by administrators.</p>}
        {action === "role" && <>
          <p>Platform access is global and separate from organization roles. Current access: <strong>{roleLabel}</strong>.</p>
          <div className="mt-4 grid gap-2" aria-label="Platform access options">
            <button type="button" disabled={pending || self || platformRole === "developer"} className="rounded-lg border border-surface-edge bg-surface-raised px-3 py-2.5 text-left transition-colors hover:border-sky-400/40 hover:bg-surface disabled:cursor-not-allowed disabled:opacity-45" onClick={() => execute(() => changePlatformRoleAction(userId, "developer"))}><strong className="block text-sm font-medium text-zinc-100">Developer</strong><span className="mt-1 block text-xs text-surface-muted">System, releases and diagnostics access.</span></button>
            <button type="button" disabled={pending || self || platformRole === "platform_admin"} className="rounded-lg border border-surface-edge bg-surface-raised px-3 py-2.5 text-left transition-colors hover:border-sky-400/40 hover:bg-surface disabled:cursor-not-allowed disabled:opacity-45" onClick={() => execute(() => changePlatformRoleAction(userId, "platform_admin"))}><strong className="block text-sm font-medium text-zinc-100">Platform Admin</strong><span className="mt-1 block text-xs text-surface-muted">User and organization administration access.</span></button>
          </div>
        </>}
        {action === "delete" && <div className="sg-admin-delete-confirmation"><p>This action permanently deletes {email ?? "this account"}. Accounts with organization ownership or memberships cannot be deleted until those relationships are resolved.</p></div>}
        <div className="sg-admin-confirm-actions">
          <button type="button" disabled={pending} className="sg-button sg-button-secondary" onClick={closeDialog}>Cancel</button>
          {action === "role" && platformRole && <button type="button" disabled={pending || self} className="sg-button sg-button-danger" onClick={() => execute(() => changePlatformRoleAction(userId, null))}>{pending && <Loader2 size={14} className="animate-spin" />}Remove platform access</button>}
          {action !== "role" && <button type="button" disabled={pending} className={action === "delete" ? "sg-button sg-button-danger" : "sg-button sg-button-primary"} onClick={() => execute(() => action === "suspend" ? suspendUserAction(userId) : action === "restore" ? restoreUserAction(userId) : action === "reset" ? sendPasswordResetAction(userId) : deleteUserAction(userId))}>{pending && <Loader2 size={14} className="animate-spin" />}{action === "delete" ? "Delete user permanently" : action === "suspend" ? "Suspend login" : action === "restore" ? "Restore login" : "Send reset email"}</button>}
        </div>
      </div>
    </ViewportDialog>}
  </>;
}
