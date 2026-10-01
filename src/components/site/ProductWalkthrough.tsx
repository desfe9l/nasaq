import {
  ArrowLeft,
  Download,
  FileText,
  FolderOpen,
  Layers3,
  LayoutTemplate,
  Shapes,
} from "lucide-react";
import { useSiteSettings } from "@/lib/admin/use-site-settings";
import {
  DEFAULT_SITE_IMAGES,
  SITE_IMAGE_SLOTS,
  type SiteImages,
} from "@/lib/admin/types";

/**
 * The walkthrough's four captions.
 *
 * The IMAGE for each card is owner-managed (site_settings → `images`), so the
 * artwork lives beside only its words here; `slot` is the key that pairs them.
 */
const PREVIEWS = [
  {
    slot: "document",
    alt: "لقطة فعلية من مساحة تحرير المستند المؤسسي",
    icon: FileText,
    title: "مستند مؤسسي داخل المحرر",
    copy: "صفحة تقرير عربية مفتوحة على لوحة العمل، مع رأس وتذييل ومحتوى قابل للتحرير.",
  },
  {
    slot: "pages",
    alt: "شريط صفحات المستند في محرر نَسَق",
    icon: Layers3,
    title: "الصفحات وبنية المستند",
    copy: "معاينة شريط الصفحات الفعلي؛ أضف الصفحات ورتّبها وانتقل بينها من مساحة العمل.",
  },
  {
    slot: "tools",
    alt: "لوحة أدوات المحرر الفعلية وتبويبات المكتبة والقوالب والأشكال",
    icon: Shapes,
    title: "أدوات التصميم والمكتبة",
    copy: "تظهر لوحة الأشكال وتبويبات المكتبة والقوالب كما هي في المحرر، لا كواجهة تسويقية مرسومة.",
  },
] as const satisfies ReadonlyArray<{
  slot: keyof SiteImages;
  alt: string;
  icon: typeof FileText;
  title: string;
  copy: string;
}>;

/** Bundled artwork for a slot, used when the owner has not uploaded one. */
function fallbackFor(slot: keyof SiteImages): string {
  return (
    SITE_IMAGE_SLOTS.find((entry) => entry.id === slot)?.fallback ??
    "/editor-previews/document.png"
  );
}

/** Real editor captures, owned by the site owner and dimension-free on screen. */
export function ProductWalkthrough() {
  /*
   * Owner-managed imagery. `images` starts empty (the bundled artwork), so a
   * first paint never waits on the settings fetch and a failed fetch degrades
   * to the shipped captures rather than to a broken image.
   */
  const { images } = useSiteSettings();
  const slotSrc = (slot: keyof SiteImages) =>
    images?.[slot]?.trim() ? images[slot].trim() : fallbackFor(slot);
  void DEFAULT_SITE_IMAGES;
  return (
    <section className="border-b border-line/70 bg-surface-2 py-14 sm:py-18">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <div className="grid gap-5 lg:grid-cols-[0.8fr_1.2fr] lg:items-end">
          <div>
            <p className="text-[11px] font-bold tracking-[0.14em] text-brand">من داخل المحرر</p>
            <h2 className="mt-2 max-w-xl text-[24px] font-extrabold leading-[1.4] text-ink sm:text-[30px]">
              مساحة عمل حقيقية للتقارير والوثائق المؤسسية
            </h2>
          </div>
          <p className="max-w-2xl text-[13px] leading-7 text-muted">
            هذه لقطات من واجهة NASAQ الحالية: الصفحة على اللوحة، شريط الصفحات، ولوحة الأدوات. اختر قالبًا، حرّر النصوص والعناصر، ثم راجع المستند وصدّره.
          </p>
        </div>

        <figure className="mt-8 overflow-hidden rounded-[16px] border border-line bg-surface shadow-card">
          <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
            <div className="flex items-center gap-2">
              <span className="grid size-8 place-items-center rounded-[9px] bg-navy/5 text-brand"><FileText className="size-4" /></span>
              <div>
                <figcaption className="text-[12px] font-bold text-ink">واجهة المحرر — تقرير أداء مؤسسي</figcaption>
                <p className="mt-0.5 text-[10px] text-muted">لقطة فعلية من مساحة العمل</p>
              </div>
            </div>
            <span className="hidden rounded-full border border-line px-3 py-1 text-[10px] font-semibold text-muted sm:inline-flex">المحرر · الصفحات · الأدوات</span>
          </div>
          {/*
           * No intrinsic width/height and no fixed aspect: the owner's upload
           * keeps its own proportions and the frame grows with it, so a wide
           * desktop capture and a portrait iPad capture both render intact.
           */}
          <img
            src={slotSrc("workspace")}
            alt="لقطة حقيقية للمحرر: مستند على اللوحة، الأدوات والصفحات الجانبية"
            loading="lazy"
            className="block h-auto max-h-[620px] w-full bg-surface-2 object-contain"
          />
        </figure>

        <div className="mt-5 grid gap-4 md:grid-cols-3">
          {PREVIEWS.map(({ slot, alt, icon: Icon, title, copy }) => (
            <article key={title} className="overflow-hidden rounded-[14px] border border-line bg-surface">
              {/*
               * A fixed-height stage with `object-contain`: any aspect ratio
               * the owner uploads fits the card without cropping or stretching,
               * and every card stays the same height so the row stays even.
               */}
              <div className="grid h-44 place-items-center overflow-hidden border-b border-line bg-surface-2 p-2">
                <img
                  src={slotSrc(slot)}
                  alt={alt}
                  loading="lazy"
                  className="max-h-full max-w-full object-contain"
                />
              </div>
              <div className="p-4">
                <div className="flex items-center gap-2">
                  <Icon className="size-4 shrink-0 text-brand" aria-hidden="true" />
                  <h3 className="text-[13px] font-bold text-ink">{title}</h3>
                </div>
                <p className="mt-2 text-[11px] leading-6 text-muted">{copy}</p>
              </div>
            </article>
          ))}
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-line bg-page px-4 py-3 sm:px-5">
          <p className="text-[12px] font-semibold text-ink">قوالب جاهزة، عناصر قابلة للتحرير، ومكتبة أصول ضمن مساحة العمل نفسها.</p>
          <a href="/templates" className="inline-flex items-center gap-2 text-[12px] font-bold text-brand hover:underline">
            استكشف القوالب <ArrowLeft className="size-4" aria-hidden="true" />
          </a>
        </div>
      </div>
    </section>
  );
}

