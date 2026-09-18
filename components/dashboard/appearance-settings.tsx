"use client";

import {
  Check,
  Palette,
  RotateCcw,
  SlidersHorizontal,
} from "lucide-react";

import {
  AnimatedSelection,
} from "@/components/dashboard/animated-selection";

import {
  APP_THEMES,
  DEFAULT_APPEARANCE,
  DEFAULT_INTERFACE,
  type InterfacePreferences,
} from "@/lib/appearance";

import {
  useAppearance,
} from "@/components/dashboard/appearance-provider";

import {
  SectionHeader,
  Surface,
} from "@/components/dashboard/dashboard-primitives";

type ChoiceKey =
  Exclude<
    keyof InterfacePreferences,
    | "sidebarExpanded"
    | "rememberSidebar"
  >;

function InterfaceChoice<
  K extends ChoiceKey,
>({
  name,
  title,
  description,
  options,
}: {
  name:
    K;

  title:
    string;

  description:
    string;

  options: {
    value:
      InterfacePreferences[K];

    label:
      string;
  }[];
}) {
  const {
    preferences,
    updatePreferences,
    ready,
  } =
    useAppearance();

  return (
    <fieldset
      className="sg-interface-row"
      disabled={
        !ready
      }
    >
      <legend className="sr-only">
        {title}
      </legend>

      <div>
        <p
          className="sg-section-title"
          aria-hidden="true"
        >
          {title}
        </p>

        <p
          id={`interface-${name}-description`}
          className="sg-section-description"
        >
          {description}
        </p>
      </div>

      <AnimatedSelection
        value={
          preferences[
            name
          ] as string
        }
        className="sg-preference-options"
      >
        {options.map(
          (
            option,
          ) => (
            <label
              className="sg-preference-option"
              key={
                option.value as string
              }
            >
              <input
                type="radio"
                name={`interface-${name}`}
                value={
                  option.value as string
                }
                checked={
                  preferences[
                    name
                  ] ===
                  option.value
                }
                aria-describedby={`interface-${name}-description`}
                onChange={() =>
                  updatePreferences({
                    [name]:
                      option.value,
                  })
                }
              />

              <span>
                {
                  option.label
                }
              </span>
            </label>
          ),
        )}
      </AnimatedSelection>
    </fieldset>
  );
}

function RememberSidebarSetting() {
  const {
    preferences,
    updatePreferences,
    ready,
  } =
    useAppearance();

  const enabled =
    preferences.rememberSidebar;

  function toggle() {
    if (
      !ready
    ) {
      return;
    }

    /*
     * When remember is enabled,
     * start with the currently selected
     * default sidebar state.
     */
    if (
      !enabled
    ) {
      updatePreferences({
        rememberSidebar:
          true,

        sidebarExpanded:
          preferences.sidebar ===
          "expanded",
      });

      return;
    }

    updatePreferences({
      rememberSidebar:
        false,
    });
  }

  return (
    <div className="sg-interface-row">
      <div>
        <p className="sg-section-title">
          Remember sidebar state
        </p>

        <p className="sg-section-description">
          Restore the last sidebar state when you return to SentinelGrid.
        </p>
      </div>

      <button
        type="button"
        role="switch"
        aria-checked={
          enabled
        }
        disabled={
          !ready
        }
        onClick={
          toggle
        }
        className="
          relative
          inline-flex
          h-6
          w-11
          shrink-0
          items-center
          rounded-full
          border
          border-surface-edge
          bg-surface-raised
          transition-colors
          duration-200
          disabled:opacity-50
        "
        style={
          enabled
            ? {
                background:
                  "color-mix(in srgb, var(--sg-accent) 22%, var(--sg-raised))",

                borderColor:
                  "var(--sg-accent-edge)",
              }
            : undefined
        }
      >
        <span
          aria-hidden="true"
          className="
            block
            h-4
            w-4
            rounded-full
            bg-zinc-300
            shadow-sm
            transition-transform
            duration-200
          "
          style={{
            transform:
              enabled
                ? "translateX(23px)"
                : "translateX(3px)",

            background:
              enabled
                ? "var(--sg-accent-text)"
                : undefined,
          }}
        />
      </button>
    </div>
  );
}

function PreferenceGroupTitle({
  title,
}: {
  title:
    string;
}) {
  return (
    <div
      className="
        border-b
        border-surface-edge
        bg-black/[0.04]
        px-5
        py-3
      "
    >
      <p
        className="
          text-[10px]
          font-semibold
          uppercase
          tracking-[0.14em]
          text-surface-muted
        "
      >
        {title}
      </p>
    </div>
  );
}

