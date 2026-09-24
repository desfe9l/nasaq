import { createFileRoute } from "@tanstack/react-router";
import { BRAND } from "@/lib/brand";

export const Route = createFileRoute("/terms")({
  component: TermsPage,
});

function TermsPage() {
  return (
    <main dir="rtl" className="min-h-screen bg-paper px-6 py-16 text-ink">
      <article className="mx-auto max-w-3xl rounded-2xl border border-line bg-white p-8 shadow-xl dark:bg-neutral-950">
        <p className="text-xs font-extrabold uppercase tracking-[0.2em] text-emerald-700">{BRAND.platformEn}</p>
        <h1 className="mt-3 text-3xl font-black">شروط الاستخدام</h1>
        <p className="mt-3 text-sm text-muted">آخر تحديث: 23 سبتمبر 2026</p>
        <div className="mt-8 space-y-6 text-sm leading-8 text-muted">
          <section>
            <h2 className="text-lg font-extrabold text-ink">استخدام المنصة</h2>
            <p className="mt-2">باستخدام {BRAND.name}، تتعهد بتقديم معلومات صحيحة والحفاظ على أمان حسابك وعدم استخدام المنصة بطريقة مخالفة للأنظمة أو حقوق الآخرين.</p>
          </section>
          <section>
            <h2 className="text-lg font-extrabold text-ink">الحساب والمحتوى</h2>
            <p className="mt-2">أنت مسؤول عن الحساب والمحتوى الذي تنشئه أو ترفعه. تبقى حقوقك في محتواك محفوظة، وتمنح المنصة الإذن التقني اللازم لتقديم الخدمة وحفظ المشاريع المرخّصة.</p>
          </section>
          <section>
            <h2 className="text-lg font-extrabold text-ink">الخدمة والتراخيص</h2>
            <p className="mt-2">تخضع الميزات المدفوعة والحدود والاستخدام لشروط الترخيص المعروضة عند الشراء. قد تتغير الخدمة لتحسين الأمان والأداء دون المساس بالوظائف الأساسية المعلنة.</p>
          </section>
          <section>
            <h2 className="text-lg font-extrabold text-ink">التواصل</h2>
            <p className="mt-2">للاستفسارات حول هذه الشروط، استخدم صفحة التواصل في الموقع.</p>
          </section>
        </div>
      </article>
    </main>
  );
}
