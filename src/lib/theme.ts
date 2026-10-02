/*
 * One persistent appearance preference for the whole site (marketing pages AND
 * the editor). Light, Dim and Dark are explicit user choices; `html.dark`
 * remains the Tailwind dark-variant hook for both Dim and Dark, while
 * `html.dim` applies the middle palette over it.
 */

export type AppearanceMode = "light" | "dim" | "dark";

const THEME_KEY = "nasaq-theme";
const THEME_EVENT = "nasaq:appearance-change";

/** Legacy slots that used to hold a `dark` flag, honoured once for migration. */
const LEGACY_THEME_KEYS = ["nasaq-report-ui-v2", "diwan-report-ui-v2"];

function isAppearance(value: unknown): value is AppearanceMode {
  return value === "light" || value === "dim" || value === "dark";
}

export function readStoredTheme(): AppearanceMode | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(THEME_KEY);
    if (isAppearance(raw)) return raw;
    // Existing two-mode preferences keep their original meaning.
    if (raw === "dark") return "dark";
    if (raw === "light") return "light";
    // A visitor who picked a side in the old UI keeps it.
    for (const legacy of LEGACY_THEME_KEYS) {
      try {
        const parsed = JSON.parse(window.localStorage.getItem(legacy) || "{}");
        if (typeof parsed?.dark === "boolean")
          return parsed.dark ? "dark" : "light";
      } catch {
        /* a corrupt legacy blob is not a preference */
      }
    }
  } catch {
    /* storage blocked — fall through to the default */
  }
  return null;
}

/** Applies the stored choice to `<html>`; no choice defaults to Light. */
export function applyStoredTheme(): void {
  if (typeof document === "undefined") return;
  applyTheme(readStoredTheme() ?? "light");
}

/** Persist the visitor's choice and apply it immediately. */
export function writeStoredTheme(appearance: AppearanceMode): void {
  try {
    window.localStorage.setItem(THEME_KEY, appearance);
  } catch {
    /* a blocked store still flips the live page */
  }
  // Apply the requested choice even when private-mode storage is blocked.
  applyTheme(appearance);
}

// Applied once at module load — the root route imports this module, so every
// page (and a fresh load of any page) starts on the visitor's stored theme
// before its route component renders.
applyStoredTheme();

function applyTheme(appearance: AppearanceMode): void {
  const root = document.documentElement;
  const darkVariant = appearance !== "light";
  root.classList.toggle("dark", darkVariant);
  root.classList.toggle("dim", appearance === "dim");
  syncThemeColor(appearance);
  window.dispatchEvent(
    new CustomEvent<AppearanceMode>(THEME_EVENT, { detail: appearance }),
  );
}

/**
 * The browser's own chrome (URL bar, Android status bar) is painted outside our
 * stylesheet, so it cannot follow a CSS variable: it reads `<meta name="theme-
 * color">`. Keep it in step with all three palettes.
 */
function syncThemeColor(appearance: AppearanceMode): void {
  const meta = document?.querySelector?.('meta[name="theme-color"]');
  const color =
    appearance === "dark"
      ? "#0b1220"
      : appearance === "dim"
        ? "#20262c"
        : "#f4f0e8";
  if (meta) meta.setAttribute("content", color);
}

/** Same-tab settings and cross-tab preference changes share one notification. */
export function subscribeTheme(
  onChange: (appearance: AppearanceMode) => void,
): () => void {
  const onTheme = (event: Event) =>
    onChange((event as CustomEvent<AppearanceMode>).detail);
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
