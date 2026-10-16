import {
  ArrowLeft,
  Download,
  FileText,
  FolderOpen,
  Layers3,
  LayoutTemplate,
  Shapes,
} from "lucide-react";
import { createProject } from "@/lib/editor/templates";
import { useSiteSettings } from "@/lib/admin/use-site-settings";
import { type SiteImages } from "@/lib/admin/types";
import { TemplateSheetPreview } from "@/components/site/TemplatePreview";
import { cn } from "@/lib/utils";

/**
 * Real pages, not empty slots.
 *
 * This section used to wait for owner-uploaded screenshots and, until they
 * existed, painted a large «لم تُضف صورة الواجهة بعد» box and three cards with
 * broken-image placeholders on the homepage — an empty section in the first
 * screenful of scroll.
 *
 * It now paints the bundled catalog itself: the flagship pack's OWN pages
 * through the same renderer the editor and the catalog use, so the visitor
 * sees the real cover, the real contents page, and the real closing page that
 * the product produces. Owner uploads (`site_settings.images`) are still
 * honoured — when they exist they are shown below the stage — but the section
 * never depends on them to look finished.
 */

const FLAGSHIP = createProject("official");

/** The three capability lines the old cards carried, kept as one caption row. */
const CAPABILITIES = [
  {
    icon: FileText,
    title: "مستند مؤسسي داخل المحرر",
    copy: "صفحة تقرير عربية على اللوحة، مع رأس وتذييل ومحتوى قابل للتحرير.",
  },
  {
    icon: Layers3,
    title: "الصفحات وبنية المستند",
    copy: "أضف الصفحات ورتّبها وانتقل بينها؛ الترقيم والتذييل يتحدثان تلقائيًا.",
  },
  {
    icon: Shapes,
    title: "أدوات التصميم والمكتبة",
    copy: "نصوص وصور وأشكال وجداول ومؤشرات، ومكتبة أصول تعيد استخدامها.",
  },
] as const;

/** Owner-uploaded captures, in the order the admin lists them. */
function ownerShots(images: SiteImages | undefined): { src: string; alt: string }[] {
  if (!images) return [];
  const slots: Array<[Exclude<keyof SiteImages, "gallery">, string]> = [
    ["workspace", "لقطة حقيقية لمساحة عمل نَسَق"],
    ["document", "مستند مؤسسي داخل محرر نَسَق"],
    ["pages", "شريط صفحات المستند في محرر نَسَق"],
    ["tools", "أدوات التصميم والمكتبة في محرر نَسَق"],
  ];
  const named = slots
    .map(([slot, alt]) => ({ src: (images[slot] ?? "").trim(), alt }))
    .filter((item) => item.src);
  const gallery = (images.gallery ?? [])
    .filter((item) => item.enabled && item.src)
    .map((item) => ({ src: item.src, alt: item.alt || "لقطة من محرر نَسَق" }));
  return [...named, ...gallery];
}

