import { useEffect, useSyncExternalStore } from "react";
import { useBlocker } from "@tanstack/react-router";
import {
  LEAVE_BODY,
  LEAVE_CANCEL,
  LEAVE_DISCARD,
  LEAVE_SAVE,
  LEAVE_TITLE,
} from "@/lib/editor/unsaved-leave";
import {
  blockRouterLeave,
  chooseLeave,
  leavePromptOpen,
  requestLeave,
  subscribeLeavePrompt,
  unloadShouldPrompt,
} from "@/lib/editor/leave-controller";

/**
 * Arabic confirmation for in-app leave, and the browser's own prompt for
 * refresh and close. Mounted once by the editor shell.
 */
export function LeaveGuard() {
  const open = useSyncExternalStore(subscribeLeavePrompt, leavePromptOpen, () => false);
  useBlocker({
    shouldBlockFn: blockRouterLeave,
    enableBeforeUnload: unloadShouldPrompt,
    withResolver: false,
  });

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

  if (!open) return null;
  return (
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
  );
}
