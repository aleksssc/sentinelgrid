"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  ThemeProvider,
  useTheme,
} from "next-themes";

import {
  APP_THEMES,
  APPEARANCE_STORAGE_KEY,
  DEFAULT_APPEARANCE,
  DEFAULT_INTERFACE,
  INTERFACE_STORAGE_KEY,
  LEGACY_VIEW_STORAGE_KEY,
  isAppTheme,
  parseInterfacePreferences,
  persistAppearance,
  persistInterfacePreferences,
  type AppTheme,
  type InterfacePreferences,
} from "@/lib/appearance";

type AppearanceContextValue = {
  theme:
    AppTheme;

  preferences:
    InterfacePreferences;

  ready:
    boolean;

  notice: {
    message:
      string;

    error:
      boolean;
  } | null;

  chooseTheme:
    (
      theme:
        AppTheme,
    ) => void;

  updatePreferences:
    (
      patch:
        Partial<
          InterfacePreferences
        >,
    ) => void;

  toggleSidebar:
    () => void;
};

const AppearanceContext =
  createContext<
    AppearanceContextValue | null
  >(
    null,
  );

export function useAppearance() {
  const context =
    useContext(
      AppearanceContext,
    );

  if (
    !context
  ) {
    throw new Error(
      "useAppearance requires AppearanceProvider",
    );
  }

  return context;
}

function InterfaceProvider({
  children,
}: {
  children:
    ReactNode;
}) {
  const {
    theme,
    setTheme,
  } =
    useTheme();

  const [
    preferences,
    setPreferences,
  ] =
    useState(
      DEFAULT_INTERFACE,
    );

  const current =
    useRef(
      preferences,
    );

  const [
    ready,
    setReady,
  ] =
    useState(
      false,
    );

  const [
    notice,
    setNotice,
  ] =
    useState<
      AppearanceContextValue["notice"]
    >(
      null,
    );

  useEffect(
    () => {
      const root =
        document.documentElement;

      const pointer =
        () => {
          root.dataset.sgInputModality =
            "pointer";
        };

      const keyboard =
        (
          event:
            KeyboardEvent,
        ) => {
          if (
            [
              "Shift",
              "Control",
              "Alt",
              "Meta",
            ].includes(
              event.key,
            )
          ) {
            return;
          }

          root.dataset.sgInputModality =
            "keyboard";
        };

      document.addEventListener(
        "pointerdown",
        pointer,
        true,
      );

      document.addEventListener(
        "keydown",
        keyboard,
        true,
      );

      return () => {
        document.removeEventListener(
          "pointerdown",
          pointer,
          true,
        );

        document.removeEventListener(
          "keydown",
          keyboard,
          true,
        );

        delete root.dataset
          .sgInputModality;
      };
    },
    [],
  );

  useEffect(
    () => {
      function restore() {
        try {
          const next =
            parseInterfacePreferences(
              window.localStorage.getItem(
                INTERFACE_STORAGE_KEY,
              ),

              window.localStorage.getItem(
                LEGACY_VIEW_STORAGE_KEY,
              ),
            );

          current.current =
            next;

          setPreferences(
            next,
          );
        } catch (
          error
        ) {
          console.warn(
            "Interface preferences could not be restored:",
            error,
          );

          setNotice({
            message:
              "This browser could not restore your preferences. Changes will still apply to this session.",

            error:
              true,
          });
        }

        setReady(
          true,
        );
      }

      restore();

      function sync(
        event:
          StorageEvent,
      ) {
        if (
          event.storageArea ===
            window.localStorage &&
          (
            event.key ===
              INTERFACE_STORAGE_KEY ||
            event.key ===
              null
          )
        ) {
          restore();
        }
      }

      window.addEventListener(
        "storage",
        sync,
      );

      return () =>
        window.removeEventListener(
          "storage",
          sync,
        );
    },
    [],
  );

  useEffect(
    () => {
      const root =
        document.documentElement;

      const media =
        window.matchMedia(
          "(prefers-reduced-motion: reduce)",
        );

      function apply() {
        root.dataset.sgDensity =
          preferences.density;

        root.dataset.sgPresentation =
          preferences.presentation;

        root.dataset.sgMotion =
          preferences.motion ===
          "system"
            ? media.matches
              ? "reduced"
              : "full"
            : preferences.motion;

        const expanded =
          preferences.rememberSidebar
            ? preferences.sidebarExpanded
            : preferences.sidebar ===
              "expanded";

        root.dataset.sgSidebar =
          expanded
            ? "expanded"
            : "compact";
      }

      apply();

      media.addEventListener(
        "change",
        apply,
      );

      return () =>
        media.removeEventListener(
          "change",
          apply,
        );
    },
    [
      preferences,
    ],
  );

  const updatePreferences =
    useCallback(
      (
        patch:
          Partial<
            InterfacePreferences
          >,
      ) => {
        const next = {
          ...current.current,
          ...patch,
        };

        /*
         * If remember mode is disabled,
         * the selected default state is also
         * the current sidebar state.
         */
        if (
          patch.sidebar &&
          !next.rememberSidebar
        ) {
          next.sidebarExpanded =
            patch.sidebar ===
            "expanded";
        }

        current.current =
          next;

        setPreferences(
          next,
        );

        try {
          persistInterfacePreferences(
            window.localStorage,
            next,
          );

          setNotice({
            message:
              "Preferences saved in this browser.",

            error:
              false,
          });
        } catch (
          error
        ) {
          console.warn(
            "Interface preferences could not be saved:",
            error,
          );

          setNotice({
            message:
              "Preferences applied for this session, but this browser could not save them.",

            error:
              true,
          });
        }
      },
      [],
    );

  function chooseTheme(
    next:
      AppTheme,
  ) {
    setTheme(
      next,
    );

    try {
      persistAppearance(
        window.localStorage,
        next,
      );

      setNotice({
        message:
          "Appearance saved in this browser.",

        error:
          false,
      });
    } catch (
      error
    ) {
      console.warn(
        "Appearance could not be saved:",
        error,
      );

      setNotice({
        message:
          "Theme applied for this session, but this browser could not save it.",

        error:
          true,
      });
    }
  }

  function toggleSidebar() {
    const saved =
      current.current;

    if (
      saved.rememberSidebar
    ) {
      updatePreferences({
        sidebarExpanded:
          !saved.sidebarExpanded,
      });

      return;
    }

    updatePreferences({
      sidebar:
        saved.sidebar ===
        "expanded"
          ? "compact"
          : "expanded",
    });
  }

  return (
    <AppearanceContext.Provider
      value={{
        theme:
          isAppTheme(
            theme,
          )
            ? theme
            : DEFAULT_APPEARANCE,

        preferences,
        ready,
        notice,
        chooseTheme,
        updatePreferences,
        toggleSidebar,
      }}
    >
      {children}
    </AppearanceContext.Provider>
  );
}

export function AppearanceProvider({
  children,
}: {
  children:
    ReactNode;
}) {
  return (
    <ThemeProvider
      attribute="data-sg-theme"
      storageKey={
        APPEARANCE_STORAGE_KEY
      }
      themes={APP_THEMES.map(
        (
          theme,
        ) =>
          theme.id,
      )}
      defaultTheme={
        DEFAULT_APPEARANCE
      }
      enableSystem={
        false
      }
      enableColorScheme={
        false
      }
      disableTransitionOnChange
    >
      <InterfaceProvider>
        {children}
      </InterfaceProvider>
    </ThemeProvider>
  );
}