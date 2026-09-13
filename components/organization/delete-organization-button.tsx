"use client";

import { useState } from "react";
import { Trash2, X } from "lucide-react";

export function DeleteOrganizationButton({
  organizationName,
  action,
}: {
  organizationName: string;
  action: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (deleting) return;
    setDeleting(true);
    await action();
  }

  const close = () => {
    if (!deleting) setOpen(false);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="sg-button sg-button-danger-solid text-red-400"
      >
        <Trash2 size={16} />
        Delete organization
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm"
          onClick={close}
        >
          <div
            className="sg-surface w-full sg-dialog max-w-md overflow-hidden"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between border-b border-surface-edge px-6 py-5">
              <div>
                <h2 className="sg-section-title text-white">Delete organization</h2>
                <p className="mt-1 text-sm text-surface-muted">This action cannot be undone.</p>
              </div>
              <button
                type="button"
                disabled={deleting}
                onClick={close}
                aria-label="Close delete dialog"
                className="sg-button sg-button-ghost sg-button-icon w-8 text-surface-muted disabled:pointer-events-none"
              >
                <X size={17} />
              </button>
            </div>

            <div className="p-6">
              <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4">
                <p className="text-sm font-medium text-red-400">Delete {organizationName} permanently</p>
                <p className="mt-2 text-sm leading-6 text-zinc-400">
                  Deleting this organization permanently removes its sites, devices and associated data.
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-3 border-t border-surface-edge px-6 py-4">
              <button
                type="button"
                disabled={deleting}
                onClick={close}
                className="sg-button sg-button-ghost disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={handleDelete}
                className="sg-button sg-button-danger-solid disabled:cursor-not-allowed disabled:opacity-40"
              >
                {deleting ? (
                  <>
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                    Deleting...
                  </>
                ) : (
                  <>
                    <Trash2 size={16} />
                    Delete permanently
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
