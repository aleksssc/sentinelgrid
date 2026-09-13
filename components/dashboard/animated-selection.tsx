"use client";

import { useLayoutEffect, useRef, type ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function AnimatedSelection({ value, className, children, ...props }: ComponentProps<"div"> & { value: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const indicatorRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const indicator = indicatorRef.current;
    if (!container || !indicator) return;
    let frame = 0;
    const update = () => {
      const active = container.querySelector<HTMLElement>('[aria-pressed="true"], [aria-current="page"], label:has(input:checked)');
      if (!active) { indicator.style.opacity = "0"; return; }
      // Offsets stay in the scroll container's coordinate space, including wrapped rows.
      indicator.style.width = `${active.offsetWidth}px`;
      indicator.style.transform = `translate(${active.offsetLeft}px, ${active.offsetTop + active.offsetHeight - 2}px)`;
      indicator.style.opacity = "1";
      if (!indicator.dataset.ready && !frame) frame = requestAnimationFrame(() => { indicator.dataset.ready = "true"; });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(container);
    container.querySelectorAll("button, a, label").forEach((item) => observer.observe(item));
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [value, children]);

  return <div {...props} ref={containerRef} className={cn("sg-selection-group", className)}>
    {children}
    <span ref={indicatorRef} aria-hidden="true" className="sg-selection-indicator" style={{ width: 0, opacity: 0 }} />
  </div>;
}
