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
 */

import { useEffect, useState } from "react";
import { ArrowRight, FileWarning, Plus } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { EditorApp } from "@/components/editor/EditorApp";
import { SiteFooter, SiteHeader } from "@/components/site/SiteChrome";
import { useEditor } from "@/lib/editor/store";
import { CREATE_ROUTE, PROJECTS_ROUTE } from "@/lib/site-routes";

type Resolution = {
  projectId: string;
  status: "resolving" | "ready" | "missing";
};

export function EditorProjectRoute({ projectId }: { projectId: string }) {
  const hydrate = useEditor((s) => s.hydrate);
  const [resolution, setResolution] = useState<Resolution>(() => ({
    projectId,
    status: "resolving",
  }));

  useEffect(() => {
    let alive = true;
    setResolution({ projectId, status: "resolving" });
    void (async () => {
      try {
        await hydrate();
        const current = useEditor.getState();
        const alreadyOpen = current.id === projectId && current.hydrated;
        const opened = alreadyOpen || (await current.openProject(projectId));
        if (!alive) return;

        // Do not mount the generic editor (or whatever project hydration last
        // restored) unless the requested record itself is now in the store.
        // `openProject` applies the saved project pages, dimensions and content;
        // this identity check makes the URL and the visible document agree.
        const resolved = useEditor.getState();
        setResolution({
          projectId,
          status:
            opened && resolved.hydrated && resolved.id === projectId
              ? "ready"
              : "missing",
        });
      } catch {
        if (alive) setResolution({ projectId, status: "missing" });
      }
    })();
    return () => {
      alive = false;
    };
  }, [hydrate, projectId]);

  if (resolution.projectId === projectId && resolution.status === "ready") {
    return <EditorApp projectId={projectId} />;
  }

  if (resolution.projectId !== projectId || resolution.status === "resolving") {
    return (
      <div className="grid min-h-screen place-items-center bg-paper" dir="rtl">
        <p className="text-[13px] text-muted">جارٍ فتح المستند…</p>
      </div>
    );
  }

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
