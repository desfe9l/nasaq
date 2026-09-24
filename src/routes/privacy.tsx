import { createFileRoute } from "@tanstack/react-router";
import { BRAND } from "@/lib/brand";

export const Route = createFileRoute("/privacy")({
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <main dir="rtl" className="min-h-screen bg-paper px-6 py-16 text-ink">
      <article className="mx-auto max-w-3xl rounded-2xl border border-line bg-white p-8 shadow-xl dark:bg-neutral-950">
        <p className="text-xs font-extrabold uppercase tracking-[0.2em] text-emerald-700">{BRAND.platformEn}</p>
        <h1 className="mt-3 text-3xl font-black">سياسة الخصوصية</h1>
        <p className="mt-3 text-sm text-muted">آخر تحديث: 23 سبتمبر 2026</p>
        <div className="mt-8 space-y-6 text-sm leading-8 text-muted">
          <section>
            <h2 className="text-lg font-extrabold text-ink">ما الذي تجمعه {BRAND.name}؟</h2>
            <p className="mt-2">عند تسجيل الدخول باستخدام Google، نستلم الاسم والبريد الإلكتروني والصورة العامة المرتبطة بحساب Google لإنشاء حسابك وإدارة جلستك.</p>
          </section>
          <section>
            <h2 className="text-lg font-extrabold text-ink">كيف نستخدم المعلومات؟</h2>
            <p className="mt-2">تُستخدم المعلومات لتسجيل الدخول، حماية الحساب، ربط الحسابات المتكررة، وتقديم المشاريع والميزات المرخّصة الخاصة بك. لا نطلب أو نستخدم بيانات Gmail أو Drive أو أي نطاقات Google إضافية.</p>
          </section>
          <section>
            <h2 className="text-lg font-extrabold text-ink">الحفظ والحذف</h2>
            <p className="mt-2">تُحفظ بيانات الحساب والجلسة في البنية الخادمية المخصصة للمنصة. يمكنك طلب حذف حسابك وبياناته عبر صفحة التواصل في {BRAND.name}.</p>
          </section>
          <section>
            <h2 className="text-lg font-extrabold text-ink">التواصل</h2>
            <p className="mt-2">للاستفسارات المتعلقة بالخصوصية، استخدم صفحة التواصل في الموقع.</p>
          </section>
        </div>
      </article>
    </main>
  );
}
