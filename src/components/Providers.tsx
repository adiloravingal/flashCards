"use client";

import { usePathname } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { api } from "@/lib/client";
import { DEFAULT_SETTINGS, type Settings } from "@/lib/settings-shared";
import { CommandPalette } from "./CommandPalette";
import { QuickAdd } from "./QuickAdd";
import { Sidebar } from "./Sidebar";
import { ToastProvider } from "./ui";

/* ==========================================================================
 * Settings context
 *
 * Settings live in SQLite (so they survive a browser reset) but are mirrored
 * into localStorage for theme/motion, which must apply before React mounts.
 * ========================================================================== */

interface SettingsCtx {
  settings: Settings;
  update: (patch: Partial<Settings>) => Promise<void>;
  loaded: boolean;
}

const Ctx = createContext<SettingsCtx>({
  settings: DEFAULT_SETTINGS as Settings,
  update: async () => {},
  loaded: false,
});

export const useSettings = () => useContext(Ctx);

function applyTheme(theme: Settings["theme"], reduceMotion: boolean) {
  const root = document.documentElement;
  const dark =
    theme === "dark" ||
    (theme === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  root.classList.toggle("dark", dark);
  root.classList.toggle("reduce-motion", reduceMotion);
  try {
    localStorage.setItem("fc-theme", theme);
    localStorage.setItem("fc-reduce-motion", String(reduceMotion));
  } catch {
    /* private browsing — the DB copy is still authoritative */
  }
}

function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS as Settings);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const s = await api<Settings>("/settings");
        setSettings(s);
        applyTheme(s.theme, s.reduceMotion);
      } catch {
        /* keep defaults — the app must still open if the API hiccups */
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  // Follow the OS when the user has chosen "system".
  useEffect(() => {
    if (settings.theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system", settings.reduceMotion);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [settings.theme, settings.reduceMotion]);

  const update = useCallback(
    async (patch: Partial<Settings>) => {
      // Optimistic: the UI should never wait on a local round trip.
      setSettings((prev) => {
        const next = { ...prev, ...patch };
        applyTheme(next.theme, next.reduceMotion);
        return next;
      });
      try {
        await api<Settings>("/settings", { method: "PATCH", json: patch });
      } catch {
        /* the optimistic value stays; next load re-syncs */
      }
    },
    [],
  );

  return (
    <Ctx.Provider value={{ settings, update, loaded }}>{children}</Ctx.Provider>
  );
}

/* ==========================================================================
 * Shell
 * ========================================================================== */

function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  // The review screen takes over the whole window: no sidebar, no chrome,
  // nothing to look at except the card in front of you.
  const immersive = pathname.startsWith("/review");

  if (immersive) return <>{children}</>;

  return (
    <div className="flex min-h-dvh">
      <Sidebar />
      <main className="grow min-w-0 flex flex-col">
        {/* Bottom padding clears the fixed mobile bar. It belongs here, on the
            content column, rather than on a spacer next to it — the shell is a
            flex *row*, so a sibling spacer becomes a column and adds no height
            at all, leaving the last row of any long list under the bar. */}
        <div className="w-full max-w-5xl mx-auto px-5 sm:px-8 pt-8 sm:pt-10 pb-[calc(var(--bottom-nav-h)+1.5rem)] md:pb-10 grow">
          {children}
        </div>
      </main>
    </div>
  );
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <SettingsProvider>
        <Shell>{children}</Shell>
        <CommandPalette />
        <QuickAdd />
      </SettingsProvider>
    </ToastProvider>
  );
}
