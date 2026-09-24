import { createFileRoute } from "@tanstack/react-router";
import { SiteFooter, SiteHeader } from "@/components/site/SiteChrome";

export default function PaymentCancelPage() {
  return <div className="min-h-screen bg-paper"><SiteHeader current="/purchase" /><main className="mx-auto max-w-xl px-4 py-24 text-center"><div className="rounded-2xl border border-line bg-surface p-8 shadow-sm dark:border-white/10"><h1 className="text-2xl font-extrabold">تم إلغاء الدفع</h1><p className="mt-3 text-sm leading-7 text-muted">لم يتم خصم أي مبلغ، ولم يتم إنشاء أو تفعيل ترخيص.</p><a href="/purchase" className="mt-6 inline-flex h-11 items-center justify-center rounded-xl bg-navy px-6 text-sm font-extrabold text-white">العودة إلى الباقات</a></div></main><SiteFooter /></div>;
}

export const Route = createFileRoute("/payment/cancel")({ ssr: false, component: PaymentCancelPage });
