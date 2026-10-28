import { useCallback, useEffect, useState } from "react";

import { safeStorage } from "@/lib/utils";

export type ThemePref = "system" | "light" | "dark";
const KEY = "aether.theme";
const EVENT = "aether:theme";

function systemDark(): boolean {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? true;
}

export function resolveTheme(pref: ThemePref): "light" | "dark" {
  return pref === "system" ? (systemDark() ? "dark" : "light") : pref;
}

function readPref(): ThemePref {
  const v = safeStorage.get(KEY);
  return v === "light" || v === "dark" ? v : "system";
}

/** Theme preference with an explicit toggle that wins over the OS setting in both directions. */
export function useTheme() {
  const [pref, setPrefState] = useState<ThemePref>(readPref);
  const [resolved, setResolved] = useState<"light" | "dark">(() => resolveTheme(readPref()));

  useEffect(() => {
    const update = () => {
      const p = readPref();
      setPrefState(p);
      setResolved(resolveTheme(p));
    };
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    mq?.addEventListener("change", update);
    window.addEventListener(EVENT, update);
    return () => {
      mq?.removeEventListener("change", update);
      window.removeEventListener(EVENT, update);
    };
  }, []);

  const setPref = useCallback((p: ThemePref) => {
    if (p === "system") {
      delete document.documentElement.dataset.theme;
      try {
        window.localStorage.removeItem(KEY);
      } catch {
        /* ignore */
      }
    } else {
      document.documentElement.dataset.theme = p;
      safeStorage.set(KEY, p);
    }
    window.dispatchEvent(new Event(EVENT));
  }, []);

  return { pref, resolved, setPref };
}
