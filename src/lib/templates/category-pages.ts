/*
 * The six public category pages.
 *
 * WHY A CURATED SIX, NOT FOURTEEN
 * -------------------------------
 * `TEMPLATE_CATEGORIES` is the generator's taxonomy: every page template has
 * exactly one of its fourteen ids, and the gallery filters by them. That is the
 * right internal model and the wrong public navigation — a visitor does not
 * choose between «بيانات» and «تنفيذية», they look for a cover, a report, a
 * presentation, numbers, a table, or an infographic.
 *
 * So each surface below maps to one or more of the generator's OWN categories
 * (never a new id, never a new template record) and adds what a category page
 * needs: why it exists, who it is for, and which sibling to visit next. The
 * gallery keeps its full fourteen-way filter; this is the six-way public door.
 */

import type { TemplateCategoryId } from "@/lib/editor/templates";

export interface TemplateCategorySurface {
  /** URL segment: `/templates/category/<id>`. */
  id: string;
  title: string;
  /** One line under the title — what this family is FOR. */
  purpose: string;
  /** Who usually starts here — shown as a chip row. */
  audience: string[];
  /** The generator's categories collected under this surface. */
  categories: TemplateCategoryId[];
  /** The pill that opens the same family in the gallery. */
  galleryPill?: string;
  /** Honest starting advice, not marketing. */
  startHere: string;
}

export const TEMPLATE_CATEGORY_SURFACES: readonly TemplateCategorySurface[] = [
  {
    id: "covers",
    title: "أغلفة التقارير",
    purpose: "أول صفحة يراها القارئ: عنوان الجهة، واسم التقرير، وتاريخ الاعتماد.",
    audience: ["التقارير السنوية", "تقارير الأداء", "الملفات الرسمية"],
    categories: ["covers"],
    galleryPill: "annual",
    startHere: "ابدأ بالغلاف ثم أضف الصفحات الداخلية من نفس الفئة.",
  },
  {
    id: "reports",
    title: "تقارير رسمية",
    purpose: "صفحات نصية ومحاضر وملخصات تنفيذية جاهزة للكتابة والاعتماد.",
    audience: ["الإدارات", "مكاتب التقارير", "اللجان"],
    categories: ["reports", "editorial", "executive"],
    galleryPill: "annual",
    startHere: "اختر صفحة نصية أو ملخصًا تنفيذيًا وأضف الجداول من فئة الجداول.",
  },
  {
    id: "presentations",
    title: "عروض تقديمية",
    purpose: "شرائح 16:9 للاجتماعات القيادية والعروض الختامية.",
    audience: ["الاجتماعات القيادية", "العروض الختامية", "ورش العمل"],
    categories: ["slides"],
    galleryPill: "presentations",
    startHere: "ابدأ بشريحة الغلاف ثم شريحة مؤشرات، وأكمل بالشرائح الداخلية.",
  },
  {
    id: "numbers",
    title: "مؤشرات وأرقام",
    purpose: "بطاقات مؤشرات ولوحات أداء تعرض الرقم ومعناه في سطر واحد.",
    audience: ["تقارير الأداء", "لوحات المؤشرات", "المتابعة الشهرية"],
    categories: ["kpis", "stats", "data"],
    galleryPill: "annual",
    startHere: "اجمع بين لوحة مؤشرات وقراءة إحصائية لتغطية الرقم وتفسيره.",
  },
  {
    id: "tables",
    title: "جداول وبيانات",
    purpose: "جداول قابلة للتحرير بحقول واضحة، جاهزة للالتقاط من Excel أو إدخالها يدويًا.",
    audience: ["الميزانيات", "المقارنات", "المواءمة التشغيلية"],
    categories: ["tables"],
    galleryPill: "annual",
    startHere: "الجدول في نَسَق عنصر حقيقي: تحرّر خلاياه ولا تصور جدولًا بصورة.",
  },
  {
    id: "infographics",
    title: "إنفوجرافيك",
    purpose: "مسارات ومراحل وتكوينات بصرية تحوّل الإجراء إلى صورة مفهومة.",
    audience: ["الخطط التشغيلية", "المبادرات", "الأثر والنتائج"],
    categories: ["infographics", "timeline"],
    galleryPill: "infographic",
    startHere: "استخدم صفحة مراحل للخطة، وصفحة مسار للنتائج.",
  },
];

export function categorySurface(id: string): TemplateCategorySurface | undefined {
  return TEMPLATE_CATEGORY_SURFACES.find((surface) => surface.id === id);
}
