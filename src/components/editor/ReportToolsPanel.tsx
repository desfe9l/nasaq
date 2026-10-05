import { useMemo, useState } from "react";
import {
  BadgeCheck,
  BarChart3,
  ClipboardCheck,
  FileSpreadsheet,
  Hash,
  Sheet as SheetIcon,
  LayoutGrid,
  ListChecks,
  PenLine,
  Ruler,
  ShieldCheck,
  Stamp,
  Table2,
  Images,
} from "lucide-react";
import { THEMES } from "@/lib/editor/model";
import { KPI_CARDS, type KpiKind } from "@/lib/editor/report-tools";
import { REPORT_BLOCKS, type ReportBlockId } from "@/lib/editor/report-blocks";
import { HeadingGallery } from "./HeadingGallery";
import { ImageFrameGallery } from "./ImageFrameGallery";
import { runPreflight, preflightSummary } from "@/lib/editor/preflight";
import {
  DEFAULT_PRINT_GUIDES,
  type PrintGuideSettings,
} from "@/lib/editor/print-guides";
import { imageSizeResolver } from "@/lib/editor/images";
import { useEditor } from "@/lib/editor/store";
import { cn } from "@/lib/utils";
import { AiReportPanel } from "./AiReportPanel";
import { Wand2 } from "lucide-react";

const GUIDE_ROWS: {
  key: keyof PrintGuideSettings;
  label: string;
  hint: string;
}[] = [
  {
    key: "safe",
    label: "المنطقة الآمنة",
    hint: "إطار متقطّع يبيّن أين يبدأ النص ويقف — ١٠ مم من حدّ القطع.",
  },
  {
    key: "gutter",
    label: "هامش التجليد",
    hint: "شريط ١٥ مم عند الحافة اليمنى، لأن المستندات العربية تُجلَّد يمينًا.",
  },
  {
    key: "bleed",
    label: "القصّ والقص الزائد",
    hint: "٣ مم خارج القطع مع علامات القص في الأركان، لتقبله المطابع التجارية.",
  },
];

/**
 * «أدوات التقرير» — the document-level toolbox.
 *
 * These are not element properties: a KPI card, a signature zone, the letterhead
 * and the page numbering belong to the REPORT. Grouping them here (rather than
 * scattering them across element panels) is what makes them findable, and every
 * one of them is an ordinary element or group afterwards — movable, styleable,
 * exportable, undoable in one step.
 */
