"use client";

import { AnimatedSelection } from "@/components/dashboard/animated-selection";

type Props<T extends string> = {
  tabs: ReadonlyArray<{ id: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
};

export default function DeviceTabs<T extends string>({ tabs, value, onChange }: Props<T>) {
  return (
    <AnimatedSelection value={value} role="group" aria-label="Device sections" className="sg-tabs mt-5">
      {tabs.map((tab) => (
        <button key={tab.id} type="button" aria-pressed={value === tab.id} onClick={() => onChange(tab.id)} className="sg-tab">
          {tab.label}
        </button>
      ))}
    </AnimatedSelection>
  );
}
