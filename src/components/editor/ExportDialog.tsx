import { useState } from "react";
import {
  FileDown,
  FileText,
  Image as ImageIcon,
  Presentation,
  FileCode2,
  FileJson,
  Eye,
  X,
  TriangleAlert,
  Loader2,
} from "lucide-react";
import { capturePages, runExport, safeFileName, type CapturedPage, type ExportFormat } from "@/lib/editor/export";
import { pageSize } from "@/lib/editor/model";
import { useEditor } from "@/lib/editor/store";
import { cn } from "@/lib/utils";
import { canUseDemoExport } from "@/lib/product/product";
import { useLicense } from "@/lib/license/client";

const FORMATS: { id: ExportFormat; title: string; desc: string; icon: typeof FileDown }[] = [
  { id: "pdf", title: "PDF", desc: "طباعة وأرشفة رسمية", icon: FileDown },
  { id: "png", title: "PNG", desc: "دقة عالية بلا فقدان", icon: ImageIcon },
  { id: "jpg", title: "JPG", desc: "حجم أصغر للصور", icon: ImageIcon },
  { id: "pptx", title: "PowerPoint", desc: "شرائح قابلة للتعديل", icon: Presentation },
  { id: "docx", title: "Word", desc: "نصوص وجداول قابلة للتعديل", icon: FileText },
  { id: "html", title: "HTML مستقل", desc: "ملف واحد قابل للطباعة", icon: FileCode2 },
  { id: "json", title: "ملف المشروع", desc: "نسخة احتياطية قابلة للاستيراد", icon: FileJson },
];

/** Formats drawn from the rendered DOM; the rest read the page model. */
const RASTER_FORMATS = new Set<ExportFormat>(["pdf", "png", "jpg"]);
const OFFICE_FORMATS = new Set<ExportFormat>(["pptx", "docx"]);

