import {
  ArrowLeft,
  FileText,
  Files,
  Presentation,
  Table2,
  LayoutTemplate,
  FileUp,
  Award,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { DocKindId } from "@/lib/editor/new-document";

export type SemanticDocType = DocKindId | "import";

export interface SemanticDocItem {
  id: SemanticDocType;
  title: string;
  desc: string;
  badge: string;
  action: string;
}

export const SEMANTIC_DOC_ITEMS: SemanticDocItem[] = [
  {
    id: "report",
    title: "تقرير رسمي متكامل",
    desc: "إعداد تقارير أداء ومخرجات سنوية بهوية مؤسسية جاهزة للطباعة 300 DPI.",
    badge: "A4 رأسي · قالب رسمي",
    action: "بدء التقرير",
  },
  {
    id: "letter",
    title: "خطاب وتعميم إداري",
    desc: "خطابات رسمية وقرارات إدارية برأس وتذييل مؤسسي موثق وترقيم معتمد.",
    badge: "A4 رأسي · مراسلات",
    action: "صياغة الخطاب",
  },
  {
    id: "presentation",
    title: "عرض شرائح تنفيذي",
    desc: "شرائح بصرية متناسقة للاجتماعات والعروض التنفيذية بنسبة عرض 16:9.",
    badge: "شاشة عريضة 16:9",
    action: "بناء العرض",
  },
  {
    id: "sheet",
    title: "لوحة مؤشرات وجداول",
    desc: "تنظيم الجداول والبيانات الرقمية والمؤشرات بتنسيق عريض ومقروء.",
    badge: "A4 أفقي · بيانات",
    action: "إنشاء الجدول",
  },
  {
    id: "poster",
    title: "ملصق ولوحة إرشادية",
    desc: "إعلانات ولوحات إرشادية وإعلامية بقياس A3 عالي الوضوح للعرض والطباعة.",
    badge: "A3 رأسي · إعلامي",
    action: "تصميم الملصق",
  },
  {
    id: "import",
    title: "استيراد وتحويل فوري",
    desc: "تحويل ملفات PDF وWord وPowerPoint وExcel إلى مستند نَسَق قابل للتحرير.",
    badge: "تحويل ذكي فوري",
    action: "رفع الملف",
  },
];

/**
 * Geometric miniature simulating the output type (concentric geometry, zero icon ambiguity).
 */
export function MicroDocPreview({
  type,
  className,
}: {
  type: SemanticDocType;
  className?: string;
}) {
  switch (type) {
    case "report":
      return (
        <div
          className={cn(
            "relative flex flex-col justify-between overflow-hidden rounded-[5px] border border-line bg-paper p-1.5 shadow-xs transition-transform group-hover:scale-[1.03]",
            "aspect-[210/297] w-12 sm:w-14",
            className,
          )}
          aria-hidden="true"
        >
          <div className="h-1.5 w-full rounded-xs bg-navy/80" />
          <div className="space-y-1 my-auto">
            <div className="h-1 w-3/4 rounded-xs bg-line" />
            <div className="h-1 w-full rounded-xs bg-line/60" />
            <div className="h-1 w-1/2 rounded-xs bg-line/40" />
          </div>
          <div className="flex items-center justify-between border-t border-line/40 pt-0.5">
            <div className="h-0.5 w-2 rounded-xs bg-gold/70" />
            <div className="h-0.5 w-1 rounded-xs bg-muted/60" />
          </div>
        </div>
      );

    case "letter":
      return (
        <div
          className={cn(
            "relative flex flex-col justify-between overflow-hidden rounded-[5px] border border-line bg-paper p-1.5 shadow-xs transition-transform group-hover:scale-[1.03]",
            "aspect-[210/297] w-12 sm:w-14",
            className,
          )}
          aria-hidden="true"
        >
          <div className="flex items-center justify-between">
            <div className="size-2 rounded-full border border-navy/40 bg-navy/10" />
            <div className="h-1 w-4 rounded-xs bg-line" />
          </div>
          <div className="space-y-1 my-auto">
            <div className="h-1 w-full rounded-xs bg-line/70" />
            <div className="h-1 w-5/6 rounded-xs bg-line/60" />
            <div className="h-1 w-4/5 rounded-xs bg-line/50" />
          </div>
          <div className="flex justify-end">
            <div className="size-2.5 rounded-full border border-gold/60 bg-gold/15" />
          </div>
        </div>
      );

    case "presentation":
      return (
        <div
          className={cn(
            "relative flex flex-col justify-between overflow-hidden rounded-[5px] border border-line bg-surface-2 p-1.5 shadow-xs transition-transform group-hover:scale-[1.03]",
            "aspect-[16/9] w-14 sm:w-16",
            className,
          )}
          aria-hidden="true"
        >
          <div className="flex items-center justify-between">
            <div className="h-1 w-1/3 rounded-xs bg-navy/80" />
            <div className="h-1 w-1.5 rounded-xs bg-gold/80" />
          </div>
          <div className="grid grid-cols-2 gap-1 my-auto">
            <div className="rounded-xs border border-line/70 bg-surface p-0.5">
              <div className="h-1.5 w-full rounded-xs bg-navy/20" />
            </div>
            <div className="rounded-xs border border-line/70 bg-surface p-0.5">
              <div className="h-1.5 w-full rounded-xs bg-gold/20" />
            </div>
          </div>
          <div className="h-0.5 w-full rounded-xs bg-line/50" />
        </div>
      );

    case "sheet":
      return (
        <div
          className={cn(
            "relative flex flex-col justify-between overflow-hidden rounded-[5px] border border-line bg-paper p-1 shadow-xs transition-transform group-hover:scale-[1.03]",
            "aspect-[297/210] w-14 sm:w-16",
            className,
          )}
          aria-hidden="true"
        >
          <div className="grid grid-cols-3 gap-0.5 rounded-xs bg-navy/15 p-0.5">
            <div className="h-1 rounded-xs bg-navy/70" />
            <div className="h-1 rounded-xs bg-navy/70" />
            <div className="h-1 rounded-xs bg-navy/70" />
          </div>
          <div className="grid grid-cols-3 gap-0.5 my-auto">
            <div className="h-1 rounded-xs bg-line" />
            <div className="h-1 rounded-xs bg-line/70" />
            <div className="h-1 rounded-xs bg-line/50" />
            <div className="h-1 rounded-xs bg-line/80" />
            <div className="h-1 rounded-xs bg-line" />
            <div className="h-1 rounded-xs bg-line/60" />
          </div>
          <div className="h-0.5 w-1/2 rounded-xs bg-gold/70" />
        </div>
      );

    case "poster":
      return (
        <div
          className={cn(
            "relative flex flex-col justify-between overflow-hidden rounded-[5px] border border-line bg-paper p-1.5 shadow-xs transition-transform group-hover:scale-[1.03]",
            "aspect-[297/420] w-11 sm:w-13",
            className,
          )}
          aria-hidden="true"
        >
          <div className="h-2 w-full rounded-xs bg-navy" />
          <div className="my-auto rounded-xs border border-line bg-surface-2 p-1">
            <div className="h-3 w-full rounded-xs bg-gold/20" />
          </div>
          <div className="h-1 w-3/4 rounded-xs bg-line" />
        </div>
      );

    case "import":
      return (
        <div
          className={cn(
            "relative flex flex-col items-center justify-center overflow-hidden rounded-[5px] border-2 border-dashed border-gold/70 bg-gold/10 p-1.5 shadow-xs transition-transform group-hover:scale-[1.03]",
            "aspect-[210/297] w-12 sm:w-14",
            className,
          )}
          aria-hidden="true"
        >
          <FileUp className="size-4 text-gold mb-1" />
          <div className="h-0.5 w-4 rounded-xs bg-gold/80" />
        </div>
      );
  }
}

/**
 * 4-element semantic card adhering strictly to the Anti-Icon-Only Ambiguity law.
 */
export function SemanticDocCard({
  item,
  active = false,
  onClick,
  href,
  className,
}: {
  item: SemanticDocItem;
  active?: boolean;
  onClick?: () => void;
  href?: string;
  className?: string;
}) {
  const content = (
    <div
      className={cn(
        "group relative flex w-full flex-col justify-between rounded-2xl border p-4 sm:p-5 text-start transition-all duration-200",
        "hover:-translate-y-0.5 hover:shadow-card-hover active:scale-[0.98]",
        active
          ? "border-brand bg-navy/[0.06] shadow-card ring-2 ring-brand/30"
          : "border-line bg-surface hover:border-brand/60",
        className,
      )}
    >
      {/* 1. Header with Micro-Preview & Badge */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <MicroDocPreview type={item.id} />
          <div>
            <span className="inline-block rounded-full border border-line/80 bg-surface-2 px-2 py-0.5 text-[10px] font-bold text-muted">
              {item.badge}
            </span>
            <h4 className="mt-1 text-sm sm:text-base font-bold text-ink">
              {item.title}
            </h4>
          </div>
        </div>
      </div>

      {/* 2. Executive Function Description */}
      <p className="mt-2.5 text-xs text-muted leading-relaxed line-clamp-2">
        {item.desc}
      </p>

      {/* 3. Action Indicator Row */}
      <div className="mt-3.5 flex items-center justify-between border-t border-line/60 pt-3">
        <span className="text-[11px] font-extrabold text-brand group-hover:text-brand-hover">
          {item.action}
        </span>
        <ArrowLeft className="size-3.5 text-brand transition-transform group-hover:-translate-x-1" />
      </div>
    </div>
  );

  if (href) {
    return (
      <a href={href} className="block text-inherit no-underline">
        {content}
      </a>
    );
  }

  return (
    <button type="button" onClick={onClick} className="block w-full text-inherit">
      {content}
    </button>
  );
}
