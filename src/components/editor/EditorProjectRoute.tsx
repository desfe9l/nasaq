/*
 * `/editor/<projectId>` — the editor bound to a document.
 *
 * The editor used to be a single address that opened "whatever was last
 * touched": a refresh could land on another document, and a shared link landed
 * on the editor's default rather than the design. This wrapper makes the URL the
 * source of truth: it resolves the named document FIRST and only then mounts the
 * studio — so reload, bookmark and share all open the same design, and a
 * document that is missing (or beyond the licence) says so instead of silently
 * showing a different one.
 *
 * The second half of that contract is what this file now also has to get right:
 * a document that is ALREADY open must never be torn down to satisfy the
 * address. Switching designs, following the URL after an in-studio switch, or
 * a template opening into the editor used to unmount the whole studio for a
 * frame of «جارٍ فتح المستند…» (and remount it with a fresh hydration), which is
 * how the editor ended up showing loading states after the document was ready.
 * A warm studio now stays mounted: the open completes in the chrome, and only a
 * COLD address (no document in memory yet) gates on resolution.
 */

import { useEffect, useState } from "react";
import { ArrowRight, FileWarning, Plus } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { EditorApp } from "@/components/editor/EditorApp";
import { useRevealWhile } from "@/components/ui/reveal";
import { EditorWorkspaceSkeleton } from "@/components/ui/Skeleton";
import { SiteFooter, SiteHeader } from "@/components/site/SiteChrome";
import { useEditor } from "@/lib/editor/store";
import { CREATE_ROUTE, PROJECTS_ROUTE } from "@/lib/site-routes";

export function EditorProjectRoute({ projectId }: { projectId: string }) {
  const hydrate = useEditor((s) => s.hydrate);
  const documentPhase = useEditor((s) => s.documentPhase);
  const documentOrigin = useEditor((s) => s.documentOrigin);
  const openId = useEditor((s) => s.id);
  /** The last projectId this route FAILED to open, so a cold link can say so. */
  const [failed, setFailed] = useState<string | null>(null);
  /**
   * The address has precedence when it changed underneath an in-flight open.
   * Keep that intent until this exact id has either opened or been refused, so
   * the editor shell cannot navigate the URL back to the outgoing document.
  */
  const [resolvedRouteId, setResolvedRouteId] = useState<string | null>(null);
  const routeResolving = resolvedRouteId !== projectId;

  const coldOpeningVisible = useRevealWhile(!failed);
  const ready = documentPhase === "ready";
  const showsRequestedDocument = ready && openId === projectId;
  /**
   * Warm studio: the document on screen was put there by the studio itself (a
   * switch, a template, a new design).
   *
   * The latch is the ORIGIN, not the phase. A studio-requested replacement —
   * `importProject`, `createDocument`, opening another design — passes through
   * `documentPhase: "loading"` while the read runs, and gating on `ready` here
   * would unmount the whole studio for exactly that window: the panels, camera
   * and scroll would be thrown away and the author would see the opening
   * placeholder AFTER a document was already open. That is the
   * «ready → loading → ready» flash this file exists to prevent. A cold
   * address (a boot restore or an empty store, `documentOrigin !== "open"`)
   * still resolves before the studio is mounted.
   */
  const warm = documentOrigin === "open";

  useEffect(() => {
    let alive = true;
    void (async () => {
      /* One in-flight boot for the whole app (the studio asks too). */
      await hydrate();
      while (alive) {
        const live = useEditor.getState();
        /* The address already names the live document: nothing to open. */
        if (live.documentPhase === "ready" && live.id === projectId) {
          setFailed(null);
          setResolvedRouteId(projectId);
          return;
        }
        /*
         * A route can change from /editor/A to /editor/B while A is still
         * loading. The prior implementation returned here and never retried B,
         * leaving the address on A. Wait for that shared open to settle, then
         * resolve the CURRENT route id from this effect's closure.
         */
        if (live.documentPhase === "loading") {
          await waitForDocumentOpenToSettle();
          continue;
        }
        const opened = await live.openProject(projectId);
        if (!alive) return;
        setFailed(opened ? null : projectId);
        setResolvedRouteId(projectId);
        return;
      }
    })();
    return () => {
      alive = false;
    };
  }, [hydrate, projectId]);

  /* A refused address must never keep a previous warm document on screen. */
  if (failed === projectId) return <DocumentUnavailable />;

  /* The address and the live document agree — or a studio document is already
   * on screen and this address is being caught up with. Either way the studio
   * stays mounted: no loading surface, no re-hydration, no camera jump. */
  if (showsRequestedDocument || warm)
    return <EditorApp projectId={projectId} suppressRouteFollow={routeResolving} />;

  /* Cold address still resolving: ONE loading surface (the same skeleton the
   * studio uses), never a second bespoke "جارٍ فتح المستند…" page — and it is
   * only painted once the resolution has genuinely lasted, so a warm open
   * never flashes anything. */
  return coldOpeningVisible ? (
    <EditorWorkspaceSkeleton />
  ) : (
    <div className="min-h-screen bg-paper" />
  );
}

/** Resolve only after the shared store has left its nested open lifecycle. */
function waitForDocumentOpenToSettle(): Promise<void> {
  if (useEditor.getState().documentPhase !== "loading") return Promise.resolve();
  return new Promise((resolve) => {
    const unsubscribe = useEditor.subscribe((state) => {
      if (state.documentPhase === "loading") return;
      unsubscribe();
      resolve();
    });
    // Do not miss the narrow gap between the first check and subscription.
    if (useEditor.getState().documentPhase !== "loading") {
      unsubscribe();
      resolve();
    }
  });
}

function DocumentUnavailable() {
  return (
    <div className="min-h-full bg-paper" dir="rtl">
      <SiteHeader current={PROJECTS_ROUTE} />
      <main className="mx-auto flex w-full max-w-3xl flex-col items-center px-4 py-20 text-center sm:px-6">
        <div className="rounded-full bg-line-2 p-6">
          <FileWarning className="size-10 text-muted" aria-hidden />
        </div>
        <h1 className="mt-6 text-2xl font-black text-ink">هذا المستند غير متاح</h1>
        <p className="mt-3 max-w-md text-[14px] leading-7 text-muted">
          قد يكون المستند محذوفًا، أو محفوظًا لحساب آخر على هذا المتصفح، أو يتطلب
          ترخيصًا لا تملكه. لم يُفتح أي مستند آخر مكانه — اختر ما تريد من مكتبتك.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link
            to={PROJECTS_ROUTE}
            className="inline-flex h-11 items-center gap-2 rounded-xl bg-navy px-6 text-[14px] font-bold text-on-brand"
          >
            <ArrowRight className="size-4" aria-hidden />
            مشاريعي
          </Link>
          <Link
            to={CREATE_ROUTE}
            className="inline-flex h-11 items-center gap-2 rounded-xl border border-line px-6 text-[14px] font-bold text-ink"
          >
            <Plus className="size-4" aria-hidden />
            إنشاء تصميم جديد
          </Link>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
