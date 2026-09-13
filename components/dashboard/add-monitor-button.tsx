"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Globe2, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { FormSubmitButton } from "@/components/dashboard/form-submit-button";

type AddMonitorButtonProps = {
  action: (formData: FormData) => void | Promise<void>;
  variant?: "primary" | "secondary";
  className?: string;
  compact?: boolean;
};

export function AddMonitorButton({ action, variant = "primary", className, compact = false }: AddMonitorButtonProps) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;

    const frame = window.requestAnimationFrame(() => nameInput.current?.focus({ preventScroll: true }));
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function close() {
    setOpen(false);
    window.requestAnimationFrame(() => trigger.current?.focus({ preventScroll: true }));
  }

  return (
    <>
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={`${id}-dialog`}
        className={cn("sg-button", variant === "primary" ? "sg-button-primary" : "sg-button-secondary", compact && "sg-button-sm", className)}
      >
        <Plus size={compact ? 15 : 16} aria-hidden="true" />
        Add monitor
      </button>

      {open && (
        <div
          className="sg-monitor-modal-layer"
          role="presentation"
          onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}
        >
          <section
            id={`${id}-dialog`}
            role="dialog"
            aria-modal="true"
            aria-labelledby={`${id}-title`}
            aria-describedby={`${id}-description`}
            className="sg-surface sg-monitor-modal"
          >
            <header className="sg-panel-header !flex-nowrap !items-start">
              <div className="flex min-w-0 items-start gap-3">
                <span className="sg-section-icon" aria-hidden="true"><Globe2 size={17} className="text-[var(--sg-accent-text)]" /></span>
                <div className="min-w-0">
                  <h2 id={`${id}-title`} className="sg-section-title">Add monitor</h2>
                  <p id={`${id}-description`} className="sg-section-description">Create an HTTP or HTTPS endpoint and run checks whenever you need them.</p>
                </div>
              </div>
              <button type="button" onClick={close} className="sg-button sg-button-ghost sg-button-icon shrink-0" aria-label="Close add monitor dialog">
                <X size={17} aria-hidden="true" />
              </button>
            </header>

            <form action={action}>
              <div className="sg-panel-body space-y-5">
                <div>
                  <label htmlFor={`${id}-name`} className="mb-2 block text-xs font-medium text-[var(--sg-text)]">Monitor name</label>
                  <input ref={nameInput} id={`${id}-name`} name="name" required autoComplete="off" placeholder="Production API" className="sg-control w-full px-3" />
                  <p className="sg-meta mt-2">Use a recognisable name for this service or endpoint.</p>
                </div>
                <div>
                  <label htmlFor={`${id}-url`} className="mb-2 block text-xs font-medium text-[var(--sg-text)]">Endpoint URL</label>
                  <input id={`${id}-url`} name="url" type="url" required inputMode="url" autoComplete="url" placeholder="https://api.example.com/health" className="sg-control w-full px-3" />
                  <p className="sg-meta mt-2">Only HTTP and HTTPS endpoints are supported.</p>
                </div>
              </div>
              <footer className="sg-panel-body flex flex-wrap items-center justify-between gap-3 border-t border-surface-edge">
                <p className="sg-meta">Checks are run manually from the inventory.</p>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={close} className="sg-button sg-button-secondary">Cancel</button>
                  <FormSubmitButton pendingLabel="Creating..."><Plus size={15} aria-hidden="true" />Create monitor</FormSubmitButton>
                </div>
              </footer>
            </form>
          </section>
        </div>
      )}
    </>
  );
}
