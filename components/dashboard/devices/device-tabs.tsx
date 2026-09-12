"use client";

import { useLayoutEffect, useRef } from "react";

type Props<T extends string> = {
  tabs: ReadonlyArray<{ id: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
};

export default function DeviceTabs<T extends string>({
  tabs,
  value,
  onChange,
}: Props<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const indicatorRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const indicator = indicatorRef.current;
    if (!container || !indicator) return;

    const updateIndicator = () => {
      const active = container.querySelector<HTMLButtonElement>(
        'button[aria-pressed="true"]',
      );
      if (!active) return;

      indicator.style.width = `${active.offsetWidth}px`;
      indicator.style.transform = `translateX(${active.offsetLeft}px)`;
      indicator.style.opacity = "1";
    };

    updateIndicator();
    const observer = new ResizeObserver(updateIndicator);
    observer.observe(container);
    container.querySelectorAll("button").forEach((button) => {
      observer.observe(button);
    });
    return () => observer.disconnect();
  }, [tabs, value]);

  return (
    <div className="mt-5 overflow-x-auto border-b border-zinc-800">
      <div ref={containerRef} className="relative flex min-w-max gap-5">
        <span
          ref={indicatorRef}
          aria-hidden="true"
          className="pointer-events-none absolute bottom-0 left-0 h-0.5 bg-emerald-400 transition-[transform,width] duration-200 ease-out motion-reduce:transition-none"
          style={{ width: 0, opacity: 0 }}
        />
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            aria-pressed={value === tab.id}
            onClick={() => onChange(tab.id)}
            className={`border-b-2 border-transparent pb-3 text-xs font-medium transition-colors duration-200 motion-reduce:transition-none focus-visible:outline focus-visible:outline-1 focus-visible:outline-emerald-400 focus-visible:-outline-offset-1 ${value === tab.id ? "text-white" : "text-zinc-600 hover:text-zinc-300"}`}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </div>
  );
}
