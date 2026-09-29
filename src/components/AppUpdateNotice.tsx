import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { APP_BUILD_ID } from "@/lib/app-build";
import {
  IDLE_RELOAD_MS,
  IDLE_RESET_EVENTS,
  UPDATE_POLL_MS,
  isStaleBuild,
  withCacheBuster,
} from "@/lib/app-update";

/**
 * Stale-build guard.
 *
 * The editor is client-rendered, so a document kept alive by a tab, the
 * back/forward cache or an installed app window keeps painting an OLD
 * deployment: the toolbar in it was deleted from the repository, yet it is
 * still what the author sees, because the browser never refetches. This
 * component closes that hole for good:
 *
 *   • while the page is visible it asks `/api/app-version` (uncached) which
 *     build the deployment serves, and it asks again the moment the page is
 *     shown or resumed;
 *   • when the answer differs from the build this bundle was baked from, the
 *     author gets an explicit, dismissible update pill;
 *   • a page nobody is interacting with replaces itself after
 *     `IDLE_RELOAD_MS` — no gesture is ever interrupted (every input restarts
 *     the timer), and the reload goes to a build-stamped URL, so neither the
 *     document nor the old immutable chunks can be replayed.
 *
 * Production only: in dev the server restarts constantly by design and HMR
 * already owns reloads.
 */
export function AppUpdateNotice() {
  const [pending, setPending] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const pendingRef = useRef<string | null>(null);
  const lastInputAt = useRef(Date.now());

  useEffect(() => {
    if (!import.meta.env.PROD) return;
    let cancelled = false;
    let timer: number | undefined;

    const apply = (served: unknown) => {
      if (cancelled || !isStaleBuild(APP_BUILD_ID, served)) return;
      const next = String(served);
      pendingRef.current = next;
      setPending(next);
    };

    const check = async () => {
      try {
        const response = await fetch("/api/app-version", { cache: "no-store" });
        if (!response.ok) return;
        const body = (await response.json()) as { buildId?: unknown };
        apply(body?.buildId);
      } catch {
        /* offline or a 404 on an older deployment: not evidence of staleness */
      }
    };

    const onShown = () => {
      if (document.visibilityState === "hidden") return;
      void check();
    };

    const reload = () => {
      const target = pendingRef.current;
      window.location.replace(withCacheBuster(window.location.href, target));
    };

    const tick = () => {
      const idleFor = Date.now() - lastInputAt.current;
      if (pendingRef.current && idleFor >= IDLE_RELOAD_MS) {
        reload();
        return;
      }
      timer = window.setTimeout(tick, 5_000);
    };

    const resetIdle = () => {
      lastInputAt.current = Date.now();
    };

    void check();
    const poll = window.setInterval(() => void check(), UPDATE_POLL_MS);
    window.addEventListener("pageshow", onShown);
    document.addEventListener("visibilitychange", onShown);
    for (const type of IDLE_RESET_EVENTS) {
      window.addEventListener(type, resetIdle, { passive: true });
    }
    timer = window.setTimeout(tick, 5_000);

    return () => {
      cancelled = true;
      window.clearInterval(poll);
      if (timer) window.clearTimeout(timer);
      window.removeEventListener("pageshow", onShown);
      document.removeEventListener("visibilitychange", onShown);
      for (const type of IDLE_RESET_EVENTS) {
        window.removeEventListener(type, resetIdle);
      }
    };
  }, []);

  if (!pending || dismissed) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      dir="rtl"
      className="fixed inset-x-0 top-2 z-[var(--z-toast)] mx-auto flex w-[min(92vw,26rem)] items-center gap-2 rounded-[10px] border border-line bg-inverse px-3 py-2 text-on-inverse shadow-lg"
    >
      <RefreshCw className="size-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1 text-[12px] font-bold leading-5">
        يتوفّر إصدار أحدث من نَسَق — الصفحة المفتوحة تعرض نسخة قديمة.
      </span>
      <button
        type="button"
        className="shrink-0 rounded-[8px] bg-navy px-2.5 py-1 text-[12px] font-extrabold text-on-brand"
        onClick={() => window.location.replace(withCacheBuster(window.location.href, pending))}
      >
        تحديث الآن
      </button>
      <button
        type="button"
        aria-label="إخفاء تنبيه التحديث"
        className="shrink-0 rounded-[8px] px-2 py-1 text-[12px] font-bold text-on-inverse/80"
        onClick={() => setDismissed(true)}
      >
        لاحقًا
      </button>
    </div>
  );
}
