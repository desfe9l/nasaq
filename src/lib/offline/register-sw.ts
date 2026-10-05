/**
 * Register the NASAQ app shell service worker so the app can launch offline.
 * Called once at boot from __root. No-ops on server, on unsupported browsers,
 * or when the worker is already controlling. Never registers a second worker.
 */

const SHELL_CACHE = "nasaq-shell-v3-shell";
const RUNTIME_CACHE = "nasaq-shell-v3-runtime";

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
        void warmAppShell(["/", "/workspace", "/projects", "/templates", "/editor"]);
      },
      (err) => {
        console.warn("[offline] SW registration failed", err);
      },
    );
  };

  if (document.readyState === "complete") onReady();
  else window.addEventListener("load", onReady, { once: true });
}

/**
 * Put the app shell and the scripts/styles it references into the same caches
 * the service worker reads. Safe to call before the worker controls the page:
 * `caches` is shared with `/sw.js`.
 */
export async function warmAppShell(paths: string[]): Promise<void> {
  if (typeof window === "undefined" || typeof fetch === "undefined") return;
  if (typeof caches === "undefined") return;
  const origin = window.location.origin;
  const seen = new Set<string>();
  const queue = paths.map((path) => {
    try {
      return new URL(path, origin).href;
    } catch {
      return "";
    }
  }).filter(Boolean);

  const shell = await caches.open(SHELL_CACHE);
  const runtime = await caches.open(RUNTIME_CACHE);

  while (queue.length && seen.size < 80) {
    const url = queue.shift();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      continue;
    }
    if (parsed.origin !== origin) continue;
    try {
      const res = await fetch(url, { credentials: "same-origin", cache: "reload" });
      if (!res.ok) continue;
      const type = res.headers.get("content-type") || "";
      const copy = res.clone();
      if (type.includes("text/html")) {
        await shell.put(url, copy).catch(() => undefined);
        const html = await res.text();
        const refs = html.matchAll(/(?:src|href)=["']([^"']+)["']/g);
        for (const match of refs) {
          const ref = match[1];
          if (!ref || ref.startsWith("data:") || ref.startsWith("#")) continue;
          let abs: string;
          try {
            abs = new URL(ref, origin).href;
          } catch {
            continue;
          }
          if (!abs.startsWith(origin)) continue;
          if (/\.(?:js|css|woff2?)(?:$|\?)/.test(abs) || abs.includes("/assets/")) {
            if (!seen.has(abs)) queue.push(abs);
          }
        }
      } else if (
        type.includes("javascript") ||
        type.includes("css") ||
        type.includes("font") ||
        /\.(?:js|css|woff2?)(?:$|\?)/.test(parsed.pathname)
      ) {
        await runtime.put(url, copy).catch(() => undefined);
      }
    } catch {
      /* A failed warm must not undo a prepared document. */
    }
  }
}