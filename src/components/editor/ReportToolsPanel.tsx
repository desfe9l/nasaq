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
} from "lucide-react";
import { THEMES } from "@/lib/editor/model";
import { KPI_CARDS, type KpiKind } from "@/lib/editor/report-tools";
import { REPORT_BLOCKS, type ReportBlockId } from "@/lib/editor/report-blocks";
import {
  GRAPHIC_HEADINGS,
  type GraphicHeadingId,
} from "@/lib/editor/graphic-headings";
import { runPreflight, preflightSummary } from "@/lib/editor/preflight";
import {
  DEFAULT_PRINT_GUIDES,
  type PrintGuideSettings,
} from "@/lib/editor/print-guides";
import { domImageSize } from "@/lib/editor/images";
import { useEditor } from "@/lib/editor/store";
import { cn } from "@/lib/utils";
import { AiReportPanel } from "./AiReportPanel";

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
  const applyHeaderFooter = useEditor((s) => s.applyHeaderFooter);
  const removeHeaderFooter = useEditor((s) => s.removeHeaderFooter);
  const addPageNumbers = useEditor((s) => s.addPageNumbers);
  const removePageNumbers = useEditor((s) => s.removePageNumbers);
  const openExport = useEditor((s) => s.openExport);
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
    () => runPreflight(pages, { guides: printGuides, imageSize: domImageSize }),
    [pages, printGuides],
  );

  return (
    <>
      <AiReportPanel />

      {/* ── Structured report blocks ───────────────────────────────────── */}
      <div className="editor-subgroup">
        <h4 className="editor-subgroup-title">
          <span className="inline-flex items-center gap-1.5">
            <ListChecks className="size-3.5 text-navy-2 dark:text-gold-2" />
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
              className="grid min-h-12 gap-0.5 rounded-[8px] border border-line px-2 py-1.5 text-right text-[10px] font-extrabold hover:border-navy-2 dark:border-white/10"
            >
              <span className="inline-flex items-center gap-1.5">
                {block.id === "kpi-strip" ? (
                  <BarChart3 className="size-3.5 text-navy-2 dark:text-gold-2" />
                ) : block.id === "data-table" ? (
                  <Table2 className="size-3.5 text-navy-2 dark:text-gold-2" />
                ) : block.id === "approval" ? (
                  <ClipboardCheck className="size-3.5 text-navy-2 dark:text-gold-2" />
                ) : (
                  <ListChecks className="size-3.5 text-navy-2 dark:text-gold-2" />
                )}
                {block.label}
              </span>
              <span className="text-[9px] font-semibold leading-3 text-muted">{block.hint}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Graphic Headings — العناوين الجرافيكية ──────────────────────── */}
      <div className="editor-subgroup ring-1 ring-transparent hover:ring-navy-2/10 transition rounded-[8px] p-1">
        <h4 className="editor-subgroup-title">
          <span className="inline-flex items-center gap-1.5">
            <PenLine className="size-3.5 text-navy-2 dark:text-gold-2" />
            العناوين الجرافيكية
          </span>
          <span className="ms-auto rounded-full bg-navy-2/10 px-2 py-0.5 text-[9px] font-bold text-navy-2 dark:text-gold-2">اسحب أو انقر</span>
        </h4>
        <p className="text-[10px] leading-4 text-muted">
          عناوين جاهزة كعناصر جرافيكية قابلة للتحرير — اسحبها وأفلتها في الموضع المحدد داخل اللوحة، أو انقر للإضافة في المنتصف. مجموعة منظمة، RTL صحيح، النص الطويل يتكيف.
        </p>
        <div className="mb-2 rounded-[6px] bg-amber-50 px-2 py-1 text-[10px] leading-4 text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">
          💡 تلميح: اسحب العنوان وضعه بدقة في المكان الذي تريده داخل الـArtboard — يبقى Group واحد قابل للتحديد والتحريك.
        </div>
        <div className="grid grid-cols-2 gap-2">
          {GRAPHIC_HEADINGS.map((h) => (
            <button
              key={h.id}
              type="button"
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData("application/x-nasaq-graphic-heading", h.id);
                e.dataTransfer.effectAllowed = "copy";
              }}
              title={`${h.hint} — اسحب وأفلت في الموضع المحدد داخل الصفحة`}
              onClick={() => insertGraphicHeading(h.id as GraphicHeadingId)}
              className="group relative flex min-h-[68px] flex-col gap-1 overflow-hidden rounded-[10px] border border-line bg-white px-2.5 py-2.5 text-right transition hover:border-navy-2 hover:shadow-sm dark:border-white/10 dark:bg-white/[0.04]"
            >
              {/* Thumbnail preview - fixed height, balanced */}
              <span className="pointer-events-none flex h-[18px] w-full items-center">
                {h.thumbnail === "main" && (
                  <span className="flex w-full flex-col items-end gap-1">
                    <span className="block h-[8px] w-[72%] rounded-[2px] bg-navy-2/90 dark:bg-white/80" />
                    <span className="block h-[2px] w-[28%] rounded bg-gold-2" />
                  </span>
                )}
                {h.thumbnail === "section" && (
                  <span className="flex w-full items-center justify-end gap-1">
                    <span className="h-[6px] w-[56%] rounded-[2px] bg-ink/80 dark:bg-white/70" />
                    <span className="h-[12px] w-[3px] rounded bg-navy-2" />
                  </span>
                )}
                {h.thumbnail === "sub" && (
                  <span className="flex w-full items-center justify-end gap-1">
                    <span className="h-[5px] w-[48%] rounded-[2px] bg-ink/70 dark:bg-white/60" />
                    <span className="h-[5px] w-[5px] shrink-0 rounded-full bg-gold-2" />
                  </span>
                )}
                {h.thumbnail === "bar" && (
                  <span className="flex h-[14px] w-full items-center rounded-[4px] bg-navy-2 px-1.5">
                    <span className="block h-[5px] w-[70%] rounded-[2px] bg-white/90" />
                  </span>
                )}
                {h.thumbnail === "card" && (
                  <span className="flex h-[14px] w-full items-center rounded-[6px] border border-line bg-white px-1.5 shadow-sm dark:bg-white/10">
                    <span className="block h-[5px] w-[60%] rounded-[2px] bg-ink/80 dark:bg-white/70" />
                  </span>
                )}
                {h.thumbnail === "numbered" && (
                  <span className="flex w-full items-center justify-end gap-1.5">
                    <span className="h-[5px] w-[52%] rounded-[2px] bg-ink/80 dark:bg-white/70" />
                    <span className="flex h-[12px] w-[12px] shrink-0 items-center justify-center rounded-full bg-navy-2 text-[6px] text-white">١</span>
                  </span>
                )}
                {h.thumbnail === "separator" && (
                  <span className="flex w-full items-center gap-1">
                    <span className="h-[1px] flex-1 bg-line dark:bg-white/15" />
                    <span className="h-[3px] w-[3px] shrink-0 rounded-full bg-gold-2" />
                    <span className="h-[5px] w-[36%] shrink-0 rounded-[2px] bg-ink/80 dark:bg-white/70" />
                  </span>
                )}
                {h.thumbnail === "institutional" && (
                  <span className="flex h-[14px] w-full items-center justify-center rounded-[2px] border border-navy-2/60 px-1">
                    <span className="block h-[5px] w-[52%] rounded-[2px] bg-navy-2/80 dark:bg-white/70" />
                  </span>
                )}
                {h.thumbnail === "modern" && (
                  <span className="flex h-[14px] w-full overflow-hidden rounded-[6px] border border-line">
                    <span className="flex h-full flex-1 items-center px-1">
                      <span className="h-[4px] w-[68%] rounded-[2px] bg-ink/70 dark:bg-white/60" />
                    </span>
                    <span className="h-full w-[28%] bg-navy-2" />
                  </span>
                )}
                {h.thumbnail === "simple" && (
                  <span className="flex w-full justify-end">
                    <span className="block h-[6px] w-[58%] rounded-[2px] bg-ink/80 dark:bg-white/70" />
                  </span>
                )}
              </span>
              <span className="line-clamp-1 text-[10px] font-extrabold leading-4 text-ink dark:text-white">{h.label}</span>
              <span className="line-clamp-1 text-[9px] font-semibold leading-3 text-muted">{h.hint}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── KPI / progress cards ───────────────────────────────────────── */}
      <div className="editor-subgroup">
        <h4 className="editor-subgroup-title">
          <span className="inline-flex items-center gap-1.5">
            <LayoutGrid className="size-3.5 text-navy-2 dark:text-gold-2" />
            بطاقات المؤشرات
          </span>
        </h4>
        <div className="grid grid-cols-2 gap-2">
          <label className="grid gap-1 text-[11px] font-extrabold text-muted">
            التسمية
            <input
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              className="h-9 w-full rounded-[8px] border border-line bg-white px-2.5 text-[13px] font-semibold text-ink dark:border-white/10 dark:bg-white/5 dark:text-white"
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
              className="h-9 w-full rounded-[8px] border border-line bg-white px-2.5 text-[13px] font-semibold text-ink dark:border-white/10 dark:bg-white/5 dark:text-white"
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
              className="rounded-[8px] border border-line px-2 py-2 text-[10px] font-extrabold hover:border-navy-2 dark:border-white/10"
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
            className="h-9 w-full rounded-[8px] border border-line bg-white px-2.5 text-[13px] font-semibold text-ink dark:border-white/10 dark:bg-white/5 dark:text-white"
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
            <SheetIcon className="size-3.5 text-navy-2 dark:text-gold-2" />
            جداول البيانات
          </span>
        </h4>
        <button
          type="button"
          onClick={openTablePicker}
          className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-[8px] border border-line text-[11px] font-extrabold hover:border-navy-2 dark:border-white/10"
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
            <Stamp className="size-3.5 text-navy-2 dark:text-gold-2" />
            الختم والتوقيع
          </span>
        </h4>
        <button
          type="button"
          onClick={insertSignatureZone}
          className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-[8px] border border-line text-[11px] font-extrabold hover:border-navy-2 dark:border-white/10"
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
            <Hash className="size-3.5 text-navy-2 dark:text-gold-2" />
            الترويسة والتذييل والترقيم
          </span>
        </h4>
        <div className="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            onClick={applyHeaderFooter}
            className="h-9 rounded-[8px] border border-line text-[11px] font-extrabold hover:border-navy-2 dark:border-white/10"
          >
            تثبيت على كل الصفحات
          </button>
          <button
            type="button"
            onClick={removeHeaderFooter}
            disabled={!furniture}
            className="h-9 rounded-[8px] border border-line text-[11px] font-extrabold disabled:opacity-40 dark:border-white/10"
          >
            إزالة الترويسة والتذييل
          </button>
          <button
            type="button"
            onClick={addPageNumbers}
            className="h-9 rounded-[8px] border border-line text-[11px] font-extrabold hover:border-navy-2 dark:border-white/10"
          >
            ترقيم الصفحات
          </button>
          <button
            type="button"
            onClick={removePageNumbers}
            disabled={!numbered}
            className="h-9 rounded-[8px] border border-line text-[11px] font-extrabold disabled:opacity-40 dark:border-white/10"
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
            <Ruler className="size-3.5 text-navy-2 dark:text-gold-2" />
            خطوط الطباعة
          </span>
        </h4>
        {GUIDE_ROWS.map((row) => (
          <label
            key={row.key}
            title={row.hint}
            className="flex items-start justify-between gap-2 rounded-[8px] border border-line px-2 py-1.5 text-[10px] font-extrabold dark:border-white/10"
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
            <ShieldCheck className="size-3.5 text-navy-2 dark:text-gold-2" />
            فحص ما قبل التصدير
          </span>
        </h4>
        <p
          className={cn(
            "rounded-[8px] border px-2.5 py-2 text-[11px] font-extrabold",
            report.counts.error
              ? "border-red-200 bg-red-50 text-danger dark:border-red-500/30 dark:bg-red-500/10"
              : report.counts.warning
                ? "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
                : "border-line dark:border-white/10",
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
        <button
          type="button"
          onClick={() => openExport("pdf")}
          className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-[8px] border border-line text-[11px] font-extrabold hover:border-navy-2 dark:border-white/10"
        >
          <Ruler className="size-3.5" />
          مراجعة التفاصيل والإصلاح
        </button>
        <p className="text-[10px] leading-4 text-muted">
          يفحص نصًا مقطوعًا، محتوى داخل هامش التجليد، عناصر خارج الصفحة، صورًا
          بدقة أقل من الطباعة، صفحات فارغة، ورموزًا غير معروفة. القائمة الكاملة
          والإصلاح التلقائي في نافذة التصدير.
        </p>
      </div>
    </>
  );
}
