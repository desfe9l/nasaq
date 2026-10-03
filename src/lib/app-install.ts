/**
 * Install NASAQ as a desktop app (PWA).
 *
 * The browser fires `beforeinstallprompt` once the manifest and icons make
 * the app installable; Chrome/Edge then let us trigger the native dialog from
 * our own button. Safari never fires it, so iOS gets the honest path: the
 * share-sheet instructions. Everything here is SSR-safe and side-effect free
 * until `initInstallPrompt()` runs in the browser.
 */

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

/** Subscribe to availability changes; returns the unsubscribe. */
export function onInstallChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** True when a native install dialog can be shown right now. */
export function canInstallApp(): boolean {
  return deferred !== null && !installed;
}

/** Running inside an installed window (no browser chrome). */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)")?.matches ||
    // iOS Safari
    (window.navigator as { standalone?: boolean }).standalone === true
  );
}

/** iOS/iPadOS Safari: installable only through the share sheet. */
export function isIosSafari(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  return ios && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
}

/**
 * Ask the browser to show its install dialog.
 * Returns what happened, so the UI can toast the right follow-up.
 */
export async function promptInstallApp(): Promise<
  "accepted" | "dismissed" | "unavailable"
> {
  if (!deferred) return "unavailable";
  const event = deferred;
  deferred = null;
  emit();
  await event.prompt();
  const choice = await event.userChoice;
  if (choice.outcome === "accepted") installed = true;
  emit();
  return choice.outcome;
}

/**
 * Wire the browser events. Called once from the app shell.
 */
export function initInstallPrompt(): void {
  if (typeof window === "undefined") return;
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferred = event as BeforeInstallPromptEvent;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    installed = true;
    emit();
  });
}

/* -------------------------------------------------------------------------- */
/* First-run offer                                                            */
/* -------------------------------------------------------------------------- */

const SEEN_KEY = "nasaq.install-offer.v1";

/** Has the author already answered the one-time install offer? */
export function installOfferSeen(): boolean {
  try {
    return window.localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return true; // storage blocked: never nag
  }
}

export function markInstallOfferSeen(): void {
  try {
    window.localStorage.setItem(SEEN_KEY, "1");
  } catch {
    /* the offer simply reappears next session */
  }
}
