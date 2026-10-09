"use client";
import * as React from "react";
import { Moon, Sun } from "lucide-react";
import { Toaster } from "sonner";
import { cn } from "@/lib/utils";
import { THEME_STORAGE_KEY as STORAGE_KEY } from "@/lib/theme-script";

export type Theme = "light" | "dark";
const EVENT = "chess254-theme-change";

function readTheme(): Theme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function subscribe(onChange: () => void) {
  // A change made in another tab arrives as a storage event; mirror it here.
  const onStorage = (e: StorageEvent) => {
    if (e.key !== STORAGE_KEY) return;
    const light = e.newValue !== "dark";
    document.documentElement.classList.toggle("light", light);
    document.documentElement.classList.toggle("dark", !light);
    onChange();
  };
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.classList.add("theme-transition");
  root.classList.toggle("light", theme === "light");
  root.classList.toggle("dark", theme === "dark");
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Preference just won't persist; the switch still applies to this page.
  }
  window.dispatchEvent(new Event(EVENT));
  window.setTimeout(() => root.classList.remove("theme-transition"), 350);
}

export function useTheme(): Theme {
  return React.useSyncExternalStore(subscribe, readTheme, () => "light");
}

export function ThemeToggle({ className }: { className?: string }) {
  const theme = useTheme();
  const next = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      onClick={() => applyTheme(next)}
      className={cn("relative grid size-10 place-items-center overflow-hidden rounded-full text-muted transition hover:bg-foreground/[0.07] hover:text-foreground", className)}
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
    >
      <Sun className={cn("absolute size-[18px] transition-all duration-500", theme === "light" ? "rotate-0 scale-100 opacity-100" : "-rotate-90 scale-50 opacity-0")} />
      <Moon className={cn("absolute size-[18px] transition-all duration-500", theme === "dark" ? "rotate-0 scale-100 opacity-100" : "rotate-90 scale-50 opacity-0")} />
    </button>
  );
}

export function ThemedToaster() {
  const theme = useTheme();
  return (
    <Toaster
      theme={theme}
      position="top-center"
      richColors
      closeButton
      toastOptions={{ style: { background: "var(--surface-2)", border: "1px solid var(--border-strong)", color: "var(--foreground)" } }}
    />
  );
}
