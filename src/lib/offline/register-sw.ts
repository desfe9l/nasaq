/**
 * Register the NASAQ app shell service worker so the app can launch offline.
 * Called once at boot from __root. No-ops on server, on unsupported browsers,
 * or when the worker is already controlling.
 */

export function registerOfflineSW(): void {
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator)) return;
  // Avoid registering in environments where origin is not http(s) (e.g., tests, file:)
  const { protocol } = window.location;
  if (protocol !== "http:" && protocol !== "https:") return;

  const onReady = () => {
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).then(
      (reg) => {
        // Check for updates hourly when online
        setInterval(() => {
          if (navigator.onLine) reg.update().catch(() => undefined);
        }, 60 * 60 * 1000);

        // If a new worker is waiting, prompt via app-update
        if (reg.waiting) {
          window.dispatchEvent(new CustomEvent("nasaq:sw-waiting"));
        }
        reg.addEventListener("updatefound", () => {
          const nw = reg.installing;
          if (!nw) return;
          nw.addEventListener("statechange", () => {
            if (nw.state === "installed" && navigator.serviceWorker.controller) {
              window.dispatchEvent(new CustomEvent("nasaq:sw-waiting"));
            }
          });
        });
      },
      (err) => {
        console.warn("[offline] SW registration failed", err);
      },
    );
  };

  if (document.readyState === "complete") onReady();
  else window.addEventListener("load", onReady, { once: true });
}
