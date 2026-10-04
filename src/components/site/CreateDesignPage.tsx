/*
 * «إنشاء تصميم» — the professional creation screen (`/create`).
 *
 * This page exists so that NOBODY ever lands in an empty canvas with undefined
 * dimensions. It is the one door into a new document: the format, the page
 * size, the orientation and (for a blank start) the page count are chosen and
 * VISIBLE here — with a live preview painted from the exact document that will
 * be created — before the editor opens at the new document's own address.
 *
 * It is also the destination of the editor entry: `/editor` without a document
 * sends the author here, so the bare editor URL can never mean "a blank page
 * you did not ask for".
 */

import { useCallback, useEffect } from "react";
import { ArrowRight, FilePlus2, LayoutTemplate, ShieldCheck, Sparkles } from "lucide-react";
import { SiteFooter, SiteHeader } from "@/components/site/SiteChrome";
import { NewDocumentForm } from "@/components/site/NewDocumentDialog";
import { useEditor } from "@/lib/editor/store";
import { useLicense } from "@/lib/license/client";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { useEditorEntry } from "@/lib/auth/use-editor-entry";
import {
  CREATE_ROUTE,
  EDITOR_ROUTE,
  PROJECTS_ROUTE,
  TEMPLATES_ROUTE,
  WORKSPACE_ROUTE,
  editorPathFor,
} from "@/lib/site-routes";
import type { NewDocumentConfig } from "@/lib/editor/new-document";

/** What the screen can be pre-configured with (`createPathFor` writes these). */
export interface CreateDesignSearch {
  start?: "blank" | "template";
  template?: string;
  size?: string;
}

export function CreateDesignPage({ search }: { search: CreateDesignSearch }) {
  const hydrate = useEditor((s) => s.hydrate);
  const setEntitlements = useEditor((s) => s.setEntitlements);
  const { user } = useCurrentUserState();
  const { entry } = useEditorEntry();
  const { entitlements } = useLicense(user?.id, user?.primaryEmail);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    setEntitlements(entitlements);
  }, [entitlements, setEntitlements]);

  /*
   * The document is created here and the address follows it. A full navigation
   * (not a router push) is deliberate: the editor boots from its own URL, so a
   * refresh, a bookmark or a shared link re-opens exactly this document.
   */
  const handleCreated = useCallback((projectId: string | null) => {
    window.location.assign(projectId ? editorPathFor(projectId) : EDITOR_ROUTE);
  }, []);

  const initial: Partial<NewDocumentConfig> = {
    ...(search.start ? { start: search.start } : {}),
    ...(search.template
      ? { pack: search.template as NewDocumentConfig["pack"], start: "template" as const }
      : {}),
  };

  return (
    <div className="min-h-full bg-paper">
      <SiteHeader current={CREATE_ROUTE} />

      <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 md:py-14">
        {/* Masthead — where you are, what this screen decides, and what is next. */}
        <header className="flex flex-wrap items-end justify-between gap-5">
          <div className="min-w-0">
            <p className="text-[10px] font-extrabold tracking-[0.2em] text-muted">
              NASAQ · WORKSPACE
            </p>
            <h1 className="mt-1.5 text-[27px] font-extrabold text-ink">
              إنشاء تصميم
            </h1>
            <p className="mt-2 max-w-2xl text-[13.5px] leading-7 text-muted">
              اختر نوع المستند والمقاس والاتجاه — يظهر المقاس النهائي في المعاينة
              قبل الدخول إلى المحرر، ثم يُنشأ المستند بمقاسه الصحيح ويُحفظ في
              مشاريعك.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <a
              href="/studio"
              className="inline-flex h-10 items-center gap-1.5 rounded-[10px] bg-navy px-3.5 text-[12.5px] font-extrabold text-on-brand shadow-sm transition hover:bg-navy-2"
            >
              <Sparkles className="size-4 text-gold" aria-hidden />
              استوديو التوليد بالذكاء الاصطناعي
            </a>
            <a
              href={PROJECTS_ROUTE}
              className="inline-flex h-10 items-center gap-1.5 rounded-[10px] border border-line bg-surface px-3.5 text-[12.5px] font-bold text-ink transition hover:border-brand"
            >
              مشاريعي
            </a>
            <a
              href={TEMPLATES_ROUTE}
              className="inline-flex h-10 items-center gap-1.5 rounded-[10px] border border-line bg-surface px-3.5 text-[12.5px] font-bold text-ink transition hover:border-brand"
            >
              <LayoutTemplate className="size-4" aria-hidden />
              القوالب الجاهزة
            </a>
            {entry.ready && entry.direct && (
              <a
                href={WORKSPACE_ROUTE}
                className="inline-flex h-10 items-center gap-1.5 rounded-[10px] border border-line bg-surface px-3.5 text-[12.5px] font-bold text-ink transition hover:border-brand"
              >
                مساحة العمل
              </a>
            )}
          </div>
        </header>

        {/* The configuration form, page variant: same rules as the dialog. */}
        <section className="mt-7 overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3.5">
            <div className="flex items-center gap-2.5">
              <span className="grid size-9 place-items-center rounded-[10px] bg-navy/10 text-brand">
                <FilePlus2 className="size-4" aria-hidden />
              </span>
              <div>
                <p className="text-[13px] font-extrabold text-ink">
                  إعداد المستند الجديد
                </p>
                <p className="text-[11px] text-muted">
                  كل الإعدادات قابلة للتغيير لاحقًا من المحرر.
                </p>
              </div>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-paper/70 px-2.5 py-1 text-[10px] font-bold text-muted">
              <ShieldCheck className="size-3 text-brand" aria-hidden />
              المستند يُحفظ في مكتبتك
            </span>
          </div>

          <div className="p-5">
            <NewDocumentForm
              variant="page"
              initial={initial}
              submitLabel="إنشاء وفتح المحرر"
              onCreated={handleCreated}
            />
          </div>
        </section>

        <p className="mt-5 flex items-start gap-2 text-[12px] leading-6 text-muted">
          <ArrowRight className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
          تفتح كل قوالب نَسَق في صفحاتها الخاصة أولًا (معاينة وتفاصيل وزر
          «استخدام القالب») — ولا يفتح المحرر إلا بعد أن تختار.
        </p>
      </main>

      <SiteFooter />
    </div>
  );
}