const ECOSYSTEM = [
  { icon: LayoutTemplate, title: "القوالب", copy: "نقطة بداية جاهزة" },
  { icon: FolderOpen, title: "المكتبة", copy: "أصول قابلة لإعادة الاستخدام" },
  { icon: FileText, title: "المحرر", copy: "تصميم وتحرير المستند" },
  { icon: Layers3, title: "الصفحات والمشاريع", copy: "تنظيم العمل وحفظه" },
  { icon: Download, title: "التصدير", copy: "مخرجات للمراجعة والمشاركة" },
] as const;

/** A restrained map of the real product flow, not a decorative fake dashboard. */
export function ProductEcosystem() {
  return (
    <section className="border-t border-line/70 bg-surface-2 py-14 sm:py-18">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <div className="max-w-2xl">
          <p className="text-[11px] font-bold tracking-[0.14em] text-brand">منظومة عمل واحدة</p>
          <h2 className="mt-2 text-[23px] font-extrabold leading-[1.4] text-ink sm:text-[28px]">من الصفحة الرئيسية إلى مخرج مؤسسي جاهز</h2>
          <p className="mt-2 text-[13px] leading-7 text-muted">تبدأ من قالب أو مشروع، وتجمع الأصول داخل المكتبة، ثم تحرر الصفحات والعناصر وتحفظ المشروع قبل التصدير.</p>
        </div>
        <ol className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {ECOSYSTEM.map(({ icon: Icon, title, copy }, index) => (
            <li key={title} className="relative flex min-h-[126px] flex-col rounded-[13px] border border-line bg-surface p-4">
              <div className="flex items-center justify-between">
                <span className="grid size-9 place-items-center rounded-[10px] border border-brand/10 bg-navy/5 text-brand"><Icon className="size-4" aria-hidden="true" /></span>
                <span className="font-mono text-[10px] font-bold text-muted">0{index + 1}</span>
              </div>
              <strong className="mt-4 text-[13px] font-bold text-ink">{title}</strong>
              <span className="mt-1 text-[11px] leading-5 text-muted">{copy}</span>
              {index < ECOSYSTEM.length - 1 && <ArrowLeft className="absolute -left-[11px] top-8 hidden size-5 bg-surface-2 p-0.5 text-muted lg:block" aria-hidden="true" />}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
