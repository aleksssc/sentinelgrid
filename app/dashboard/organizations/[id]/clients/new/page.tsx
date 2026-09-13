"use client";

import { useActionState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Building2, Plus } from "lucide-react";

import { createClientAction, type CreateClientState } from "./actions";

const initialState: CreateClientState = {};

export default function NewClientPage() {
  const params = useParams();
  const organizationId = params.id as string;
  const [state, formAction, pending] = useActionState(
    createClientAction.bind(null, organizationId),
    initialState
  );

  return (
    <div className="sg-page-shell"><div className="sg-page">
      <Link href={`/dashboard/organizations/${organizationId}`} className="mb-6 inline-flex items-center gap-2 text-sm text-surface-muted transition hover:text-white"><ArrowLeft size={16} />Back to organization</Link>
      <div className="mb-8 flex items-start gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-surface-edge bg-surface text-zinc-400"><Building2 size={22} /></div>
        <div><h1 className="sg-page-title">Create client</h1><p className="mt-2 text-zinc-400">Add a new client to this organization.</p></div>
      </div>
      <form action={formAction} className="sg-surface overflow-hidden">
        <div className="border-b border-surface-edge px-6 py-5"><h2 className="sg-section-title">Client information</h2><p className="mt-1 text-sm text-surface-muted">Basic information used to identify this client.</p></div>
        <div className="space-y-6 p-6">
          <div><label htmlFor="name" className="mb-2 block text-sm font-medium text-zinc-300">Client name</label><input id="name" name="name" type="text" required autoFocus placeholder="Example: SentinelGrid" className="sg-control w-full px-4 py-3" /><p className="mt-2 text-xs text-surface-muted">This name will appear throughout SentinelGrid.</p></div>
          <div><label htmlFor="description" className="mb-2 block text-sm font-medium text-zinc-300">Description</label><textarea id="description" name="description" placeholder="Optional description..." rows={5} className="sg-control w-full resize-none px-4 py-3" /><p className="mt-2 text-xs text-surface-muted">You can use this field for notes or context about the client.</p></div>
          {state.error && <div role="alert" className="rounded-xl border border-red-900/50 bg-red-950/30 px-4 py-3 text-sm text-red-400">{state.error}</div>}
        </div>
        <div className="flex items-center justify-end gap-3 border-t border-surface-edge px-6 py-5"><Link href={`/dashboard/organizations/${organizationId}`} className="sg-button sg-button-secondary">Cancel</Link><button type="submit" disabled={pending} className="sg-button sg-button-primary disabled:cursor-not-allowed disabled:opacity-50"><Plus size={16} />{pending ? "Creating..." : "Create client"}</button></div>
      </form>
    </div></div>
  );
}
