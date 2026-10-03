import { useEffect, useRef, useSyncExternalStore } from "react";
import { useBlocker, useRouter } from "@tanstack/react-router";
import {
  LEAVE_BODY,
  LEAVE_CANCEL,
  LEAVE_DISCARD,
  LEAVE_SAVE,
  LEAVE_TITLE,
  hasUnsavedChanges,
} from "@/lib/editor/unsaved-leave";
import {
  blockRouterLeave,
  chooseLeave,
  leavePromptOpen,
  requestLeave,
  subscribeLeavePrompt,
  unloadBypassed,
  unloadShouldPrompt,
} from "@/lib/editor/leave-controller";
import { useEditor } from "@/lib/editor/store";

function RouterLeaveBlocker() {
  useBlocker({
    shouldBlockFn: blockRouterLeave,
    enableBeforeUnload: unloadShouldPrompt,
    withResolver: false,
  });
  return null;
}

/**
 * Arabic confirmation for in-app leave, and the browser's own prompt for
 * refresh and close. Mounted once by the editor shell.
 */
export function LeaveGuard() {
  const open = useSyncExternalStore(subscribeLeavePrompt, leavePromptOpen, () => false);
  const saveState = useEditor((s) => s.saveState);
  const showcase = useEditor((s) => s.showcase);
  const router = useRouter({ warn: false });
  const hasRouter = Boolean(router?.history);
  const backGuardArmedRef = useRef(false);
  const hadPriorHistoryRef = useRef(false);

  useEffect(() => {
    if (showcase || !hasUnsavedChanges(saveState)) return;
    if (backGuardArmedRef.current) return;
    const tsrIndex = (window.history.state as { __TSR_index?: number } | null)?.__TSR_index ?? 0;
    if (tsrIndex > 0) return;
    hadPriorHistoryRef.current = window.history.length > 1;
    try {
      const pushState =
        window.History?.prototype?.pushState ?? window.history.pushState;
      pushState.call(
        window.history,
        { ...(window.history.state ?? {}), __nasaqBackGuard: true },
        "",
        window.location.href,
      );
      backGuardArmedRef.current = true;
    } catch {
      /* history push blocked */
    }
  }, [saveState, showcase]);

  useEffect(() => {
    const onPopState = (event: PopStateEvent) => {
      if (!backGuardArmedRef.current) return;
      const poppedState = (
        event.state !== undefined ? event.state : window.history.state
      ) as { __nasaqBackGuard?: boolean } | null;
      if (poppedState?.__nasaqBackGuard) {
        return;
      }
      backGuardArmedRef.current = false;
      event.stopImmediatePropagation();
      if (unloadBypassed()) return;
      const state = useEditor.getState();
      if (state.showcase || !hasUnsavedChanges(state.saveState)) {
        if (hadPriorHistoryRef.current) {
          window.history.back();
        }
        return;
      }
      try {
        const pushState =
          window.History?.prototype?.pushState ?? window.history.pushState;
        pushState.call(
          window.history,
          { ...(window.history.state ?? {}), __nasaqBackGuard: true },
          "",
          window.location.href,
        );
        backGuardArmedRef.current = true;
      } catch {
        /* ignore */
      }
      void requestLeave().then((ok) => {
        if (!ok) return;
        backGuardArmedRef.current = false;
        if (hadPriorHistoryRef.current && window.history.length > 2) {
          window.history.go(-2);
        } else {
          window.location.assign("/home");
        }
      });
    };
    window.addEventListener("popstate", onPopState, true);
    return () => window.removeEventListener("popstate", onPopState, true);
  }, []);

  useEffect(() => {
    if (hasRouter) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!unloadShouldPrompt()) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [hasRouter]);

  /*
   * Mobile Safari may omit beforeunload when a tab is backgrounded or evicted.
   * pagehide cannot show UI, but it can preserve the same bounded recovery
   * envelope without introducing a second prompt or persistence path.
   */
  useEffect(() => {
    const onPageHide = () => {
      unloadShouldPrompt();
    };
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, []);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.("a[href]");
      if (!anchor) return;
      if (anchor.getAttribute("target") === "_blank") return;
      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#") || /^(mailto:|tel:)/i.test(href)) return;
      let url: URL;
      try {
        url = new URL(href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      event.preventDefault();
      event.stopPropagation();
      void requestLeave().then((ok) => {
        if (ok) window.location.assign(url.href);
      });
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") chooseLeave("cancel");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return hasRouter ? <RouterLeaveBlocker /> : null;
  return (
    <>
      {hasRouter ? <RouterLeaveBlocker /> : null}
      <div
        className="fixed inset-0 z-[var(--z-dialog)] grid place-items-center bg-navy/55 p-4"
        dir="rtl"
        role="presentation"
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="unsaved-leave-title"
          className="editor-dropdown-panel w-full max-w-sm rounded-[14px] border p-4 shadow-2xl"
        >
          <h2 id="unsaved-leave-title" className="text-[15px] font-extrabold text-ink">
            {LEAVE_TITLE}
          </h2>
          <p className="mt-2 text-[13px] leading-6 text-muted">{LEAVE_BODY}</p>
          <div className="mt-4 grid gap-2">
            <button
              type="button"
              onClick={() => chooseLeave("save")}
              className="inline-flex h-10 items-center justify-center rounded-[10px] bg-navy px-3 text-[13px] font-extrabold text-on-brand"
            >
              {LEAVE_SAVE}
            </button>
            <button
              type="button"
              onClick={() => chooseLeave("discard")}
              className="inline-flex h-10 items-center justify-center rounded-[10px] border border-[var(--editor-border)] px-3 text-[13px] font-bold"
            >
              {LEAVE_DISCARD}
            </button>
            <button
              type="button"
              onClick={() => chooseLeave("cancel")}
              className="inline-flex h-10 items-center justify-center rounded-[10px] px-3 text-[13px] font-bold text-muted"
            >
              {LEAVE_CANCEL}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
