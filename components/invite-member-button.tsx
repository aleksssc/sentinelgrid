"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";

import {
  UserPlus,
  X,
  Loader2,
} from "lucide-react";

export function InviteMemberButton({
  organizationId,
  action,
}: {
  organizationId: string;
  action: (formData: FormData) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2.5 text-sm font-medium text-black transition hover:bg-zinc-200"
      >
        <UserPlus size={16} />
        Invite member
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-md overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >

            <div className="flex items-start justify-between border-b border-zinc-800 px-6 py-5">

              <div>
                <h2 className="font-semibold">
                  Invite member
                </h2>

                <p className="mt-1 text-sm text-zinc-500">
                  Invite someone to this organization.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-800 hover:text-white"
              >
                <X size={17} />
              </button>

            </div>

            <form action={action}>

              <input
                type="hidden"
                name="organization_id"
                value={organizationId}
              />

              <div className="space-y-6 p-6">

                <div>
                  <label
                    htmlFor="email"
                    className="mb-2 block text-sm font-medium"
                  >
                    Email address
                  </label>

                  <input
                    id="email"
                    name="email"
                    type="email"
                    required
                    autoComplete="off"
                    placeholder="user@example.com"
                    className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm outline-none transition placeholder:text-zinc-700 focus:border-zinc-600"
                  />
                </div>

                <div>
                  <label
                    htmlFor="role"
                    className="mb-2 block text-sm font-medium"
                  >
                    Role
                  </label>

                  <select
                    id="role"
                    name="role"
                    defaultValue="member"
                    className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm outline-none transition focus:border-zinc-600"
                  >
                    <option value="member">
                      Member
                    </option>

                    <option value="admin">
                      Admin
                    </option>
                  </select>
                </div>

              </div>

              <div className="flex justify-end gap-3 border-t border-zinc-800 px-6 py-4">

                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-lg px-4 py-2.5 text-sm text-zinc-400 transition hover:text-white"
                >
                  Cancel
                </button>

                <InviteSubmitButton />

              </div>

            </form>

          </div>
        </div>
      )}
    </>
  );
}


function InviteSubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex min-w-32 items-center justify-center gap-2 rounded-lg bg-white px-4 py-2.5 text-sm font-medium text-black transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? (
        <>
          <Loader2
            size={15}
            className="animate-spin"
          />

          Sending...
        </>
      ) : (
        <>
          <UserPlus size={15} />
          Send invite
        </>
      )}
    </button>
  );
}