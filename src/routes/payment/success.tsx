import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { getMyPaylinkTransaction } from "@/lib/commercial/functions";
import { SiteFooter, SiteHeader } from "@/components/site/SiteChrome";

export default function PaymentSuccessPage() {
  const [transactionNo, setTransactionNo] = useState("");
  const [status, setStatus] = useState<"LOADING" | "PAID" | "PENDING" | "FAILED">("LOADING");
  const [licenseKey, setLicenseKey] = useState<string | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const value = params.get("TransactionNo") || params.get("transactionNo") || "";
    setTransactionNo(value);
    let active = true;
    const poll = async () => {
      try {
        const result = await getMyPaylinkTransaction({ data: value ? { transactionNo: value } : {} });
        if (!active) return;
        if (!result) { setStatus("PENDING"); return; }
        setLicenseKey(result.licenseKey);
        setStatus(result.status === "PAID" ? "PAID" : result.status === "FAILED" || result.status === "CANCELED" ? "FAILED" : "PENDING");
      } catch { if (active) setStatus("PENDING"); }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 2500);
    return () => { active = false; window.clearInterval(timer); };
  }, []);
  return <div className="min-h-screen bg-paper"><SiteHeader current="/purchase" /><main className="mx-auto max-w-xl px-4 py-24 text-center"><div className="rounded-2xl border border-line bg-surface p-8 shadow-sm dark:border-white/10">{status === "PAID" ? <><h1 className="text-2xl font-extrabold text-ok">تم تأكيد الدفع بنجاح</h1><p className="mt-3 text-sm leading-7 text-muted">تم إنشاء ترخيص Keygen وربطه بحسابك.</p>{licenseKey && <p className="mt-4 rounded-lg bg-paper p-3 text-sm font-bold" dir="ltr">{licenseKey}</p>}<a href="/license" className="mt-6 inline-flex h-11 items-center justify-center rounded-xl bg-emerald-600 px-6 text-sm font-extrabold text-white">عرض الترخيص</a></> : status === "FAILED" ? <><h1 className="text-2xl font-extrabold text-danger">لم نتمكن من تأكيد الدفع</h1><p className="mt-3 text-sm leading-7 text-muted">لن يتم تفعيل أي ترخيص قبل تأكيد Paylink.</p><a href="/purchase" className="mt-6 inline-flex h-11 items-center justify-center rounded-xl bg-navy px-6 text-sm font-extrabold text-white">العودة إلى الباقات</a></> : <><h1 className="text-2xl font-extrabold">جارٍ تأكيد الدفع</h1><p className="mt-3 text-sm leading-7 text-muted">ننتظر تأكيد Paylink ثم تفعيل ترخيص Keygen.</p>{transactionNo && <p className="mt-4 text-xs text-muted" dir="ltr">Transaction: {transactionNo}</p>}</>}</div></main><SiteFooter /></div>;
}

export const Route = createFileRoute("/payment/success")({ ssr: false, component: PaymentSuccessPage });
