import { useState } from "react";
import { Check, Copy, Share2, X } from "lucide-react";
import { toast } from "sonner";
import { useEditor } from "@/lib/editor/store";
import { TEMPLATE_CATEGORIES } from "@/lib/editor/templates";
import { captureFirstPagePreview } from "@/lib/nsq/editor-io";
import {
  adminSetTemplateStatusFn,
  adminUpsertTemplateFn,
} from "@/lib/admin/functions";
import type { TemplateStatus, TemplateTier } from "@/lib/admin/types";
import {
  buildTemplateDocument,
  serializeTemplateDocument,
} from "@/lib/templates/document-template";
import {
  savePersonalTemplateFn,
  setPersonalSharingFn,
} from "@/lib/templates/personal-functions";
import { personalShareAbsoluteUrl } from "@/lib/templates/personal";
import { publishedTemplateAbsoluteUrl } from "@/lib/templates/published";

type Mode = "official" | "personal";

export function SaveAsTemplateDialog({
  mode,
  onClose,
}: {
  mode: Mode;
  onClose: () => void;
}) {
  const name = useEditor((s) => s.name);
  const [title, setTitle] = useState(name || "قالب جديد");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("reports");
  const [tier, setTier] = useState<TemplateTier>("free");
  const [status, setStatus] = useState<TemplateStatus>("draft");
  const [share, setShare] = useState(false);
  const [createNew, setCreateNew] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<{
    id: string;
    slug: string | null;
    title: string;
    url: string | null;
    personal: boolean;
  } | null>(null);

  const submit = async () => {
    if (busy) return;
    const state = useEditor.getState();
    if (!state.pages?.length) {
      toast.error("لا توجد صفحات لحفظها كقالب");
      return;
    }
    setBusy(true);
    try {
      const doc = buildTemplateDocument({
        name: title,
        theme: state.theme,
        orgName: state.orgName,
        defaultSize: state.defaultSize,
        transactionNo: state.transactionNo,
        licensedTemplateId: state.licensedTemplateId,
        pack: state.pack,
        pages: state.pages,
        embeddedFonts: state.embeddedFonts,
      });
      const content = serializeTemplateDocument(doc);
      const thumbnail = await previewDataUrl();
      if (mode === "official") {
        const result = await adminUpsertTemplateFn({
          data: {
            template: {
              title: title.trim(),
              description,
              category,
              tier,
              status,
              kind: "json",
              content,
              thumbnail,
              originProjectId: createNew ? null : state.id,
              createNew,
            },
          },
        });
        if (!result.ok) {
          toast.error(result.error || "تعذر حفظ القالب");
          return;
        }
        const shareKey = result.slug || result.id;
        const url = status === "published" ? publishedTemplateAbsoluteUrl(shareKey) : null;
        setSaved({ id: result.id, slug: result.slug ?? null, title: title.trim(), url, personal: false });
        toast.success("تم حفظ القالب في استوديو القوالب");
        return;
      }
      const result = await savePersonalTemplateFn({
        data: {
          title: title.trim(),
          description,
          category,
          content,
          thumbnail,
          originProjectId: state.id,
          createNew,
          share,
        },
      });
      if (!result.ok || !result.template) {
        toast.error(result.ok ? "تعذر حفظ القالب" : result.error);
        return;
      }
      const url = result.template.shareToken
        ? personalShareAbsoluteUrl(result.template.shareToken)
        : null;
      setSaved({
        id: result.template.id,
        slug: null,
        title: result.template.title,
        url,
        personal: true,
      });
      toast.success("تم حفظ القالب في قوالبي");
    } catch {
      toast.error("تعذر حفظ القالب");
    } finally {
      setBusy(false);
    }
  };

  const enableShare = async () => {
    if (!saved || busy) return;
    setBusy(true);
    try {
      if (saved.personal) {
        const result = await setPersonalSharingFn({ data: { id: saved.id, shared: true } });
        if (!result.ok || !result.shareToken) {
          toast.error(result.ok ? "تعذر إنشاء الرابط" : result.error);
          return;
        }
        const url = personalShareAbsoluteUrl(result.shareToken);
        setSaved({ ...saved, url });
        return;
      }
      const result = await adminSetTemplateStatusFn({
        data: { id: saved.id, status: "published" },
      });
      if (!result.ok) {
        toast.error(result.error || "تعذر نشر القالب");
        return;
      }
      setSaved({ ...saved, url: publishedTemplateAbsoluteUrl(saved.slug || saved.id) });
      toast.success("أصبح القالب منشورًا");
    } catch {
      toast.error("تعذر مشاركة القالب");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[var(--z-dialog)] grid place-items-center bg-navy/55 p-4" dir="rtl">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={mode === "official" ? "حفظ كقالب" : "حفظ في قوالبي"}
        className="editor-dropdown-panel max-h-[92vh] w-full max-w-md overflow-auto rounded-[14px] border p-4 shadow-2xl"
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-extrabold">
              {mode === "official" ? "حفظ كقالب" : "حفظ في قوالبي"}
            </h2>
            <p className="mt-1 text-[12px] leading-5 text-muted">
              يُحفظ المستند قابلًا للتعديل: الصفحات والمقاس والطبقات والخلفيات.
            </p>
          </div>
          <button type="button" aria-label="إغلاق" onClick={onClose} className="grid size-8 place-items-center rounded-[8px] hover:bg-line-2">
            <X className="size-4" />
          </button>
        </div>

        {saved ? (
          <SavedShare saved={saved} busy={busy} onShare={() => void enableShare()} onClose={onClose} />
        ) : (
          <form
            className="grid gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <label className="grid gap-1 text-[11px] font-bold">
              اسم القالب
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                required
                maxLength={120}
                className="h-10 rounded-[8px] border border-[var(--editor-border)] bg-transparent px-3 text-[13px] font-semibold"
              />
            </label>
            <label className="grid gap-1 text-[11px] font-bold">
              الوصف
              <input
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                maxLength={240}
                className="h-10 rounded-[8px] border border-[var(--editor-border)] bg-transparent px-3 text-[13px]"
              />
            </label>
            <label className="grid gap-1 text-[11px] font-bold">
              التصنيف
              <select
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                className="h-10 rounded-[8px] border border-[var(--editor-border)] bg-transparent px-3 text-[13px]"
              >
                {TEMPLATE_CATEGORIES.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
              </select>
            </label>
            {mode === "official" ? (
              <div className="grid grid-cols-2 gap-2">
                <label className="grid gap-1 text-[11px] font-bold">
                  الظهور
                  <select
                    value={status}
                    onChange={(event) => setStatus(event.target.value as TemplateStatus)}
                    className="h-10 rounded-[8px] border border-[var(--editor-border)] bg-transparent px-2 text-[13px]"
                  >
                    <option value="draft">مسودة</option>
                    <option value="published">منشور</option>
                    <option value="archived">مؤرشف</option>
                  </select>
                </label>
                <label className="grid gap-1 text-[11px] font-bold">
                  الترخيص
                  <select
                    value={tier}
                    onChange={(event) => setTier(event.target.value as TemplateTier)}
                    className="h-10 rounded-[8px] border border-[var(--editor-border)] bg-transparent px-2 text-[13px]"
                  >
                    <option value="free">مجاني</option>
                    <option value="licensed">مرخّص</option>
                  </select>
                </label>
              </div>
            ) : (
              <label className="flex items-center gap-2 text-[12px] font-bold">
                <input type="checkbox" checked={share} onChange={(event) => setShare(event.target.checked)} />
                مشاركة القالب عبر رابط بعد الحفظ
              </label>
            )}
            <label className="flex items-center gap-2 text-[12px] font-bold">
              <input type="checkbox" checked={createNew} onChange={(event) => setCreateNew(event.target.checked)} />
              حفظ كنسخة جديدة بدل تحديث القالب السابق
            </label>
            <button
              type="submit"
              disabled={busy || !title.trim()}
              className="inline-flex h-10 items-center justify-center rounded-[10px] bg-navy text-[13px] font-extrabold text-on-brand disabled:opacity-50"
            >
              {busy ? "جارٍ الحفظ…" : mode === "official" ? "حفظ كقالب" : "حفظ في قوالبي"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

function SavedShare({
  saved,
  busy,
  onShare,
  onClose,
}: {
  saved: { id: string; slug: string | null; title: string; url: string | null; personal: boolean };
  busy: boolean;
  onShare: () => void;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (!saved.url) return;
    try {
      await navigator.clipboard.writeText(saved.url);
      setCopied(true);
      toast.success("تم نسخ رابط القالب");
    } catch {
      toast.error("تعذر نسخ الرابط");
    }
  };
  const nativeShare = async () => {
    if (!saved.url || !navigator.share) return;
    try {
      await navigator.share({ title: saved.title, url: saved.url });
    } catch {
      /* dismissed */
    }
  };
  return (
    <div className="grid gap-3">
      <p className="text-[13px] font-bold">تم حفظ «{saved.title}».</p>
      {saved.url ? (
        <>
          <p className="break-all rounded-[8px] border border-[var(--editor-border)] px-3 py-2 text-[11px]" dir="ltr">
            {saved.url}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => void copy()} className="inline-flex h-10 items-center justify-center gap-2 rounded-[10px] bg-navy text-[12px] font-extrabold text-on-brand">
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              نسخ الرابط
            </button>
            <button type="button" onClick={() => void nativeShare()} className="inline-flex h-10 items-center justify-center gap-2 rounded-[10px] border border-[var(--editor-border)] text-[12px] font-bold">
              <Share2 className="size-4" />
              مشاركة
            </button>
          </div>
        </>
      ) : (
        <button type="button" disabled={busy} onClick={onShare} className="inline-flex h-10 items-center justify-center gap-2 rounded-[10px] bg-navy text-[13px] font-extrabold text-on-brand disabled:opacity-50">
          <Share2 className="size-4" />
          {busy ? "جارٍ إنشاء الرابط…" : "مشاركة القالب"}
        </button>
      )}
      <div className="flex gap-2">
        {saved.personal && (
          <a href="/my-templates" className="inline-flex h-10 flex-1 items-center justify-center rounded-[10px] border border-[var(--editor-border)] text-[12px] font-bold">
            قوالبي
          </a>
        )}
        {!saved.personal && (
          <a href="/admin-dashboard" className="inline-flex h-10 flex-1 items-center justify-center rounded-[10px] border border-[var(--editor-border)] text-[12px] font-bold">
            استوديو القوالب
          </a>
        )}
        <button type="button" onClick={onClose} className="inline-flex h-10 flex-1 items-center justify-center rounded-[10px] text-[12px] font-bold text-muted">
          إغلاق
        </button>
      </div>
    </div>
  );
}

async function previewDataUrl(): Promise<string | null> {
  try {
    const preview = await captureFirstPagePreview();
    if (!preview?.bytes?.length) return null;
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < preview.bytes.length; i += chunk) {
      binary += String.fromCharCode(...preview.bytes.subarray(i, i + chunk));
    }
    const url = `data:image/png;base64,${btoa(binary)}`;
    return url.length <= 1_500_000 ? url : null;
  } catch {
    return null;
  }
}
