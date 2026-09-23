import { useEffect, useState } from "react";
import { MousePointer2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Landing-page live editor showcase.
 *
 * A macOS-style window framing realistic A4 outputs (official header,
 * statistics, chart, table, signature). The only mark used is the official
 * NASAQ SVG from /public, rendered at its intrinsic aspect ratio — never
 * recoloured or stretched. Motion is limited to a slow cross-fade between
 * documents and is disabled for users who prefer reduced motion.
 */
const DOCS = ["تقرير الأداء المؤسسي", "لوحة المؤشرات", "خطاب رسمي معتمد"] as const;

export function HeroShowcase() {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return;
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const timer = setInterval(() => setActive((i) => (i + 1) % DOCS.length), 5200);
    return () => clearInterval(timer);
  }, [paused]);

  return (
    <div
      className="relative mx-auto w-full max-w-xl lg:max-w-none"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div className="pointer-events-none absolute -inset-6 rounded-[32px] bg-emerald-500/15 blur-3xl" aria-hidden />
      <div className="relative overflow-hidden rounded-2xl border border-white/15 bg-[#0c1522]/90 shadow-[0_30px_80px_-24px_rgba(0,0,0,0.75),0_0_0_1px_rgba(16,185,129,0.15)] backdrop-blur-xl">
        {/* Titlebar */}
        <div className="flex items-center gap-3 border-b border-white/10 bg-white/[0.04] px-4 py-2.5" dir="ltr">
          <div className="flex items-center gap-1.5" aria-hidden>
            <span className="size-3 rounded-full bg-[#ff5f57]" />
            <span className="size-3 rounded-full bg-[#febc2e]" />
            <span className="size-3 rounded-full bg-[#28c840]" />
          </div>
          <div className="mx-auto flex min-w-0 items-center gap-2 rounded-md border border-white/10 bg-black/30 px-3 py-1 font-mono text-[11px] text-slate-300">
            <span className="size-1.5 shrink-0 rounded-full bg-emerald-400" />
            <span className="truncate">nasaq-sa.vercel.app/editor</span>
          </div>
          <span className="w-12" aria-hidden />
        </div>

        {/* Document tabs */}
        <div className="flex items-center gap-1 overflow-x-auto border-b border-white/10 bg-black/20 px-3 py-1.5 text-[11px]" role="tablist" aria-label="نماذج المخرجات">
          {DOCS.map((title, idx) => (
            <button
              key={title}
              type="button"
              role="tab"
              aria-selected={active === idx}
              onClick={() => setActive(idx)}
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1 font-bold transition",
                active === idx
                  ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                  : "border-transparent text-slate-400 hover:text-white",
              )}
            >
              <span className={cn("size-1.5 rounded-full", active === idx ? "bg-emerald-400" : "bg-slate-600")} />
              {title}
            </button>
          ))}
        </div>

        {/* Workspace */}
        <div className="grid grid-cols-[1fr] sm:grid-cols-[1fr_92px]">
          <div className="relative flex h-[360px] items-center justify-center overflow-hidden bg-[#131d2c] p-4 sm:h-[400px]">
            <div
              className="pointer-events-none absolute inset-0 opacity-[0.14]"
              style={{ backgroundImage: "radial-gradient(#10b981 1px, transparent 1px)", backgroundSize: "18px 18px" }}
              aria-hidden
            />
            {/* A4 artboard: 210 × 297 */}
            <div className="relative aspect-[210/297] h-full max-h-[340px] select-none overflow-hidden rounded-[3px] bg-white text-slate-900 shadow-[0_18px_40px_rgba(0,0,0,0.45)] sm:max-h-[372px]">
              {DOCS.map((_, idx) => (
                <div
                  key={idx}
                  aria-hidden={active !== idx}
                  className={cn(
                    "absolute inset-0 flex flex-col p-[7%] transition-opacity duration-700 motion-reduce:transition-none",
                    active === idx ? "opacity-100" : "pointer-events-none opacity-0",
                  )}
                >
                  {idx === 0 && <ReportDoc />}
                  {idx === 1 && <DashboardDoc />}
                  {idx === 2 && <LetterDoc />}
                </div>
              ))}
            </div>

            {/* Floating tool pill */}
            <div className="absolute bottom-3 right-3 flex items-center gap-1 rounded-xl border border-white/15 bg-black/60 p-1 text-[10px] text-white shadow-xl backdrop-blur-md">
              <span className="flex items-center gap-1 rounded-lg bg-emerald-500/20 px-2 py-1 font-bold text-emerald-300">
                <MousePointer2 className="size-3" /> تحديد
              </span>
              <span className="px-1.5 py-1 text-slate-300">A4 · 300 DPI</span>
            </div>
          </div>

          {/* Page strip (hidden on narrow screens) */}
          <div className="hidden flex-col items-center gap-2 border-s border-white/10 bg-black/20 p-2 sm:flex">
            {DOCS.map((title, idx) => (
              <button
                key={title}
                type="button"
                onClick={() => setActive(idx)}
                aria-label={`عرض ${title}`}
                className={cn(
                  "w-full rounded-xl border-2 p-1.5 transition-all",
                  active === idx ? "border-emerald-500 bg-emerald-500/10 ring-2 ring-emerald-500/30" : "border-white/10 hover:border-white/25",
                )}
              >
                <span className="block aspect-[210/297] w-full rounded-[2px] bg-white p-1">
                  <span className="block h-1 w-3/4 rounded-sm bg-emerald-700" />
                  <span className="mt-1 block h-0.5 w-full bg-slate-200" />
                  <span className="mt-0.5 block h-0.5 w-5/6 bg-slate-200" />
                  <span className="mt-1 block h-3 w-full rounded-sm bg-emerald-100" />
                </span>
                <span className="mt-1 block text-center text-[9px] font-bold text-slate-400">{idx + 1}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function OfficialHeader({ title, meta }: { title: string; meta: string }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b-2 border-emerald-800 pb-[4%]">
      <div className="min-w-0">
        <p className="text-[6.5px] font-bold text-slate-500">الإدارة العامة للاتصال المؤسسي</p>
        <h4 className="mt-0.5 text-[10px] font-black leading-tight text-emerald-950">{title}</h4>
        <p className="mt-0.5 font-mono text-[6px] text-slate-400">{meta}</p>
      </div>
      <img src="/nasaq-mark.svg" alt="" className="h-6 w-auto shrink-0 object-contain" draggable={false} />
    </div>
  );
}

function Footer({ page }: { page: string }) {
  return (
    <div className="mt-auto flex justify-between border-t border-slate-200 pt-[3%] text-[6px] text-slate-400">
      <span>وثيقة داخلية — للاستخدام الرسمي</span>
      <span>{page}</span>
    </div>
  );
}

function ReportDoc() {
  return (
    <>
      <OfficialHeader title="تقرير قياس مؤشرات الأداء — الربع الثالث" meta="REF 2026-Q3 · 1448هـ" />
      <div className="mt-[5%] grid grid-cols-3 gap-1.5">
        {[
          ["نسبة الإنجاز", "96.4%"],
          ["المبادرات", "42"],
          ["رضا المستفيدين", "4.7/5"],
        ].map(([label, value]) => (
          <div key={label} className="rounded border border-slate-200 bg-slate-50 px-1 py-1.5 text-center">
            <span className="block text-[5.5px] text-slate-500">{label}</span>
            <strong className="text-[9px] font-black text-emerald-800">{value}</strong>
          </div>
        ))}
      </div>
      {/* Selected element: tight 1px emerald box + 7px circular handles */}
      <div className="relative mt-[5%] border border-emerald-500 p-1.5">
        {["-top-[3.5px] -right-[3.5px]", "-top-[3.5px] -left-[3.5px]", "-bottom-[3.5px] -right-[3.5px]", "-bottom-[3.5px] -left-[3.5px]"].map((pos) => (
          <span key={pos} className={cn("absolute size-[7px] rounded-full border border-emerald-500 bg-white", pos)} />
        ))}
        <div className="flex items-center justify-between text-[7.5px] font-black text-emerald-900">
          <span>التحول الرقمي</span>
          <span>96.4%</span>
        </div>
        <div className="mt-1 h-1 w-full rounded-full bg-emerald-100">
          <div className="h-full w-[96%] rounded-full bg-emerald-600" />
        </div>
      </div>
      <table className="mt-[5%] w-full border-collapse text-[6px]">
        <thead>
          <tr className="bg-emerald-800 text-white">
            <th className="p-0.5 text-right font-bold">المؤشر</th>
            <th className="p-0.5 font-bold">المستهدف</th>
            <th className="p-0.5 font-bold">الفعلي</th>
          </tr>
        </thead>
        <tbody>
          {[
            ["زمن الإنجاز", "5 أيام", "3.2"],
            ["الطلبات المكتملة", "12,000", "13,480"],
            ["التغطية الإعلامية", "80%", "91%"],
          ].map((row, i) => (
            <tr key={row[0]} className={i % 2 ? "bg-slate-50" : ""}>
              <td className="border-b border-slate-200 p-0.5">{row[0]}</td>
              <td className="border-b border-slate-200 p-0.5 text-center">{row[1]}</td>
              <td className="border-b border-slate-200 p-0.5 text-center font-bold text-emerald-700">{row[2]}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Footer page="صفحة 1 من 8" />
    </>
  );
}

function DashboardDoc() {
  const bars = [38, 54, 47, 68, 74, 88];
  return (
    <>
      <OfficialHeader title="لوحة الإحصائيات السنوية" meta="DASHBOARD · 2026" />
      <p className="mt-[4%] text-[7px] font-bold text-slate-600">تطور مؤشر الأداء (نصف سنوي)</p>
      <div className="mt-1 flex h-[26%] items-end gap-1.5 border-b border-slate-200 px-1">
        {bars.map((h, i) => (
          <div key={i} className="flex flex-1 flex-col items-center justify-end gap-0.5">
            <span className="text-[5px] font-bold text-slate-500">{h}</span>
            <div className="w-full rounded-t-sm bg-gradient-to-t from-emerald-700 to-emerald-400" style={{ height: `${h}%` }} />
          </div>
        ))}
      </div>
      <div className="mt-[5%] grid grid-cols-2 gap-1.5">
        <div className="flex items-center gap-1.5 rounded border border-slate-200 p-1.5">
          <svg viewBox="0 0 36 36" className="size-7 -rotate-90" aria-hidden>
            <circle cx="18" cy="18" r="14" fill="none" stroke="#d1fae5" strokeWidth="5" />
            <circle cx="18" cy="18" r="14" fill="none" stroke="#059669" strokeWidth="5" strokeDasharray="66 88" />
          </svg>
          <div>
            <span className="block text-[5.5px] text-slate-500">حصة القنوات الرقمية</span>
            <strong className="text-[9px] font-black text-emerald-800">75%</strong>
          </div>
        </div>
        <div className="rounded border border-emerald-200 bg-emerald-50 p-1.5">
          <span className="block text-[5.5px] text-emerald-700">مقارنة بالعام السابق</span>
          <strong className="text-[9px] font-black text-emerald-800">+24%</strong>
        </div>
      </div>
      <div className="mt-[5%] space-y-1">
        {[
          ["المنطقة الوسطى", 82],
          ["المنطقة الغربية", 64],
          ["المنطقة الشرقية", 57],
        ].map(([label, v]) => (
          <div key={String(label)} className="flex items-center gap-1.5 text-[6px]">
            <span className="w-14 shrink-0 text-slate-600">{label}</span>
            <div className="h-1 flex-1 rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-emerald-600" style={{ width: `${v}%` }} />
            </div>
            <span className="w-4 font-bold text-emerald-800">{v}</span>
          </div>
        ))}
      </div>
      <Footer page="صفحة 3 من 5" />
    </>
  );
}

function LetterDoc() {
  return (
    <>
      <OfficialHeader title="خطاب رسمي" meta="الرقم: 4810 · التاريخ: 1448/03/12هـ" />
      <div className="mt-[6%] space-y-1.5 text-[7px] leading-[1.7] text-slate-700">
        <p className="font-bold text-emerald-950">سعادة مدير عام الاتصال المؤسسي، المحترم</p>
        <p>السلام عليكم ورحمة الله وبركاته،</p>
        <p>
          إشارةً إلى خطة تطوير المخرجات المؤسسية للعام الحالي، نفيدكم باعتماد النماذج الموحدة للتقارير
          الدورية وفق دليل الهوية البصرية المعتمد، على أن يبدأ العمل بها اعتبارًا من الربع القادم.
        </p>
        <p>وتقبلوا خالص التحية والتقدير،</p>
      </div>
      <div className="mt-auto flex items-end justify-between pb-[4%]">
        <div className="text-[6.5px]">
          <span className="block font-bold text-slate-600">المعتمد</span>
          <svg viewBox="0 0 90 28" className="mt-0.5 h-5 w-16 text-emerald-900" aria-hidden>
            <path d="M4 20c10-14 16-14 14 0s10-16 18-8 6 10 14 2 12-6 18 0 10 2 18-6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          <span className="block text-[6px] text-slate-500">مدير إدارة التخطيط</span>
        </div>
        <div className="grid size-9 rotate-[-10deg] place-items-center rounded-full border-2 border-emerald-700/60 text-[6px] font-black text-emerald-800">
          معتمد
        </div>
      </div>
      <Footer page="صفحة 1 من 1" />
    </>
  );
}
