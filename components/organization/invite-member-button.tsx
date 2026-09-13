"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, Mail, ShieldCheck, UserPlus, X } from "lucide-react";
import { FormSubmitButton } from "@/components/dashboard/form-submit-button";

type InviteMemberButtonProps = {
  organizationId: string;
  action: (formData: FormData) => void | Promise<void>;
};

export function InviteMemberButton({ organizationId, action }: InviteMemberButtonProps) {
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
    else if (!open && dialog.current?.open) dialog.current.close();
  }, [open]);

  return (
    <>
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-controls={`${id}-dialog`}
        className="sg-button sg-button-primary"
      >
        <UserPlus size={16} aria-hidden="true" />
        Invite member
      </button>

      <dialog
        ref={dialog}
        id={`${id}-dialog`}
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-description`}
        onCancel={() => setOpen(false)}
        onClose={() => { setOpen(false); trigger.current?.focus(); }}
        onClick={(event) => {
          if (event.target !== event.currentTarget) return;
          const bounds = event.currentTarget.getBoundingClientRect();
          if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) setOpen(false);
        }}
        className="sg-surface sg-dialog fixed inset-0 m-auto w-[calc(100%-2rem)] max-w-md p-0 text-inherit outline-none backdrop:bg-black/60 backdrop:backdrop-blur-sm open:animate-in open:fade-in-0 open:slide-in-from-bottom-2 open:duration-200"
      >
        {open && (
          <>
            <div className="sg-panel-header !flex-nowrap !items-start">
              <div className="flex min-w-0 items-start gap-3">
                <span className="sg-section-icon" aria-hidden="true">
                  <UserPlus size={17} className="text-[var(--sg-accent-text)]" />
                </span>
                <div className="min-w-0">
                  <h2 id={`${id}-title`} className="sg-section-title">Invite member</h2>
                  <p id={`${id}-description`} className="sg-section-description">
                    Add someone to this organization and choose their access level.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close invite dialog"
                className="sg-button sg-button-ghost sg-button-icon shrink-0"
              >
                <X size={17} aria-hidden="true" />
              </button>
            </div>

            <form action={action}>
              <input type="hidden" name="organization_id" value={organizationId} />
              <div className="sg-panel-body space-y-4">
                <div>
                  <label htmlFor={`${id}-email`} className="mb-2 block text-xs font-medium text-[var(--sg-text)]">
                    Email address
                  </label>
                  <div className="relative">
                    <Mail size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-surface-muted" />
                    <input
                      id={`${id}-email`}
                      name="email"
                      type="email"
                      required
                      autoFocus
                      autoComplete="email"
                      placeholder="user@example.com"
                      className="sg-control w-full pl-10 pr-3"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor={`${id}-role`} className="mb-2 block text-xs font-medium text-[var(--sg-text)]">
                    Role
                  </label>
                  <div className="relative">
                    <ShieldCheck size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-surface-muted" />
                    <select
                      id={`${id}-role`}
                      name="role"
                      defaultValue="member"
                      aria-describedby={`${id}-role-description`}
                      className="sg-control w-full appearance-none pl-10 pr-10"
                    >
                      <option value="member">Member</option>
                      <option value="admin">Admin</option>
                    </select>
                    <ChevronDown size={14} aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-surface-muted" />
                  </div>
                  <p id={`${id}-role-description`} className="sg-meta mt-2">
                    Members get standard access. Admins have elevated management permissions.
                  </p>
                </div>
              </div>

              <div className="sg-panel-body flex flex-wrap items-center justify-end gap-2 border-t border-surface-edge">
                <button type="button" onClick={() => setOpen(false)} className="sg-button sg-button-secondary">
                  Cancel
                </button>
                <FormSubmitButton pendingLabel="Sending...">
                  <UserPlus size={15} aria-hidden="true" />
                  Send invite
                </FormSubmitButton>
              </div>
            </form>
          </>
        )}
      </dialog>
    </>
  );
}
