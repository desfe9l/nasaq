import { useEffect, useState } from "react";
import { ArrowRight, FileWarning, Plus } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { EditorApp } from "@/components/editor/EditorApp";
import { SiteFooter, SiteHeader } from "@/components/site/SiteChrome";
import { useEditor } from "@/lib/editor/store";
import { CREATE_ROUTE, PROJECTS_ROUTE } from "@/lib/site-routes";
import { useRevealWhile } from "@/components/ui/OfflineStatus";

export function EditorProjectRoute({ projectId }: { projectId: string }) {
  const hydrated = useEditor((s) => s.hydrated);
  const openId = useEditor((s) => s.id);
  const phase = useEditor((s) => s.documentPhase);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let alive = true;
    setMissing(false);
    void (async () => {
      try {
        await useEditor.getState().hydrate();
        if (!alive) return;
        const current = useEditor.getState();
        if (current.hydrated && current.id === projectId && current.documentPhase === "ready") {
          return;
        }
        const opened = await current.openProject(projectId);
        if (!alive) return;
        const resolved = useEditor.getState();
        setMissing(!(opened && resolved.hydrated && resolved.id === projectId));
      } catch {
        if (alive) setMissing(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [projectId]);

  const ready = hydrated && openId === projectId && phase === "ready" && !missing;
  const showOpening = useRevealWhile(!ready && !missing);

  if (missing) {
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

  if (!ready) {
    const offline = typeof navigator !== "undefined" && navigator.onLine === false;
    return showOpening ? (
      <div className="grid min-h-screen place-items-center bg-paper" dir="rtl">
        <p className="text-[13px] text-muted" role="status" aria-live="polite">
          {offline
            ? "جارٍ فتح النسخة المحفوظة على هذا الجهاز…"
            : "جارٍ فتح المستند…"}
        </p>
      </div>
    ) : (
      <div className="min-h-screen bg-paper" />
    );
  }

  return <EditorApp projectId={projectId} />;
}