export function ExportDialog() {
  const open = useEditor((s) => s.exportOpen);
  const toggle = useEditor((s) => s.toggle);
  const pages = useEditor((s) => s.pages);
  const activePageId = useEditor((s) => s.activePageId);
  const name = useEditor((s) => s.name);
  const orgName = useEditor((s) => s.orgName);
  const theme = useEditor((s) => s.theme);
  const version = useEditor((s) => s.version);

  const [format, setFormat] = useState<ExportFormat>("pdf");
  const [quality, setQuality] = useState<2 | 3 | 4>(2);
  const [scope, setScope] = useState<"all" | "current">("all");
  const [editableOffice, setEditableOffice] = useState(true);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [previewPages, setPreviewPages] = useState<CapturedPage[]>([]);
  const [previewBusy, setPreviewBusy] = useState(false);
  const { entitlements } = useLicense();

  if (!open) return null;

  const selected = scope === "all" ? pages : pages.filter((p) => p.id === activePageId);
  const needsRaster = RASTER_FORMATS.has(format) || (OFFICE_FORMATS.has(format) && !editableOffice);
  const formatAllowed = canUseDemoExport(format, entitlements.advanced_export);

  const run = async () => {
    if (!formatAllowed) {
      setError("هذا النوع من التصدير متاح في النسخة الكاملة. يمكنك طلب الترخيص المناسب من صفحة النسخ والتراخيص.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      let captured: CapturedPage[] | null = null;
      if (needsRaster) {
        setProgress("تهيئة الصفحات…");
        const targets = selected.flatMap((p) => {
          const node = document.querySelector(`[data-export-page="${p.id}"]`) as HTMLElement | null;
          if (!node) return [];
          const size = pageSize(p);
          return [{ node, w: size.w, h: size.h }];
        });
        if (targets.length !== selected.length) {
          throw new Error("تعذر العثور على صفحات التصدير — أعد تحميل المحرر ثم حاول مرة أخرى");
        }
        captured = await capturePages(targets, quality, (i, n) => {
          setProgress(`التقاط الصفحة ${i + 1} من ${n}…`);
        });
      }
      setProgress("حفظ الملف…");
      await runExport(
        format,
        captured,
        { version, name, theme, orgName, pages, defaultSize: undefined },
        selected,
        editableOffice,
      );
      toggle("exportOpen");
    } catch (err) {
      const message = err instanceof Error ? err.message : "فشل التصدير";
      setError(message);
    } finally {
      setBusy(false);
      setProgress("");
    }
  };

  const preview = async () => {
    setPreviewBusy(true);
    setError(null);
    try {
      const targets = selected.flatMap((p) => {
        const node = document.querySelector(`[data-export-page="${p.id}"]`) as HTMLElement | null;
        if (!node) return [];
        const size = pageSize(p);
        return [{ node, w: size.w, h: size.h }];
      });
      if (targets.length !== selected.length) throw new Error("تعذر تجهيز معاينة التصدير");
      setPreviewPages(await capturePages(targets, Math.min(2, quality), undefined, 0));
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر تجهيز المعاينة");
    } finally {
      setPreviewBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[80] grid place-items-center bg-navy/50 p-4"
      onClick={() => !busy && toggle("exportOpen")}
    >
      <div
        className="w-full max-w-xl rounded-[14px] border border-line bg-white p-5 shadow-2xl dark:border-white/10 dark:bg-[#161c26]"
        onClick={(e) => e.stopPropagation()}
        dir="rtl"
        role="dialog"
        aria-modal="true"
        aria-label="تصدير المستند"
      >
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-[18px] font-extrabold text-navy dark:text-white">تصدير المستند</h2>
            <p className="mt-0.5 text-[12px] text-muted">
              {selected.length} صفحة · {safeFileName(name)}
            </p>
          </div>
          <button
            type="button"
            disabled={busy}
            className="grid size-9 place-items-center rounded-[8px] border border-line disabled:opacity-40 dark:border-white/10"
            onClick={() => toggle("exportOpen")}
            aria-label="إغلاق"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {FORMATS.map((f) => {
            const Icon = f.icon;
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => setFormat(f.id)}
                aria-pressed={format === f.id}
                className={cn(
                  "rounded-[10px] border p-3 text-right",
                  format === f.id ? "border-navy bg-navy text-white" : "border-line hover:border-navy-2 dark:border-white/10",
                )}
              >
                <Icon
                  className={cn(
                    "mb-2 size-5",
                    format === f.id ? "text-gold-2" : "text-navy-2 dark:text-gold-2",
                  )}
                />
                <strong className="block text-[13px]">{f.title}</strong>
                <span className={cn("text-[11px] leading-4", format === f.id ? "text-white/70" : "text-muted")}>
                  {f.desc}
                </span>
                {!canUseDemoExport(f.id, entitlements.advanced_export) && <span className="mt-1 block text-[10px] font-bold text-gold-2">النسخة الكاملة</span>}
              </button>
            );
          })}
        </div>

        {OFFICE_FORMATS.has(format) && (
          <div className="mt-4 grid gap-2 rounded-[10px] border border-line p-3 dark:border-white/10">
            <label className="flex cursor-pointer items-start gap-2">
              <input
                type="checkbox"
                checked={editableOffice}
                onChange={(e) => setEditableOffice(e.target.checked)}
                className="mt-0.5 size-4 accent-navy"
              />
              <span>
                <strong className="block text-[12px] text-navy dark:text-white">
                  عناصر قابلة للتعديل
                </strong>
                <span className="text-[11px] leading-4 text-muted">
                  النصوص والجداول والأشكال تُصدَّر كعناصر حقيقية يمكن تعديلها داخل البرنامج.
                  ألغِ التحديد لتصدير صورة مطابقة تمامًا للتصميم.
                </span>
              </span>
            </label>
          </div>
        )}

        {needsRaster && (
          <div className="mt-4 grid gap-3">
            <label className="grid gap-1 text-[11px] font-extrabold text-muted">
              الجودة
              <select
                value={quality}
                onChange={(e) => setQuality(Number(e.target.value) as 2 | 3 | 4)}
                className="h-9 rounded-[8px] border border-line bg-white px-2 text-[13px] font-semibold dark:border-white/10 dark:bg-white/5 dark:text-white"
              >
                <option value={2}>قياسية — أسرع</option>
                <option value={3}>عالية</option>
                <option value={4}>طباعة فائقة (أبطأ)</option>
              </select>
            </label>
          </div>
        )}

        <label className="mt-3 grid gap-1 text-[11px] font-extrabold text-muted">
          النطاق
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value as "all" | "current")}
            className="h-9 rounded-[8px] border border-line bg-white px-2 text-[13px] font-semibold dark:border-white/10 dark:bg-white/5 dark:text-white"
          >
            <option value="all">كل الصفحات ({pages.length})</option>
            <option value="current">الصفحة الحالية فقط</option>
          </select>
        </label>

        {format === "json" && (
          <p className="mt-3 rounded-[8px] border border-line bg-line-2/60 p-3 text-[11px] leading-5 text-muted dark:border-white/10 dark:bg-white/5">
            ملف المشروع يحفظ الصفحات والعناصر والصور، ويمكن استيراده على أي جهاز من صفحة المشاريع.
          </p>
        )}

        {(format === "png" || format === "jpg") && selected.length > 1 && (
          <p className="mt-3 rounded-[8px] border border-line bg-line-2/60 p-3 text-[11px] leading-5 text-muted dark:border-white/10 dark:bg-white/5">
            عند اختيار أكثر من صفحة يتم تنزيل ملف ZIP يحتوي صورة مستقلة لكل صفحة.
          </p>
        )}

        {busy && (
          <p className="mt-3 inline-flex w-full items-center justify-center gap-2 text-center text-[12px] font-bold text-navy-2 dark:text-gold-2">
            <Loader2 className="size-4 animate-spin" />
            {progress || "جاري التصدير…"}
          </p>
        )}

        {error && (
          <p className="mt-3 inline-flex w-full items-start justify-center gap-2 rounded-[8px] border border-red-200 bg-red-50 p-3 text-[12px] font-bold leading-5 text-danger dark:border-red-500/30 dark:bg-red-500/10">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            {error}
          </p>
        )}

        <div className="mt-5 flex gap-2">
          <button
            type="button"
            disabled={busy || previewBusy || !formatAllowed}
            onClick={() => void preview()}
            className="inline-flex h-11 items-center justify-center gap-1.5 rounded-[10px] border border-line px-4 text-[13px] font-bold disabled:opacity-40 dark:border-white/10"
          >
            <Eye className="size-4" />
            {previewBusy ? "جاري المعاينة…" : "معاينة"}
          </button>
          <button
            type="button"
            disabled={busy || !formatAllowed}
            onClick={() => void run()}
            className="h-11 flex-1 rounded-[10px] bg-navy text-[14px] font-extrabold text-white disabled:opacity-50"
          >
            {busy ? "جاري التصدير…" : "تنزيل الملف"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => toggle("exportOpen")}
            className="h-11 rounded-[10px] border border-line px-4 text-[13px] font-bold disabled:opacity-40 dark:border-white/10"
          >
            إلغاء
          </button>
        </div>

        {previewPages.length > 0 && (
          <div className="fixed inset-0 z-[90] grid place-items-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="معاينة التصدير">
            <div className="flex max-h-[92vh] w-full max-w-4xl flex-col rounded-[12px] border border-line bg-white p-4 dark:border-white/10 dark:bg-[#303132]">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div><h3 className="text-[15px] font-extrabold">معاينة التصدير</h3><p className="text-[11px] text-muted">{previewPages.length} صفحة · مطابقة لمقاس المستند</p></div>
                <button type="button" onClick={() => setPreviewPages([])} className="grid size-8 place-items-center rounded-[7px] border border-line dark:border-white/10" title="إغلاق المعاينة" aria-label="إغلاق المعاينة"><X className="size-4" /></button>
              </div>
              <div className="editor-pane-scroll min-h-0 flex-1 overflow-auto rounded-[8px] bg-[#252627] p-4">
                <div className="grid gap-5 justify-items-center">
                  {previewPages.map((page, index) => <figure key={index} className="grid gap-1 justify-items-center"><img src={page.canvas.toDataURL("image/png")} alt={`معاينة الصفحة ${index + 1}`} className="max-h-[68vh] max-w-full object-contain shadow-2xl" /><figcaption className="text-[10px] text-white/65">صفحة {index + 1}</figcaption></figure>)}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}