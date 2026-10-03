import { useState } from "react";
import { toast } from "sonner";
import { SiteFooter, SiteHeader } from "@/components/site/SiteChrome";
import { useEditor } from "@/lib/editor/store";
import { useLicense } from "@/lib/license/client";
import { projectAccessBlock } from "@/lib/editor/access-limits";
import { templateToProjectSeed } from "@/lib/templates/document-template";
import { getSharedPersonalTemplateFn } from "@/lib/templates/personal-functions";

export interface SharedTemplateCard {
  id: string;
  title: string;
  description: string;
  category: string;
  thumbnail: string | null;
  pageCount: number;
  pageW: number;
  pageH: number;
  content?: string;
}

export function SharedPersonalTemplatePage({
  template,
  unavailable,
}: {
  template: SharedTemplateCard | null;
  unavailable?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const { entitlements } = useLicense();

  const openTemplate = async () => {
    if (!template || busy) return;
    setBusy(true);
    try {
      const result = await getSharedPersonalTemplateFn({
        data: { token: window.location.pathname.split("/").pop() || "", includeContent: true },
      });
      if (!result.ok || !result.template || !("content" in result.template) || !result.template.content) {
        if ("locked" in result && result.locked) {
          toast.error("هذا القالب متاح في النسخة الكاملة");
          window.location.assign("/license");
          return;
        }
        toast.error(result.ok ? "القالب غير متاح" : result.error);
        return;
      }
      const seed = templateToProjectSeed(result.template.content, result.template.title);
      await useEditor.getState().hydrate();
      const block = projectAccessBlock(seed, entitlements);
      if (block) {
        toast.error("لا يمكن فتح هذا القالب ضمن صلاحيات الحساب الحالية");
        window.location.assign("/license");
        return;
      }
      const imported = await useEditor.getState().importProject(seed, { successMessage: null });
      if (!imported) {
        toast.error("تعذر فتح القالب");
        return;
      }
      toast.success(`تم إنشاء نسخة من «${template.title}»`);
      window.location.assign("/editor");
    } catch {
      toast.error("تعذر فتح القالب");
    } finally {
      setBusy(false);
    }
  };

  if (unavailable || !template) {
    return (
      <div className="min-h-full bg-paper" dir="rtl">
        <SiteHeader current="/templates" />
        <main className="mx-auto max-w-xl px-4 py-20 text-center">
          <h1 className="text-2xl font-black">القالب غير متاح</h1>
          <p className="mt-3 text-muted">الرابط غير صحيح، أو أن صاحب القالب لم يفعّل المشاركة.</p>
          <a href="/templates" className="mt-6 inline-flex h-11 items-center rounded-xl bg-navy px-5 text-[14px] font-bold text-on-brand">تصفح القوالب</a>
        </main>
        <SiteFooter />
      </div>
    );
  }

  return (
    <div className="min-h-full bg-paper" dir="rtl">
      <SiteHeader current="/templates" />
      <main className="mx-auto grid w-full max-w-5xl gap-8 px-4 py-12 sm:px-6 lg:grid-cols-[280px_1fr]">
        <div className="overflow-hidden rounded-2xl border border-line bg-surface">
          {template.thumbnail ? (
            <img src={template.thumbnail} alt="" className="w-full object-cover" />
          ) : (
            <div className="grid aspect-[3/4] place-items-center text-sm text-muted">معاينة القالب</div>
          )}
        </div>
        <div>
          <p className="text-[12px] font-bold text-muted">{template.category}</p>
          <h1 className="mt-2 text-[28px] font-black">{template.title}</h1>
          {template.description && <p className="mt-3 text-[14px] leading-7 text-muted">{template.description}</p>}
          <p className="mt-3 text-[13px] text-muted">
            {template.pageCount} صفحات · {Math.round(template.pageW)}×{Math.round(template.pageH)} مم
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void openTemplate()}
            className="mt-6 inline-flex h-11 items-center rounded-xl bg-navy px-5 text-[14px] font-extrabold text-on-brand disabled:opacity-50"
          >
            {busy ? "جارٍ الفتح…" : "استخدام القالب"}
          </button>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
