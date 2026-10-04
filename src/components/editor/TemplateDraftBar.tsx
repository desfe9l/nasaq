/*
 * «تعديل القالب» inside the editor.
 *
 * When the open document is the working copy of a template (see
 * `TemplateDraft`, recorded by the Templates catalog), this strip says so and
 * offers the same write-back the catalog banner does — through the shared
 * `commitTemplateDraft` — after flushing the document's pending save, so the
 * template receives exactly what the editor shows.
 */

import { useState } from "react";
import { LayoutTemplate, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useEditor } from "@/lib/editor/store";
import { getProject } from "@/lib/editor/storage";
import { useCatalogEntries, useTemplateDraft } from "@/components/site/useCatalog";
import { commitTemplateDraft } from "@/lib/templates/draft-commit";
import {
  TemplateAccessError,
  TemplateStorageError,
  type TemplateDraft,
} from "@/lib/templates/custom-templates";
import { TEMPLATES_ROUTE } from "@/lib/site-routes";

export function TemplateDraftBar() {
  const draft = useTemplateDraft();
  const projectId = useEditor((s) => s.id);
  if (!draft || !projectId || draft.projectId !== projectId) return null;
  return <DraftStrip draft={draft} />;
}

function DraftStrip({ draft }: { draft: TemplateDraft }) {
  const theme = useEditor((s) => s.theme);
  const orgName = useEditor((s) => s.orgName);
  const entitlements = useEditor((s) => s.entitlements);
  const entitlementsResolved = useEditor((s) => s.entitlementsResolved);
  const entries = useCatalogEntries(theme, orgName);
  const [busy, setBusy] = useState(false);
  const updatesTemplate = draft.kind === "custom";

  const commit = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const store = useEditor.getState();
      if (store.saveState !== "saved") {
        await store.saveNow();
        if (useEditor.getState().saveState !== "saved") {
          toast.error("تعذّر حفظ المستند — لم يُحدَّث القالب. أعد المحاولة.");
          return;
        }
      }
      const result = await commitTemplateDraft(draft, {
        entries,
        entitlements,
        readProject: getProject,
      });
      if (result.status === "missing") {
        toast.error("تعذّر قراءة مسودة القالب — حُذف المشروع أو لم يعد موجودًا");
        return;
      }
      if (result.status === "blocked") {
        toast.error(
          result.block === "premium-template"
            ? "يتطلب حفظ تعديلات ترخيصًا مناسبًا لهذا القالب."
            : "يتجاوز هذا المستند حد الصفحات في خطتك الحالية.",
        );
        return;
      }
      toast.success(
        result.updated
          ? `تم تحديث «${result.template.title}» بتعديلاتك`
          : `تم حفظ «${result.template.title}» كقالب جديد في «قوالبي الخاصة»`,
        {
          action: {
            label: "عرض القوالب",
            onClick: () => window.location.assign(TEMPLATES_ROUTE),
          },
        },
      );
    } catch (err) {
      toast.error(
        err instanceof TemplateStorageError || err instanceof TemplateAccessError
          ? err.message
          : "تعذّر حفظ المسودة",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="status"
      className="flex min-w-0 flex-wrap items-center justify-center gap-x-3 gap-y-1.5 overflow-hidden border-b border-gold/40 bg-gold/10 px-3 py-1.5 text-[12px] font-bold text-ink"
    >
      <span className="inline-flex min-w-0 max-w-full items-center gap-1.5">
        <LayoutTemplate className="size-3.5 shrink-0" aria-hidden />
        <span className="truncate">
          تعديل القالب «{draft.title}» —{" "}
          {updatesTemplate
            ? "التعديلات تُحفظ في هذه المسودة حتى تحدّث القالب."
            : "احفظ التعديلات كقالب مخصص جديد؛ القالب الأصلي يبقى كما هو."}
        </span>
      </span>
      <button
        type="button"
        onClick={() => void commit()}
        disabled={busy || !entitlementsResolved}
        className="inline-flex h-7 items-center gap-1.5 rounded-lg bg-navy px-3 text-[11px] font-extrabold text-on-brand transition hover:bg-navy-2 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
        {updatesTemplate ? "تحديث القالب" : "حفظ كقالب جديد"}
      </button>
    </div>
  );
}
