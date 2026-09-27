/*
 * One theme preference for the whole site (marketing pages AND the editor).
 *
 * The previous behaviour keyed the mode off whichever page happened to run:
 * the editor store's `hydrate()` forced dark-on-default and only pages that
 * called it applied any theme at all, so the homepage opened dark while other
 * pages stayed light. The class on `<html>` is now driven solely by this
 * stored visitor choice — no page forces a mode on its own. With no stored
 * choice the site keeps its base (light) appearance everywhere.
 */

const THEME_KEY = "nasaq-theme";
const THEME_EVENT = "nasaq:appearance-change";

/** Legacy slots that used to hold a `dark` flag, honoured once for migration. */
const LEGACY_THEME_KEYS = ["nasaq-report-ui-v2", "diwan-report-ui-v2"];

export function readStoredTheme(): boolean | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(THEME_KEY);
    if (raw === "dark") return true;
    if (raw === "light") return false;
    // A visitor who picked a side in the old UI keeps it.
    for (const legacy of LEGACY_THEME_KEYS) {
      try {
        const parsed = JSON.parse(window.localStorage.getItem(legacy) || "{}");
        if (typeof parsed?.dark === "boolean") return parsed.dark;
      } catch {
        /* a corrupt legacy blob is not a preference */
      }
    }
  } catch {
    /* storage blocked — fall through to the default */
  }
  return null;
}

/** Applies the stored choice to `<html>`; `null` (no choice) leaves light. */
export function applyStoredTheme(): void {
  if (typeof document === "undefined") return;
  applyTheme(readStoredTheme() === true);
}

/** Persist the visitor's choice and apply it immediately. */
export function writeStoredTheme(dark: boolean): void {
  try {
    window.localStorage.setItem(THEME_KEY, dark ? "dark" : "light");
  } catch {
    /* a blocked store still flips the live page */
  }
  // Apply the requested choice even when private-mode storage is blocked.
  applyTheme(dark);
}

// Applied once at module load — the root route imports this module, so every
// page (and a fresh load of any page) starts on the visitor's stored theme
// before its route component renders.
applyStoredTheme();

function applyTheme(dark: boolean): void {
  document.documentElement.classList.toggle("dark", dark);
  syncThemeColor(dark);
  window.dispatchEvent(new CustomEvent<boolean>(THEME_EVENT, { detail: dark }));
}

/**
 * The browser's own chrome (URL bar, Android status bar) is painted outside our
 * stylesheet, so it cannot follow a CSS variable: it reads `<meta name="theme-
 * color">`. Left fixed, a Dark-mode visitor got a light green bar above a dark
 * page — the same class of bug as a hard-coded text colour, in the one place
 * that is not a Tailwind class. Kept here, next to the class toggle, so the two
 * can never disagree, whatever page applies the stored choice.
 */
function syncThemeColor(dark: boolean): void {
  // Tolerate a document that has no such tag (or no querySelector at all): the
  // tag is set in the route head, and a missing one must never break a toggle.
  const meta = document?.querySelector?.('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", dark ? "#0f141c" : "#006c35");
}

/** Same-tab settings and cross-tab preference changes share one notification. */
export function subscribeTheme(onChange: (dark: boolean) => void): () => void {
  const onTheme = (event: Event) =>
    onChange((event as CustomEvent<boolean>).detail);
  const onStorage = (event: StorageEvent) => {
    if (event.key === THEME_KEY || event.key === null) applyStoredTheme();
  };
  window.addEventListener(THEME_EVENT, onTheme);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(THEME_EVENT, onTheme);
    window.removeEventListener("storage", onStorage);
  };
}
