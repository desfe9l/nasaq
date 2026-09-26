import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, CreditCard, ExternalLink, RefreshCw, Webhook } from "lucide-react";
import { toast } from "sonner";
import {
  getGumroadGatewayStatusFn,
  syncGumroadSubscriptionFn,
  testGumroadPingFn,
  testGumroadVerificationFn,
} from "@/lib/gumroad/functions";
import type { GumroadGatewayStatus, GumroadReadyState } from "@/lib/gumroad/types";
import { cn } from "@/lib/utils";

/** Owner vault card: Gumroad · بوابة الدفع. Statuses only — never a secret. */
export function GumroadGatewayCard({ visible }: { visible: boolean }) {
  const [status, setStatus] = useState<GumroadGatewayStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [syncEmail, setSyncEmail] = useState("");

  const load = useCallback(async () => {
    setError(null);
    try {
      setStatus(await getGumroadGatewayStatusFn());
    } catch {
      setError("تعذر تحميل حالة بوابة Gumroad (تحقق من صلاحيات المالك).");
    }
  }, []);

  useEffect(() => {
    if (visible && !status && !error) void load();
  }, [visible, status, error, load]);

  async function run(key: string, action: () => Promise<void>) {
    setBusy(key);
    try {
      await action();
    } finally {
      setBusy(null);
    }
  }

  if (!visible) return null;

  return (
    <section className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.035]" aria-label="Gumroad بوابة الدفع">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 p-4">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl border border-pink-300/30 bg-pink-300/10 text-pink-200"><CreditCard className="size-5" /></span>
          <div>
            <h3 className="text-sm font-black text-white">Gumroad · بوابة الدفع</h3>
            <p className="mt-0.5 text-[11px] text-slate-400">
              مزوّد الدفع الوحيد — المنتج {status ? status.product.permalink : "…"}
              {status?.mode ? ` · ${status.mode}` : ""}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          <button type="button" onClick={() => void load()} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/15 px-3 text-[11px] font-black text-slate-200 hover:border-pink-300/50">
            <RefreshCw className={cn("size-3.5", busy === "load" && "animate-spin")} /> تحديث
          </button>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void run("ping", async () => {
              const result = await testGumroadPingFn();
              if (result.ok) toast.success(`فحص Ping: HTTP ${result.httpStatus} — البوابة ترد بنجاح.`);
              else toast.error(`فحص Ping فشل: ${result.error}`);
              await load();
            })}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/15 px-3 text-[11px] font-black text-slate-200 hover:border-pink-300/50 disabled:opacity-50"
          >
            <Webhook className="size-3.5" /> فحص Ping
          </button>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void run("verify", async () => {
              const result = await testGumroadVerificationFn();
              if (result.ok) toast.success("اختبار التحقق: يرفض البيانات غير المعروفة (سلوك آمن).");
              else toast.error(result.detail);
              await load();
            })}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/15 px-3 text-[11px] font-black text-slate-200 hover:border-pink-300/50 disabled:opacity-50"
          >
            <CheckCircle2 className="size-3.5" /> اختبار تحقق الشراء
          </button>
        </div>
      </header>

      {error && <p className="border-b border-white/10 bg-red-500/10 p-3 text-xs font-bold text-red-200">{error}</p>}

      {!status ? (
        <p className="p-6 text-center text-xs text-slate-500">{busy ? "جارٍ التحميل…" : "لا توجد بيانات بعد."}</p>
      ) : (
        <div className="grid gap-4 p-4 lg:grid-cols-2">
          <StatusRow
            label="Product status"
            state={status.product.state}
            detail={[
              status.product.remoteName ?? status.product.publicPageUrl,
              status.product.remotePublished === false ? " — غير منشور!" : "",
              ` · product_id: ${status.product.productId ?? "غير مُستخرج"}`,
              status.product.productIdSource === "api" ? " (من Gumroad API)" : status.product.productIdSource === "env" ? " (من المتغيرات)" : "",
              typeof status.product.remoteProductCount === "number" && status.product.remoteProductCount > 1
                ? ` · المتجر يحتوي ${status.product.remoteProductCount} منتجات — ثبّت GUMROAD_PRODUCT_ID`
                : "",
            ].join("")}
            href={status.product.publicPageUrl}
          />
          <StatusRow label="API status" state={status.api.state} detail={status.api.detail} />
          <StatusRow
            label="Ping status"
            state={status.ping.state}
            detail={`${status.ping.endpointUrl}${status.ping.lastPingAt ? ` · آخر Ping: ${status.ping.lastPingStatus} ${new Date(status.ping.lastPingAt).toLocaleString("ar")}` : " · لم يصل أي Ping بعد"}`}
          />
          <StatusRow
            label="الربط (Buyer → حساب)"
            state={status.binding.state}
            detail={`${status.binding.bound} مربوطة من ${status.binding.total} عضوية · ${status.binding.pendingClaim} بانتظار ربط حساب${
              status.binding.unboundEmails > 0 ? ` · ${status.binding.unboundEmails} بريد بلا حساب بعد` : ""
            }`}
          />
          <StatusRow
            label="Product/Tier mapping"
            state={status.tierMapping.every((tier) => tier.state === "Ready") ? "Ready" : "Missing"}
            detail={status.tierMapping.map((tier) => `${tier.planKey} ← ${tier.tierName} (${tier.recurrence})`).join(" · ")}
          />
          <StatusRow
            label="Keygen mapping"
            state={status.keygenMapping.every((policy) => policy.configured) ? "Ready" : "Missing"}
            detail={status.keygenMapping.map((policy) => `${policy.planKey}: ${policy.configured ? "Policy مضبوط" : "بلا Policy"}`).join(" · ")}
          />
          <StatusRow
            label="Subscriptions"
            state={status.subscriptions.pendingClaim > 0 ? "Needs Setup" : status.subscriptions.total > 0 ? "Ready" : "Ready"}
            detail={`${status.subscriptions.total} عضوية · ${status.subscriptions.active} نشطة · ${status.subscriptions.pendingClaim} بانتظار ربط حساب`}
          />

          <div className="lg:col-span-2 rounded-xl border border-white/10 bg-black/20 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-black text-slate-400">مزامنة اشتراك من Gumroad (عند فقدان Webhook):</span>
              <input
                value={syncEmail}
                onChange={(event) => setSyncEmail(event.target.value)}
                placeholder="بريد المشتري في Gumroad"
                dir="ltr"
                className="h-8 w-64 rounded-lg border border-white/10 bg-white/[0.05] px-2 text-xs text-slate-200 outline-none focus:border-pink-300/60"
              />
              <button
                type="button"
                disabled={busy !== null || !syncEmail.includes("@")}
                onClick={() => void run("sync", async () => {
                  const result = await syncGumroadSubscriptionFn({ data: { email: syncEmail.trim() } });
                  if (result.ok) toast.success(result.detail);
                  else toast.error(result.error === "subscriber_not_found" ? "لا يوجد مشترك بهذا البريد في Gumroad." : result.error);
                  await load();
                })}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/15 px-3 text-[11px] font-black text-slate-200 hover:border-pink-300/50 disabled:opacity-50"
              >
                <RefreshCw className="size-3.5" /> مزامنة
              </button>
            </div>
            {status.missingVariables.length > 0 && (
              <p className="mt-2 flex items-start gap-2 text-[11px] leading-5 text-amber-300">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                متغيرات ناقصة في Vercel: <code className="font-mono">{status.missingVariables.join(", ")}</code> — تُضاف في Vercel فقط دون إرسالها في الدردشة.
              </p>
            )}
            {status.recommendedVariables.length > 0 && status.missingVariables.length === 0 && (
              <p className="mt-2 flex items-start gap-2 text-[11px] leading-5 text-slate-400">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                اختياري لكن مُستحسن: <code className="font-mono">{status.recommendedVariables.join(", ")}</code> — بدونه يُستخرج معرّف المنتج تلقائيًا من Gumroad API بالـ permalink.
              </p>
            )}
            {status.product.state === "Missing" && (
              <p className="mt-2 flex items-start gap-2 text-[11px] leading-5 text-amber-300">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                معرّف المنتج غير مُستخرج: أضف <code className="font-mono">GUMROAD_ACCESS_TOKEN</code> ليُشتق من Gumroad API، أو ثبّت <code className="font-mono">GUMROAD_PRODUCT_ID</code> يدويًا.
              </p>
            )}
          </div>

          <div className="lg:col-span-2 grid gap-2 text-[11px] text-slate-400 sm:grid-cols-2">
            {status.tierMapping.map((tier) => (
              <a key={tier.planKey} href={tier.checkoutUrl} target="_blank" rel="noreferrer noopener" className="flex items-center justify-between gap-2 rounded-lg border border-white/10 px-3 py-2 hover:border-pink-300/40">
                <span className="font-mono">{tier.planKey}</span>
                <span className="flex items-center gap-1 text-slate-500">{(tier.priceCents / 100).toLocaleString("en-US")} SAR <ExternalLink className="size-3" /></span>
              </a>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

const stateStyles: Record<GumroadReadyState, string> = {
  Ready: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200",
  "Needs Setup": "border-amber-400/30 bg-amber-400/10 text-amber-200",
  Missing: "border-slate-500/40 bg-slate-700/40 text-slate-300",
  Failed: "border-red-400/30 bg-red-400/10 text-red-200",
};

function StatusRow({ label, state, detail, href }: { label: string; state: GumroadReadyState; detail: string; href?: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-black tracking-wide text-slate-300">{label}</span>
        <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-black", stateStyles[state])}>{state}</span>
      </div>
      {href ? (
        <a href={href} target="_blank" rel="noreferrer noopener" className="mt-1.5 flex items-center gap-1 break-all text-[11px] leading-5 text-slate-400 hover:text-pink-200">
          {detail} <ExternalLink className="size-3 shrink-0" />
        </a>
      ) : (
        <p className="mt-1.5 break-words text-[11px] leading-5 text-slate-400">{detail}</p>
      )}
    </div>
  );
}