export default function AppearanceSettings() {
  const {
    theme,
    chooseTheme,
    preferences,
    updatePreferences,
    ready,
    notice,
  } =
    useAppearance();

  function resetInterface() {
    updatePreferences({
      ...DEFAULT_INTERFACE,
    });
  }

  return (
    <div className="space-y-5">

      {/* =====================================================
          THEME
      ===================================================== */}

      <Surface>
        <SectionHeader
          title="Appearance"
          description="Choose your workspace palette."
          icon={
            <Palette size={17} />
          }
        />

        <div className="sg-panel-body">
          <fieldset
            disabled={
              !ready
            }
            aria-busy={
              !ready
            }
          >
            <legend className="sr-only">
              Application theme
            </legend>

            <div className="sg-theme-grid">
              {APP_THEMES.map(
                (
                  option,
                ) => (
                  <label
                    key={
                      option.id
                    }
                    className="sg-theme-option"
                  >
                    <input
                      type="radio"
                      name="appearance-theme"
                      value={
                        option.id
                      }
                      checked={
                        ready &&
                        theme ===
                          option.id
                      }
                      onChange={() =>
                        chooseTheme(
                          option.id,
                        )
                      }
                      aria-describedby={`theme-${option.id}-description`}
                    />

                    <span className="sg-theme-card">
                      <span
                        className="sg-theme-preview"
                        data-sg-preview={
                          option.id
                        }
                        aria-hidden="true"
                      >
                        <span className="sg-theme-preview-sidebar">
                          <span />
                          <i />
                          <i />
                          <i />
                        </span>

                        <span className="sg-theme-preview-workspace">
                          <span className="sg-theme-preview-topbar">
                            <i />
                            <b />
                          </span>

                          <span className="sg-theme-preview-heading" />

                          <span className="sg-theme-preview-stats">
                            <i />
                            <i />
                            <i />
                          </span>

                          <span className="sg-theme-preview-chart">
                            <svg
                              viewBox="0 0 240 60"
                              fill="none"
                              preserveAspectRatio="none"
                            >
                              <path
                                d="M0 48L22 43L44 48L66 29L88 35L110 19L132 30L154 12L176 22L198 10L220 15L240 3"
                                stroke="currentColor"
                                strokeWidth="2.5"
                                strokeLinejoin="round"
                              />
                            </svg>
                          </span>
                        </span>
                      </span>

                      <span className="sg-theme-card-body">
                        <span className="flex items-center justify-between gap-3">
                          <span className="sg-section-title">
                            {
                              option.name
                            }
                          </span>

                          <span
                            className="sg-theme-check"
                            aria-hidden="true"
                          >
                            <Check
                              size={13}
                            />
                          </span>
                        </span>

                        <span className="sg-theme-label">
                          {
                            option.label
                          }
                        </span>

                        <span
                          id={`theme-${option.id}-description`}
                          className="sg-section-description block"
                        >
                          {
                            option.description
                          }
                        </span>
                      </span>
                    </span>
                  </label>
                ),
              )}
            </div>
          </fieldset>

          <div className="mt-4 flex justify-end">
            <button
              type="button"
              disabled={
                !ready
              }
              className="sg-button sg-button-ghost sg-button-sm"
              onClick={() =>
                chooseTheme(
                  DEFAULT_APPEARANCE,
                )
              }
            >
              <RotateCcw
                size={14}
                aria-hidden="true"
              />

              Reset theme
            </button>
          </div>
        </div>
      </Surface>

      {/* =====================================================
          INTERFACE
      ===================================================== */}

      <Surface>
        <SectionHeader
          title="Interface"
          description="Customize how SentinelGrid is presented in this browser."
          icon={
            <SlidersHorizontal
              size={17}
            />
          }
          actions={
            <button
              type="button"
              disabled={
                !ready
              }
              onClick={
                resetInterface
              }
              className="sg-button sg-button-ghost sg-button-sm"
            >
              <RotateCcw
                size={13}
              />

              Reset
            </button>
          }
        />

        <PreferenceGroupTitle
          title="Appearance"
        />

        <InterfaceChoice
          name="presentation"
          title="Panel style"
          description="Choose how panels and inventories are visually separated."
          options={[
            {
              value:
                "bubbles",
              label:
                "Cards",
            },
            {
              value:
                "minimal",
              label:
                "Minimal",
            },
          ]}
        />

        <InterfaceChoice
          name="density"
          title="Density"
          description="Control spacing across rows, panels and controls."
          options={[
            {
              value:
                "comfortable",
              label:
                "Comfortable",
            },
            {
              value:
                "compact",
              label:
                "Compact",
            },
          ]}
        />

        <InterfaceChoice
          name="motion"
          title="Motion"
          description="Control interface animations and transitions."
          options={[
            {
              value:
                "system",
              label:
                "System",
            },
            {
              value:
                "full",
              label:
                "Standard",
            },
            {
              value:
                "reduced",
              label:
                "Reduced",
            },
          ]}
        />

        <PreferenceGroupTitle
          title="Navigation"
        />

        <InterfaceChoice
          name="sidebar"
          title="Sidebar default"
          description="Choose the default desktop navigation state."
          options={[
            {
              value:
                "expanded",
              label:
                "Expanded",
            },
            {
              value:
                "compact",
              label:
                "Compact",
            },
          ]}
        />

        <RememberSidebarSetting />

        <InterfaceChoice
          name="defaultView"
          title="Client layout"
          description="Default layout used when opening client lists."
          options={[
            {
              value:
                "list",
              label:
                "List",
            },
            {
              value:
                "grid",
              label:
                "Grid",
            },
          ]}
        />
      </Surface>

      <div
        aria-live="polite"
        aria-atomic="true"
        className="min-h-5"
      >
        {notice && (
          <p
            role={
              notice.error
                ? "alert"
                : "status"
            }
            className={
              notice.error
                ? "text-xs text-amber-300"
                : "sg-meta"
            }
          >
            {
              notice.message
            }
          </p>
        )}
      </div>
    </div>
  );
}