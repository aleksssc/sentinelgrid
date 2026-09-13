"use client";

import { AnimatedSelection } from "@/components/dashboard/animated-selection";
import { Check, Monitor, Palette, RotateCcw, SlidersHorizontal } from "lucide-react";
import { APP_THEMES, DEFAULT_APPEARANCE, type InterfacePreferences } from "@/lib/appearance";
import { useAppearance } from "@/components/dashboard/appearance-provider";
import { SectionHeader, Surface } from "@/components/dashboard/dashboard-primitives";

type ChoiceKey = Exclude<keyof InterfacePreferences, "sidebarExpanded">;

function InterfaceChoice<K extends ChoiceKey>({ name, title, description, options }: {
  name: K;
  title: string;
  description: string;
  options: { value: InterfacePreferences[K]; label: string }[];
}) {
  const { preferences, updatePreferences, ready } = useAppearance();
  return (
    <fieldset className="sg-interface-row" disabled={!ready}>
      <legend className="sr-only">{title}</legend>
      <div><p className="sg-section-title" aria-hidden="true">{title}</p><p id={`interface-${name}-description`} className="sg-section-description">{description}</p></div>
      <AnimatedSelection value={preferences[name]} className="sg-preference-options">
        {options.map((option) => <label className="sg-preference-option" key={option.value}>
          <input type="radio" name={`interface-${name}`} value={option.value} checked={preferences[name] === option.value}
            aria-describedby={`interface-${name}-description`} onChange={() => updatePreferences({ [name]: option.value })} />
          <span>{option.label}</span>
        </label>)}
      </AnimatedSelection>
    </fieldset>
  );
}

export default function AppearanceSettings() {
  const { theme, chooseTheme, ready, notice } = useAppearance();
  return (
    <div className="space-y-5">
      <Surface>
        <SectionHeader title="Appearance" description="Choose your workspace palette." icon={<Palette size={17} />} />
        <div className="sg-panel-body">
          <fieldset disabled={!ready} aria-busy={!ready}>
            <legend className="sr-only">Application theme</legend>
            <div className="sg-theme-grid">
              {APP_THEMES.map((option) => (
                <label key={option.id} className="sg-theme-option">
                  <input type="radio" name="appearance-theme" value={option.id} checked={ready && theme === option.id}
                    onChange={() => chooseTheme(option.id)} aria-describedby={`theme-${option.id}-description`} />
                  <span className="sg-theme-card">
                    <span className="sg-theme-preview" data-sg-preview={option.id} aria-hidden="true">
                      <span className="sg-theme-preview-sidebar"><span /><i /><i /><i /></span>
                      <span className="sg-theme-preview-workspace">
                        <span className="sg-theme-preview-topbar"><i /><b /></span>
                        <span className="sg-theme-preview-heading" />
                        <span className="sg-theme-preview-stats"><i /><i /><i /></span>
                        <span className="sg-theme-preview-chart">
                          <svg viewBox="0 0 240 60" fill="none" preserveAspectRatio="none">
                            <path d="M0 48L22 43L44 48L66 29L88 35L110 19L132 30L154 12L176 22L198 10L220 15L240 3" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />
                          </svg>
                        </span>
                      </span>
                    </span>
                    <span className="sg-theme-card-body">
                      <span className="flex items-center justify-between gap-3">
                        <span className="sg-section-title">{option.name}</span>
                        <span className="sg-theme-check" aria-hidden="true"><Check size={13} /></span>
                      </span>
                      <span className="sg-theme-label">{option.label}</span>
                      <span id={`theme-${option.id}-description`} className="sg-section-description block">{option.description}</span>
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="sg-meta flex items-center gap-2"><Monitor size={15} aria-hidden="true" /> Personal to this browser.</p>
            <button type="button" disabled={!ready} className="sg-button sg-button-ghost sg-button-sm" onClick={() => chooseTheme(DEFAULT_APPEARANCE)}>
              <RotateCcw size={14} aria-hidden="true" /> Reset to Sentinel
            </button>
          </div>
        </div>
      </Surface>
      <Surface>
        <SectionHeader title="Interface" icon={<SlidersHorizontal size={17} />} />
        <InterfaceChoice name="density" title="Interface density" description="Spacing in rows, panels and controls." options={[{ value: "comfortable", label: "Comfortable" }, { value: "compact", label: "Compact" }]} />
        <InterfaceChoice name="motion" title="Motion" description="System follows your device's reduced-motion preference." options={[{ value: "system", label: "System" }, { value: "full", label: "Full" }, { value: "reduced", label: "Reduced" }]} />
        <InterfaceChoice name="sidebar" title="Sidebar behavior" description="Desktop navigation. On smaller screens, use the menu button." options={[{ value: "expanded", label: "Expanded" }, { value: "compact", label: "Compact" }, { value: "remember", label: "Remember last state" }]} />
        <InterfaceChoice name="defaultView" title="Default client view" description="Starting view for client lists. You can switch within each list." options={[{ value: "list", label: "List" }, { value: "grid", label: "Grid" }]} />
      </Surface>
      <div aria-live="polite" aria-atomic="true" className="min-h-5">
        {notice && <p role={notice.error ? "alert" : "status"} className={notice.error ? "text-xs text-amber-300" : "sg-meta"}>{notice.message}</p>}
      </div>
    </div>
  );
}