export function ReportToolsPanel() {
  const pages = useEditor((s) => s.pages);
  const theme = useEditor((s) => s.theme);
  const printGuides = useEditor((s) => s.printGuides) ?? DEFAULT_PRINT_GUIDES;
  const togglePrintGuide = useEditor((s) => s.togglePrintGuide);
  const insertSignatureZone = useEditor((s) => s.insertSignatureZone);
  const insertKpiCard = useEditor((s) => s.insertKpiCard);
  const insertReportBlock = useEditor((s) => s.insertReportBlock);
  const insertGraphicHeading = useEditor((s) => s.insertGraphicHeading);
  const activePageLocked = useEditor(
    (s) => !!s.pages.find((p) => p.id === s.activePageId)?.locked,
  );
  const insertImageFrame = useEditor((s) => s.insertImageFrame);
  const applyHeaderFooter = useEditor((s) => s.applyHeaderFooter);
  const removeHeaderFooter = useEditor((s) => s.removeHeaderFooter);
  const addPageNumbers = useEditor((s) => s.addPageNumbers);
  const removePageNumbers = useEditor((s) => s.removePageNumbers);
  const openTablePicker = useEditor((s) => s.openTablePicker);

  const [caption, setCaption] = useState("نسبة الإنجاز");
  const [value, setValue] = useState(75);
  const [target, setTarget] = useState(100);

  const numbered = useMemo(
    () => pages.some((p) => p.elements.some((el) => el.name === "رقم الصفحة")),
    [pages],
  );
  const furniture = useMemo(
    () => pages.some((p) => p.elements.some((el) => el.hfRole)),
    [pages],
  );

  /* The same checker the export dialog runs, so the two can never disagree. */
  const report = useMemo(
    /*
     * One DOM pass for the whole run. `domImageSize` rescanned every `<img>` in
     * the document for each placed image, so a long document made this panel —
     * and the preflight numbers the export dialog shows — quadratic in the
     * number of images.
     */
    () =>
      runPreflight(pages, {
        guides: printGuides,
        imageSize: imageSizeResolver(),
      }),
    [pages, printGuides],
  );

  return (
    <>
      <AiReportPanel />

      {/* ── Structured report blocks ───────────────────────────────────── */}
      <div className="editor-subgroup">
        <h4 className="editor-subgroup-title">
          <span className="inline-flex items-center gap-1.5">
            <ListChecks className="size-3.5 text-brand-hover" />
            بناء التقرير
          </span>
        </h4>
        <p className="text-[10px] leading-4 text-muted">
          أضف وحدة تقرير جاهزة ككتلة واحدة. كل عنوان ونص وجدول يبقى قابلاً للتعديل بعد فك التجميع.
        </p>
        <div className="grid grid-cols-2 gap-1.5">
          {REPORT_BLOCKS.map((block) => (
            <button
              key={block.id}
              type="button"
              title={block.hint}
              onClick={() => insertReportBlock(block.id as ReportBlockId)}
              className="grid min-h-12 gap-0.5 rounded-[8px] border border-line px-2 py-1.5 text-right text-[10px] font-extrabold hover:border-navy-2"
            >
              <span className="inline-flex items-center gap-1.5">
                {block.id === "kpi-strip" ? (
                  <BarChart3 className="size-3.5 text-brand-hover" />
                ) : block.id === "data-table" ? (
                  <Table2 className="size-3.5 text-brand-hover" />
                ) : block.id === "approval" ? (
                  <ClipboardCheck className="size-3.5 text-brand-hover" />
                ) : (
                  <ListChecks className="size-3.5 text-brand-hover" />
                )}
                {block.label}
              </span>
              <span className="text-[9px] font-semibold leading-3 text-muted">{block.hint}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Graphic Headings — العناوين الجرافيكية ──────────────────────── */}
      <div className="editor-subgroup">
        <h4 className="editor-subgroup-title">
          <span className="inline-flex items-center gap-1.5">
            <PenLine className="size-3.5 text-brand-hover" />
            العناوين الجرافيكية
          </span>
          <span className="ms-auto flex items-center gap-1">
            <button
              type="button"
              className="editor-mini-btn inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-[9.5px] font-bold text-brand-hover hover:border-navy-2"
              title="مولد عناوين الفقرات — نص، عنوان فرعي، ورقم قسم بمعاينة حية"
              onClick={() =>
                window.dispatchEvent(new CustomEvent("nasaq:open-heading-generator"))
              }
            >
              <Wand2 className="size-3" aria-hidden />
              المولد
            </button>
            <span className="rounded-full bg-navy-2/10 px-2 py-0.5 text-[9px] font-bold text-brand-hover">
              نقرة أو سحب
            </span>
          </span>
        </h4>
        <HeadingGallery
          disabled={Boolean(activePageLocked)}
          onPick={(id) => insertGraphicHeading(id)}
        />
      </div>

      {/* ── Image shapes / frames — أشكال و إطارات الصور ─────────────────── */}
      <div className="editor-subgroup">
        <h4 className="editor-subgroup-title">
          <span className="inline-flex items-center gap-1.5">
            <Images className="size-3.5 text-brand-hover" />
            أشكال و إطارات الصور
          </span>
          <span className="ms-auto rounded-full bg-navy-2/10 px-2 py-0.5 text-[9px] font-bold text-brand-hover">
            نقرة = صورة
          </span>
        </h4>
        <p className="text-[10px] leading-4 text-muted">
          اضغط شكلًا ليُضاف فورًا كصورة داخله: استبدل الصورة، قصّها وحرّكها، غيّر
          القياس والدوران — يبقى الشكل كما اخترته.
        </p>
        <ImageFrameGallery
          mode="insert"
          onPick={(frameId) => {
            if (frameId) insertImageFrame(frameId);
          }}
        />
      </div>

      {/* ── KPI / progress cards ───────────────────────────────────────── */}
      <div className="editor-subgroup">
        <h4 className="editor-subgroup-title">
          <span className="inline-flex items-center gap-1.5">
            <LayoutGrid className="size-3.5 text-brand-hover" />
            بطاقات المؤشرات
          </span>
        </h4>
        <div className="grid grid-cols-2 gap-2">
          <label className="grid gap-1 text-[11px] font-extrabold text-muted">
            التسمية
            <input
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              className="h-9 w-full rounded-[8px] border border-line bg-surface px-2.5 text-[13px] font-semibold text-ink"
            />
          </label>
          <label className="grid gap-1 text-[11px] font-extrabold text-muted">
            القيمة %
            <input
              type="number"
              min={0}
              max={100}
              value={value}
              onChange={(e) => setValue(Number(e.target.value))}
              className="h-9 w-full rounded-[8px] border border-line bg-surface px-2.5 text-[13px] font-semibold text-ink"
            />
          </label>
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {KPI_CARDS.map((card) => (
            <button
              key={card.id}
              type="button"
              title={card.hint}
              onClick={() =>
                insertKpiCard(card.id as KpiKind, {
                  caption: caption.trim() || card.label,
                  value,
                  target,
                })
              }
              className="rounded-[8px] border border-line px-2 py-2 text-[10px] font-extrabold hover:border-navy-2"
            >
              {card.label}
            </button>
          ))}
        </div>
        <label className="grid gap-1 text-[11px] font-extrabold text-muted">
          المستهدف (لبطاقة «المستهدف مقابل المتحقق»)
          <input
            type="number"
            min={1}
            value={target}
            onChange={(e) => setTarget(Math.max(1, Number(e.target.value)))}
            className="h-9 w-full rounded-[8px] border border-line bg-surface px-2.5 text-[13px] font-semibold text-ink"
          />
        </label>
        <p className="text-[10px] leading-4 text-muted">
          البطاقة تُبنى من عناصر موجودة فعلًا (صندوق + شريط تقدّم + نص) وتأخذ
          ألوانها من سمة «{THEMES[theme]?.name ?? theme}» — غيّر السمة فتتغيّر
          معها.
        </p>
      </div>

      {/* ── Data import ───────────────────────────────────────────────── */}
      <div className="editor-subgroup">
        <h4 className="editor-subgroup-title">
          <span className="inline-flex items-center gap-1.5">
            <SheetIcon className="size-3.5 text-brand-hover" />
            جداول البيانات
          </span>
        </h4>
        <button
          type="button"
          onClick={() => openTablePicker("tools")}
          className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-[8px] border border-line text-[11px] font-extrabold hover:border-navy-2"
        >
          <FileSpreadsheet className="size-3.5" />
          استيراد من Excel / CSV
        </button>
        <p className="text-[10px] leading-4 text-muted">
          يُعالج ملف Excel / CSV داخل المتصفح لهذه العملية، ولا يُرسل استيراده إلى خادم. تُعبَّأ
          الصفوف في جدول نَسَق أصلي قابل للتعديل والحساب، مع معاينة قبل الإدراج
          (حتى ٤٠٠ صف × ٦٠ عمودًا).
        </p>
      </div>

      {/* ── Stamp & signature ─────────────────────────────────────────── */}
      <div className="editor-subgroup">
        <h4 className="editor-subgroup-title">
          <span className="inline-flex items-center gap-1.5">
            <Stamp className="size-3.5 text-brand-hover" />
            الختم والتوقيع
          </span>
        </h4>
        <button
          type="button"
          onClick={insertSignatureZone}
          className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-[8px] border border-line text-[11px] font-extrabold hover:border-navy-2"
        >
          <PenLine className="size-3.5" />
          إضافة منطقة الختم والتوقيع
        </button>
        <p className="text-[10px] leading-4 text-muted">
          تُضاف كمجموعة واحدة قابلة للسحب في زاوية الصفحة، وتحتوي الإطار وسطور
          الاسم والصفة ومكان الختم — فكّ التجميع لتعديل أي جزء.
        </p>
      </div>

      {/* ── Header, footer, numbering ─────────────────────────────────── */}
      <div className="editor-subgroup">
        <h4 className="editor-subgroup-title">
          <span className="inline-flex items-center gap-1.5">
            <Hash className="size-3.5 text-brand-hover" />
            الترويسة والتذييل والترقيم
          </span>
        </h4>
        <div className="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            onClick={applyHeaderFooter}
            className="h-9 rounded-[8px] border border-line text-[11px] font-extrabold hover:border-navy-2"
          >
            تثبيت على كل الصفحات
          </button>
          <button
            type="button"
            onClick={removeHeaderFooter}
            disabled={!furniture}
            className="h-9 rounded-[8px] border border-line text-[11px] font-extrabold disabled:opacity-40"
          >
            إزالة الترويسة والتذييل
          </button>
          <button
            type="button"
            onClick={addPageNumbers}
            className="h-9 rounded-[8px] border border-line text-[11px] font-extrabold hover:border-navy-2"
          >
            ترقيم الصفحات
          </button>
          <button
            type="button"
            onClick={removePageNumbers}
            disabled={!numbered}
            className="h-9 rounded-[8px] border border-line text-[11px] font-extrabold disabled:opacity-40"
          >
            إزالة الترقيم
          </button>
        </div>
        <p className="text-[10px] leading-4 text-muted">
          «تثبيت» يأخذ ترويسة الصفحة الحالية وتذييلها ويطبّقهما على كل صفحة
          بالمقاس نفسه، ويُبقيها ثابتة عند النقل والتحرير. الترقيم رمز ديناميكي
          «صفحة n من m» يتحدّث تلقائيًا عند إضافة صفحة.
        </p>
      </div>

      {/* ── Print guides ──────────────────────────────────────────────── */}
      <div className="editor-subgroup">
        <h4 className="editor-subgroup-title">
          <span className="inline-flex items-center gap-1.5">
            <Ruler className="size-3.5 text-brand-hover" />
            خطوط الطباعة
          </span>
        </h4>
        {GUIDE_ROWS.map((row) => (
          <label
            key={row.key}
            title={row.hint}
            className="flex items-start justify-between gap-2 rounded-[8px] border border-line px-2 py-1.5 text-[10px] font-extrabold"
          >
            <span className="min-w-0">
              {row.label}
              <span className="mt-0.5 block text-[9px] font-semibold leading-4 text-muted">
                {row.hint}
              </span>
            </span>
            <input
              type="checkbox"
              checked={Boolean(printGuides[row.key])}
              onChange={() => togglePrintGuide(row.key)}
              className="mt-0.5 accent-navy"
            />
          </label>
        ))}
      </div>

      {/* ── Pre-flight ────────────────────────────────────────────────── */}
      <div className="editor-subgroup">
        <h4 className="editor-subgroup-title">
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck className="size-3.5 text-brand-hover" />
            فحص ما قبل التصدير
          </span>
        </h4>
        <p
          className={cn(
            "rounded-[8px] border px-2.5 py-2 text-[11px] font-extrabold",
            report.counts.error
              ? "border-danger/30 bg-danger/10 text-error"
              : report.counts.warning
                ? "border-gold/40 bg-gold/15 text-warning"
                : "border-line",
          )}
        >
          <span className="inline-flex items-center gap-1.5">
            {report.clean ? (
              <BadgeCheck className="size-3.5" />
            ) : (
              <FileSpreadsheet className="size-3.5" />
            )}
            {preflightSummary(report)}
          </span>
        </p>
        <p className="text-[10px] leading-4 text-muted">
          يفحص نصًا مقطوعًا، محتوى داخل هامش التجليد، عناصر خارج الصفحة، صورًا
          بدقة أقل من الطباعة، صفحات فارغة، ورموزًا غير معروفة. القائمة الكاملة
          والإصلاح التلقائي في نافذة التصدير.
        </p>
      </div>
    </>
  );
}
