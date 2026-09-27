import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { EditorApp } from "@/components/editor/EditorApp";
import { getPublishedTemplateFn } from "@/lib/admin/functions";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { useEditor } from "@/lib/editor/store";
import { useLicense } from "@/lib/license/client";
import { DEMO_LICENSE, canCreateDemoProject } from "@/lib/product/product";
import { publishedTemplateSeed } from "@/lib/templates/published";

export const Route = createFileRoute("/templates/$templateId")({
  ssr: false,
  component: PublishedTemplateEntry,
});

function PublishedTemplateEntry() {
  const { templateId } = Route.useParams();
  const { isPending } = useCurrentUserState();
  const { entitlements, isLoading } = useLicense();
  const [state, setState] = useState<"loading" | "ready" | "locked" | "limit" | "missing">("loading");
  const opened = useRef<string | null>(null);
  const inFlight = useRef<string | null>(null);

  useEffect(() => {
    // Wait for the account and its entitlements before applying the same demo
    // limits as the catalog. The payload endpoint also checks entitlement on
    // the server: client state is never sufficient to unlock licensed content.
    if (isPending || isLoading || opened.current === templateId || inFlight.current === templateId) return;
    inFlight.current = templateId;
    let alive = true;
    setState("loading");
    void (async () => {
      try {
        const result = await getPublishedTemplateFn({ data: { id: templateId } });
        if (!alive) return;
        if (!result.ok) {
          setState("locked" in result && result.locked ? "locked" : "missing");
          return;
        }
        const seed = publishedTemplateSeed(result.template);
        const editor = useEditor.getState();
        await editor.hydrate();
        if (!alive) return;
        const current = useEditor.getState();
        if (!entitlements.unlimited_projects && !canCreateDemoProject(current.projects.length)) {
          setState("limit");
          return;
        }
        const maxPages = DEMO_LICENSE.entitlements.maxPagesPerProject ?? Infinity;
        if (!entitlements.unlimited_pages && seed.pages.length > maxPages) {
          setState("limit");
          return;
        }
        // importProject creates its own id and persists a new copy. Neither the
        // admin template row nor the original project is ever written to.
        const imported = await current.importProject(seed, { successMessage: null });
        if (alive) {
          if (imported) opened.current = templateId;
          setState(imported ? "ready" : "missing");
        }
      } catch {
        if (alive) setState("missing");
      }
    })();
    return () => { alive = false; inFlight.current = null; };
  }, [templateId, isPending, isLoading, entitlements.unlimited_projects, entitlements.unlimited_pages]);

  if (state === "ready") return <EditorApp />;
  return (
    <main dir="rtl" className="flex min-h-screen items-center justify-center bg-paper p-6 text-center text-ink dark:bg-[#111722] dark:text-white">
      <div className="max-w-md rounded-2xl border border-line bg-white p-8 shadow-card dark:border-white/10 dark:bg-white/5">
        <h1 className="text-xl font-extrabold">
          {state === "loading" ? "جارٍ فتح القالب…" : state === "missing" ? "القالب غير متاح" : state === "limit" ? "اكتملت مساحة تجربة المحرر" : "هذا القالب متاح في النسخة الكاملة"}
        </h1>
        {state === "limit" && <p className="mt-3 text-sm text-muted">تسري حدود المشاريع والصفحات الحالية على نسختك من القالب.</p>}
        {state !== "loading" && (
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            {(state === "locked" || state === "limit") && <a href="/license" className="rounded-xl bg-navy px-5 py-2 font-bold text-white">النسخة الكاملة</a>}
            <a href="/templates" className="rounded-xl border border-line px-5 py-2 font-bold dark:border-white/20">تصفح القوالب</a>
          </div>
        )}
      </div>
    </main>
  );
}
