export const APPEARANCE_STORAGE_KEY = "sentinelgrid-appearance";
export const INTERFACE_STORAGE_KEY = "sentinelgrid-interface";
export const LEGACY_VIEW_STORAGE_KEY = "sentinelgrid-organization-clients-view";
export const DEFAULT_APPEARANCE = "sentinel";

export const APP_THEMES = [
  { id: "sentinel", name: "Sentinel", label: "The original", description: "Deep charcoal, blue navigation accents and the signature cyber grid." },
  { id: "midnight", name: "Midnight", label: "After hours", description: "Inky navy surfaces with crisp cyan light. Cool and focused." },
  { id: "aurora", name: "Aurora", label: "A little cosmic", description: "Obsidian violet, softer corners and a luminous purple atmosphere." },
  { id: "graphite", name: "Graphite", label: "Less noise", description: "Neutral carbon, silver accents and sharper edges. No moving background." },
] as const;

export type AppTheme = (typeof APP_THEMES)[number]["id"];
export type InterfacePreferences = {
  density: "comfortable" | "compact";
  presentation: "bubbles" | "minimal";
  motion: "system" | "full" | "reduced";
  sidebar: "expanded" | "compact" | "remember";
  defaultView: "list" | "grid";
  sidebarExpanded: boolean;
};

export const DEFAULT_INTERFACE: InterfacePreferences = {
  density: "comfortable", presentation: "bubbles", motion: "system", sidebar: "expanded", defaultView: "list", sidebarExpanded: true,
};

export function isAppTheme(value: unknown): value is AppTheme {
  return APP_THEMES.some((theme) => theme.id === value);
}

export function parseInterfacePreferences(raw: string | null, legacyView: string | null = null): InterfacePreferences {
  const defaults = { ...DEFAULT_INTERFACE, defaultView: legacyView === "grid" ? "grid" as const : "list" as const };
  if (raw === null) return defaults;
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid interface preferences");
  const saved = value as Record<string, unknown>;
  return {
    density: saved.density === "compact" ? "compact" : defaults.density,
    presentation: saved.presentation === "minimal" ? "minimal" : defaults.presentation,
    motion: saved.motion === "full" || saved.motion === "reduced" ? saved.motion : defaults.motion,
    sidebar: saved.sidebar === "compact" || saved.sidebar === "remember" ? saved.sidebar : defaults.sidebar,
    defaultView: saved.defaultView === "list" || saved.defaultView === "grid" ? saved.defaultView : defaults.defaultView,
    sidebarExpanded: typeof saved.sidebarExpanded === "boolean" ? saved.sidebarExpanded : defaults.sidebarExpanded,
  };
}

export function persistAppearance(storage: Pick<Storage, "setItem">, theme: AppTheme) {
  // next-themes hides blocked-storage errors; the provider reports them explicitly.
  storage.setItem(APPEARANCE_STORAGE_KEY, theme);
}

export function persistInterfacePreferences(storage: Pick<Storage, "setItem">, preferences: InterfacePreferences) {
  storage.setItem(INTERFACE_STORAGE_KEY, JSON.stringify(preferences));
}
