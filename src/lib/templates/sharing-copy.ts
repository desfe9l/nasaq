/**
 * Arabic-first social copy for an already-published template.
 *
 * Purpose comes from the template's description/category; the value statement
 * is based on its real editable payload (page count, tables, metrics, slides or
 * vector artwork), never on unrelated marketing claims.
 */

import { BRAND } from "@/lib/brand";
import { templateCategoryLabel } from "@/lib/templates/naming";
import { shortPublishedTemplateAbsoluteUrl } from "@/lib/templates/published";
import { templateShareImage } from "@/lib/templates/share-image";

export interface ShareableTemplate {
  id: string;
  slug?: string | null;
  title: string;
  description?: string | null;
  category?: string | null;
  kind?: string | null;
  thumbnail?: string | null;
  content?: string;
}

export interface TemplateShareCopy {
  url: string;
  mediaUrl: string;
  title: string;
  category: string;
  purpose: string;
  keyValue: string;
  tweet: string;
  pinterestTitle: string;
  pinterestDescription: string;
}

function plainText(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function fit(value: string, limit: number): string {
  const text = plainText(value);
  if (text.length <= limit) return text;
  const shortened = text.slice(0, limit - 1).replace(/\s+\S*$/, "").trim();
  return `${shortened || text.slice(0, limit - 1)}…`;
}

function parseDocument(content: unknown): Record<string, unknown> | null {
  if (content && typeof content === "object" && !Array.isArray(content)) {
    return content as Record<string, unknown>;
  }
  if (typeof content !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(content);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function elementStats(template: ShareableTemplate): {
  pages: number;
  tables: number;
  metrics: number;
  wide: boolean;
} {
  const document = parseDocument(template.content);
  const pages = Array.isArray(document?.pages) ? document.pages : [];
  let tables = 0;
  let metrics = 0;
  const visit = (items: unknown[], depth = 0) => {
    if (depth > 10) return;
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      const element = item as Record<string, unknown>;
      if (element.type === "table") tables += 1;
      if (element.type === "stat" || element.type === "progress" || element.type === "chart") metrics += 1;
      if (Array.isArray(element.children)) visit(element.children, depth + 1);
    }
  };
  for (const page of pages) {
    if (!page || typeof page !== "object") continue;
    const elements = (page as Record<string, unknown>).elements;
    if (Array.isArray(elements)) visit(elements);
  }
  const first = pages[0] && typeof pages[0] === "object" ? (pages[0] as Record<string, unknown>) : null;
  const width = Number(first?.w);
  const height = Number(first?.h);
  return {
    pages: pages.length,
    tables,
    metrics,
    wide: Number.isFinite(width) && Number.isFinite(height) && width > height * 1.4,
  };
}

function purposeFor(template: ShareableTemplate, category: string): string {
  const description = plainText(template.description);
  if (description && !/^(?:قالب جديد|new template|untitled|template\s*\d*|محوّل|محوَّل|converted|imported)(?:$|\s)/i.test(description)) {
    return fit(description.replace(/[.!؟]+$/, ""), 58);
  }
  const context = `${template.title} ${category}`.toLocaleLowerCase();
  if (/ربع\s*سنوي|quarterly|\bq[1-4]\b/.test(context) && /أداء|performance|مؤشر/.test(context)) {
    return "لإبراز نتائج الأداء ومتابعة مؤشرات الربع";
  }
  if (/سيرة|resume|\bcv\b/.test(context)) return "لتقديم السيرة الذاتية بصورة مرتبة وواضحة";
  if (/قيادي|تنفيذي|executive|leadership/.test(context)) return "لعرض الأولويات والقرارات القيادية بوضوح";
  if (/خطاب|letter|مراسلات/.test(context)) return "لصياغة المخاطبات الرسمية ضمن هوية موحدة";
  if (/مؤشر|أداء|kpi|إحصائيات|بيانات/.test(context)) return "لتقديم مؤشرات الأداء والنتائج بصورة منظمة";
  if (/عرض|شرائح|slides/.test(context)) return "لعرض الأفكار والنتائج بأسلوب مؤسسي";
  if (/جدول|table/.test(context)) return "لتنظيم البيانات في جداول واضحة وقابلة للتحديث";
  if (/غلاف|cover/.test(context)) return "لإبراز هوية التقرير وموضوعه من الصفحة الأولى";
  if (/تقارير|تقرير|report/.test(context)) return "لإعداد تقرير مؤسسي منظم وسهل التخصيص";
  return `لإعداد مخرجات ${category} بهوية مؤسسية متسقة`;
}

function valueFor(template: ShareableTemplate, stats: ReturnType<typeof elementStats>, category: string): string {
  const context = `${template.title} ${category}`.toLocaleLowerCase();
  const svg = template.kind === "svg" || /^\s*<svg\b/i.test(template.content || "");
  if (svg) return "تصميم متجهي يحافظ على وضوحه عند تغيير الحجم";
  if (stats.metrics || /مؤشر|أداء|kpi|إحصائيات/.test(context)) {
    return "مؤشرات ونتائج ضمن بنية قابلة للتحرير";
  }
  if (stats.tables) return "جداول قابلة للتحرير لتنظيم البيانات بوضوح";
  if (stats.wide || /عروض|شرائح|slides/.test(context)) {
    return "شرائح قابلة للتخصيص بما يلائم هوية الجهة";
  }
  if (stats.pages) {
    return `بنية من ${stats.pages} ${stats.pages === 1 ? "صفحة" : "صفحات"} قابلة للتحرير والتخصيص`;
  }
  return "محتوى منظم قابل للتخصيص وفق هوية الجهة";
}

/** Keep the selected template URL attached if an author removes it while editing. */
export function ensureTemplateShareUrl(text: string, url: string): string {
  const trimmed = text.trim();
  return trimmed.includes(url) ? text : `${trimmed}\n${url}`.trim();
}

/** Build an editable X draft and complete Pinterest pin metadata. */
export function buildTemplateShareCopy(
  template: ShareableTemplate,
  origin?: string,
): TemplateShareCopy {
  const url = shortPublishedTemplateAbsoluteUrl(template, origin);
  const title = plainText(template.title) || "قالب مؤسسي";
  const category = templateCategoryLabel(template.category);
  const purpose = purposeFor(template, category);
  const keyValue = valueFor(template, elementStats(template), category);
  const tweet = [
    `قالب «${fit(title, 58)}» من ${BRAND.platform} · ${fit(category, 20)}.`,
    fit(purpose, 48),
    fit(keyValue, 45),
    url,
  ].join("\n");
  const pinterestTitle = fit(`${title} | ${category}`, 100);
  const pinterestDescription = [
    `قالب ${category}. ${purpose}. ${keyValue}.`,
    url,
  ].join("\n");
  const mediaUrl = templateShareImage(template.id, template.thumbnail).url;
  return {
    url,
    mediaUrl,
    title,
    category,
    purpose,
    keyValue,
    tweet,
    pinterestTitle,
    pinterestDescription,
  };
}
