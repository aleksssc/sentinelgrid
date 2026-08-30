"use client";

import {
  useActionState,
  useEffect,
  useRef,
} from "react";

import {
  Send,
  UserPlus,
} from "lucide-react";

import {
  inviteMemberAction,
  type InviteMemberState,
} from "./actions";


const initialState:
  InviteMemberState = {};


export default function InviteMemberForm({
  organizationId,
  disabled = false,
  disabledReason,
}: {
  organizationId: string;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const formRef =
    useRef<HTMLFormElement>(
      null
    );


  const action =
    inviteMemberAction.bind(
      null,
      organizationId
    );


  const [
    state,
    formAction,
    pending,
  ] =
    useActionState(
      action,
      initialState
    );


  useEffect(() => {
    if (state.success) {
      formRef.current?.reset();
    }
  }, [state.success]);


  return (
    <form
      ref={formRef}
      action={formAction}
      className="space-y-4"
    >

      <div>

        <label
          htmlFor="email"
          className="mb-2 block text-xs font-medium text-zinc-400"
        >
          Email Address
        </label>

        <input
          id="email"
          name="email"
          type="email"
          required
          disabled={
            disabled ||
            pending
          }
          placeholder="member@company.com"
          className="w-full rounded-lg border border-white/10 bg-black/20 px-3.5 py-2.5 text-sm text-white outline-none transition placeholder:text-zinc-700 focus:border-blue-500/60 disabled:cursor-not-allowed disabled:opacity-50"
        />

      </div>


      <div>

        <label
          htmlFor="role"
          className="mb-2 block text-xs font-medium text-zinc-400"
        >
          Role
        </label>

        <select
          id="role"
          name="role"
          defaultValue="member"
          disabled={
            disabled ||
            pending
          }
          className="w-full rounded-lg border border-white/10 bg-[#0a0c10] px-3.5 py-2.5 text-sm text-white outline-none transition focus:border-blue-500/60 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <option value="member">
            Member
          </option>

          <option value="admin">
            Admin
          </option>
        </select>

      </div>


      {state.error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/[0.08] px-3 py-2.5 text-xs text-red-400">
          {state.error}
        </div>
      )}


      {state.success && (
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.08] px-3 py-2.5 text-xs text-emerald-400">
          {state.success}
        </div>
      )}


      {disabledReason && (
        <div className="rounded-lg border border-orange-500/20 bg-orange-500/[0.08] px-3 py-2.5 text-xs leading-5 text-orange-400">
          {disabledReason}
        </div>
      )}


      <button
        type="submit"
        disabled={
          disabled ||
          pending
        }
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-white px-4 py-2.5 text-sm font-medium text-black transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-40"
      >

        {pending ? (
          <>
            <Send size={15} />
            Sending...
          </>
        ) : (
          <>
            <UserPlus size={15} />
            Send Invitation
          </>
        )}

      </button>

    </form>
  );
}