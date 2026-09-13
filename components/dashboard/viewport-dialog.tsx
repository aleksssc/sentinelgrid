"use client";

import { useEffect, useRef, type ReactNode } from "react";

export default function ViewportDialog({ label, onDismiss, children }: {
  label: string;
  onDismiss: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const viewport = window.visualViewport;
    // iOS resizes/pans the visual viewport, not the layout viewport, for its keyboard.
    function updateViewport() {
      if (!dialog || !viewport) return;
      dialog.style.setProperty("--sg-viewport-top", `${viewport.offsetTop}px`);
      dialog.style.setProperty("--sg-viewport-left", `${viewport.offsetLeft}px`);
      dialog.style.setProperty("--sg-viewport-width", `${viewport.width}px`);
      dialog.style.setProperty("--sg-viewport-height", `${viewport.height}px`);
    }
    updateViewport();
    dialog.showModal();
    viewport?.addEventListener("resize", updateViewport);
    viewport?.addEventListener("scroll", updateViewport);
    return () => {
      viewport?.removeEventListener("resize", updateViewport);
      viewport?.removeEventListener("scroll", updateViewport);
      dialog.close();
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);

  return (
    <dialog ref={ref} aria-label={label} className="sg-viewport-dialog"
      onCancel={(event) => { event.preventDefault(); onDismiss(); }}
      onClick={(event) => { if (event.target === event.currentTarget) onDismiss(); }}>
      {children}
    </dialog>
  );
}