export function ProductWalkthrough() {
  const { images } = useSiteSettings();
  const shots = ownerShots(images);
  const pages = FLAGSHIP.pages;
  const cover = pages[0];
  const rest = pages.slice(1);

  if (!cover) return null;

  return (
    <section className="border-b border-line/70 bg-surface-2 py-14 sm:py-18">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <div className="grid gap-5 lg:grid-cols-[0.85fr_1.15fr] lg:items-end">
          <div>
            <p className="nsq-section-eyebrow">من داخل المحرر</p>
            <h2 className="nsq-section-title mt-2.5 max-w-xl text-[24px] leading-[1.4] sm:text-[30px]">
              صفحات حقيقية من مكتبة القوالب
            </h2>
          </div>
          <p className="max-w-2xl text-[13px] leading-7 text-muted">
            هذه الصفحات مرسومة من قوالب نَسَق المدمجة نفسها التي تفتحها في المحرر —
            غلاف، محتويات، ملخص، مؤشرات، خاتمة. اختر قالبًا، حرّر النصوص والصور، ثم
            راجع المستند وصدّره.
          </p>
        </div>

        {/* ── The stage: the flagship cover, then the rest of its pages ── */}
        <div className="mt-8 grid gap-5 lg:grid-cols-[minmax(0,0.52fr)_minmax(0,0.48fr)] lg:items-stretch">
          <figure className="shadow-card flex flex-col overflow-hidden rounded-[16px] border border-line bg-paper/60">
            <div className="flex items-center justify-between gap-3 border-b border-line/70 px-4 py-3">
              <span className="text-[12px] font-bold text-ink">
                الغلاف — تقرير رسمي متكامل
              </span>
              <span className="rounded-full border border-line bg-surface px-2.5 py-0.5 text-[10px] font-semibold text-muted">
                {FLAGSHIP.pages.length} صفحات · A4
              </span>
            </div>
            <div className="flex flex-1 items-center justify-center p-5 sm:p-7">
              <TemplateSheetPreview
                page={cover}
                height={430}
                className="w-full max-w-[340px]"
              />
            </div>
          </figure>

          <div className="shadow-card flex flex-col overflow-hidden rounded-[16px] border border-line bg-surface">
            <div className="flex items-center justify-between gap-3 border-b border-line/70 px-4 py-3">
              <span className="text-[12px] font-bold text-ink">بنية المستند</span>
              <span className="text-[10.5px] font-semibold text-muted">
                معاينة فعلية لكل صفحة
              </span>
            </div>
            <ul className="flex flex-1 flex-col divide-y divide-line/60">
              {rest.map((page, i) => (
                <li key={page.id ?? i} className="flex flex-1 items-center gap-3 px-4 py-2.5">
                  <TemplateSheetPreview
                    page={page}
                    height={56}
                    className="w-10 shrink-0"
                    paperClassName="shadow-sm"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-bold text-ink">
                      {page.name || `صفحة ${i + 2}`}
                    </span>
                    <span className="mt-0.5 block text-[10.5px] text-muted">
                      صفحة {i + 2} من {pages.length} · قابلة للتحرير
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* ── What each page carries — one caption row, no duplicate cards ── */}
        <div className="mt-5 grid gap-x-6 gap-y-3 sm:grid-cols-3">
          {CAPABILITIES.map(({ icon: Icon, title, copy }) => (
            <div key={title} className="flex items-start gap-3">
              <Icon className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-[12.5px] font-bold text-ink">{title}</p>
                <p className="mt-1 text-[11.5px] leading-6 text-muted">{copy}</p>
              </div>
            </div>
          ))}
        </div>

        {/* ── Owner-uploaded captures, only when they actually exist ── */}
        {shots.length > 0 && (
          <section className="mt-9" aria-label="لقطات من مساحة العمل">
            <div className="mb-3 flex items-end justify-between gap-3">
              <h3 className="text-[15px] font-extrabold text-ink">
                لقطات إضافية من مساحة العمل
              </h3>
              <span className="text-[11px] font-semibold text-muted">
                {shots.length} صورة
              </span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {shots.map((shot) => (
                <figure
                  key={shot.src}
                  className="shadow-card group overflow-hidden rounded-[12px] border border-line bg-surface transition duration-300 hover:-translate-y-0.5 hover:shadow-card-hover motion-reduce:transition-none"
                >
                  <div className="grid h-52 place-items-center overflow-hidden bg-surface-2 p-2">
                    <img
                      src={shot.src}
                      alt={shot.alt}
                      loading="lazy"
                      decoding="async"
                      className="max-h-full max-w-full object-contain transition-transform duration-300 group-hover:scale-[1.02] motion-reduce:transition-none"
                    />
                  </div>
                </figure>
              ))}
            </div>
          </section>
        )}

        <div className="mt-7 flex flex-wrap items-center justify-between gap-3 border-t border-line/70 pt-5">
          <p className="text-[12px] font-semibold text-ink">
            قوالب جاهزة، عناصر قابلة للتحرير، ومكتبة أصول ضمن مساحة العمل نفسها.
          </p>
          <a
            href="/templates"
            className="inline-flex items-center gap-2 text-[12.5px] font-bold text-brand hover:text-brand-hover hover:underline"
          >
            استكشف القوالب <ArrowLeft className="size-4" aria-hidden="true" />
          </a>
        </div>
      </div>
    </section>
  );
}

const ECOSYSTEM = [
  { icon: "templates", title: "القوالب", copy: "نقطة بداية جاهزة" },
  { icon: "library", title: "المكتبة", copy: "أصول قابلة لإعادة الاستخدام" },
  { icon: "editor", title: "المحرر", copy: "تصميم وتحرير المستند" },
  { icon: "pages", title: "الصفحات والمشاريع", copy: "تنظيم العمل وحفظه" },
  { icon: "export", title: "التصدير", copy: "مخرجات للمراجعة والمشاركة" },
] as const;

/**
 * The product flow, as one editorial rail.
 *
 * One connected path (a hairline with a numbered marker per step) instead of a
 * row of five identical bordered cards — the sequence is the information here,
 * so the line carries it and the box chrome is dropped.
 */
export function ProductEcosystem() {
  const icons = {
    templates: LayoutTemplate,
    library: FolderOpen,
    editor: FileText,
    pages: Layers3,
    export: Download,
  } as const;
  return (
    <section className="border-t border-line/70 bg-surface-2 py-14 sm:py-18">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <div className="max-w-2xl">
          <p className="nsq-section-eyebrow">منظومة عمل واحدة</p>
          <h2 className="nsq-section-title mt-2.5 text-[23px] leading-[1.4] sm:text-[28px]">
            من الصفحة الرئيسية إلى مخرج مؤسسي جاهز
          </h2>
          <p className="mt-2 text-[13px] leading-7 text-muted">
            تبدأ من قالب أو مشروع، وتجمع الأصول داخل المكتبة، ثم تحرر الصفحات والعناصر
            وتحفظ المشروع قبل التصدير.
          </p>
        </div>
        <ol className="relative mt-8 grid gap-y-6 sm:grid-cols-2 sm:gap-x-8 lg:grid-cols-5 lg:gap-x-6">
          {/* The rail: one hairline behind the markers on the wide layout. */}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-8 top-4 hidden h-px bg-line lg:block"
          />
          {ECOSYSTEM.map(({ icon, title, copy }, index) => {
            const Icon = icons[icon];
            return (
              <li key={title} className="relative flex gap-3 lg:block">
                <span
                  className={cn(
                    "relative z-10 grid size-8 shrink-0 place-items-center rounded-full border bg-surface text-[11px] font-extrabold text-brand",
                    index === 0 ? "border-brand/60" : "border-line",
                  )}
                  aria-hidden="true"
                >
                  {index + 1}
                </span>
                <div className="min-w-0 lg:mt-3">
                  <strong className="flex items-center gap-2 text-[13px] font-bold text-ink">
                    <Icon className="size-3.5 shrink-0 text-brand" aria-hidden="true" />
                    {title}
                  </strong>
                  <span className="mt-1 block text-[11.5px] leading-5 text-muted">
                    {copy}
                  </span>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}

