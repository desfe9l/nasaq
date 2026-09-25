import { useState } from "react";
import { cn } from "@/lib/utils";

const DOCS = ["تقرير الأداء المؤسسي", "لوحة المؤشرات", "خطاب رسمي معتمد"] as const;

export function HeroShowcase() {
  const [active, setActive] = useState(0);

  return (
    <div className="relative mx-auto w-full max-w-xl lg:max-w-none">
      <div className="overflow-hidden rounded-[12px] border border-line bg-white shadow-sm dark:border-white/10 dark:bg-[#161c26]">
        <div className="flex items-center gap-3 border-b border-line/60 bg-[#f8faf9] px-4 py-2.5 dark:border-white/10 dark:bg-white/[0.03]" dir="ltr">
          <div className="flex items-center gap-1.5" aria-hidden>
            <span className="size-2.5 rounded-full bg-[#d1d5db]" />
            <span className="size-2.5 rounded-full bg-[#d1d5db]" />
            <span className="size-2.5 rounded-full bg-[#d1d5db]" />
          </div>
          <div className="mx-auto flex min-w-0 items-center gap-2 rounded-[6px] border border-line bg-white px-3 py-1 font-mono text-[11px] text-[#667085] dark:border-white/10 dark:bg-[#111722] dark:text-white/50">
            <span className="size-1.5 shrink-0 rounded-full bg-[#006C35]" />
            <span className="truncate">nasaq-sa.vercel.app/editor</span>
          </div>
          <span className="w-12" aria-hidden />
        </div>

        <div className="flex items-center gap-1 border-b border-line/60 bg-white px-3 py-2 text-[11px] dark:border-white/10 dark:bg-[#161c26]" role="tablist" aria-label="نماذج المخرجات">
          {DOCS.map((title, idx) => (
            <button key={title} type="button" role="tab" aria-selected={active === idx} onClick={() => setActive(idx)} className={cn("shrink-0 rounded-[8px] border px-3 py-1.5 text-[11px] font-bold transition", active === idx ? "border-[#0F1E33] bg-[#0F1E33] text-white dark:border-white dark:bg-white dark:text-[#0F1E33]" : "border-transparent bg-[#f8faf9] text-[#475467] hover:border-line dark:bg-white/5 dark:text-white/60")}>
              {title}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-[1fr] sm:grid-cols-[1fr_96px] bg-[#fcfdfc] dark:bg-[#111722]">
          <div className="relative flex h-[360px] items-center justify-center overflow-hidden bg-[#f8faf9] p-5 dark:bg-[#0f141f] sm:h-[400px]">
            <div className="relative aspect-[210/297] h-full max-h-[340px] select-none overflow-hidden rounded-[2px] border border-line/60 bg-white text-slate-900 shadow-sm dark:border-white/10 sm:max-h-[360px]">
              {DOCS.map((_, idx) => (
                <div key={idx} aria-hidden={active !== idx} className={cn("absolute inset-0 flex flex-col p-[7%] transition-opacity duration-200", active === idx ? "opacity-100" : "pointer-events-none opacity-0")}>
                  {idx === 0 && <ReportDoc />}
                  {idx === 1 && <DashboardDoc />}
                  {idx === 2 && <LetterDoc />}
                </div>
              ))}
            </div>
          </div>
          <div className="hidden flex-col items-center gap-2 border-s border-line/60 bg-white p-2.5 dark:border-white/10 dark:bg-[#161c26] sm:flex">
            {DOCS.map((title, idx) => (
              <button key={title} type="button" onClick={() => setActive(idx)} aria-label={`عرض ${title}`} className={cn("w-full rounded-[10px] border-2 p-1.5 transition", active === idx ? "border-[#006C35] bg-[#006C35]/5" : "border-line/60 hover:border-[#0F1E33]/20 dark:border-white/10")}>
                <span className="block aspect-[210/297] w-full rounded-[2px] bg-white p-1 shadow-sm">
                  <span className="block h-1 w-3/4 rounded-sm bg-[#0F1E33]" />
                  <span className="mt-1 block h-0.5 w-full bg-[#e5e7eb]" />
                  <span className="mt-0.5 block h-0.5 w-5/6 bg-[#e5e7eb]" />
                  <span className="mt-1.5 block h-3 w-full rounded-sm bg-[#f0fdf4]" />
                </span>
                <span className="mt-1 block text-center text-[9px] font-bold text-[#667085]">{idx + 1}</span>
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
    <div className="flex items-center justify-between gap-2 border-b border-[#0F1E33]/10 pb-[4%]">
      <div className="min-w-0">
        <p className="text-[6px] font-bold text-[#667085]">الإدارة العامة للاتصال المؤسسي</p>
        <h4 className="mt-0.5 text-[9px] font-extrabold leading-tight text-[#0F1E33]">{title}</h4>
        <p className="mt-0.5 font-mono text-[5.5px] text-[#98a2b3]">{meta}</p>
      </div>
      <img src="/nasaq-mark.svg" alt="" className="h-5 w-auto shrink-0 object-contain" draggable={false} />
    </div>
  );
}

function Footer({ page }: { page: string }) {
  return (
    <div className="mt-auto flex justify-between border-t border-[#e5e7eb] pt-[3%] text-[5.5px] text-[#98a2b3]">
      <span>وثيقة داخلية — للاستخدام الرسمي</span>
      <span>{page}</span>
    </div>
  );
}

function ReportDoc() {
  return (
    <>
      <OfficialHeader title="تقرير قياس مؤشرات الأداء — الربع الثالث" meta="REF 2026-Q3 · 1448هـ" />
      <div className="mt-[5%] grid grid-cols-3 gap-1">
        {[["نسبة الإنجاز", "96.4%"], ["المبادرات", "42"], ["رضا المستفيدين", "4.7/5"]].map(([label, value]) => (
          <div key={label} className="rounded border border-[#e5e7eb] bg-[#f8faf9] px-1 py-1 text-center">
            <span className="block text-[5px] text-[#667085]">{label}</span>
            <strong className="text-[8px] font-bold text-[#0F1E33]">{value}</strong>
          </div>
        ))}
      </div>
      <div className="relative mt-[5%] border border-[#006C35] p-1">
        <div className="flex items-center justify-between text-[7px] font-bold text-[#0F1E33]">
          <span>التحول الرقمي</span>
          <span>96.4%</span>
        </div>
        <div className="mt-1 h-1 w-full rounded-full bg-[#e5e7eb]">
          <div className="h-full w-[96%] rounded-full bg-[#006C35]" />
        </div>
      </div>
      <table className="mt-[5%] w-full border-collapse text-[6px]">
        <thead>
          <tr className="bg-[#0F1E33] text-white">
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
            <tr key={row[0]} className={i % 2 ? "bg-[#f8faf9]" : ""}>
              <td className="border-b border-[#e5e7eb] p-0.5">{row[0]}</td>
              <td className="border-b border-[#e5e7eb] p-0.5 text-center">{row[1]}</td>
              <td className="border-b border-[#e5e7eb] p-0.5 text-center font-bold text-[#006C35]">{row[2]}</td>
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
      <p className="mt-[4%] text-[6.5px] font-bold text-[#475467]">تطور مؤشر الأداء (نصف سنوي)</p>
      <div className="mt-1 flex h-[26%] items-end gap-1 border-b border-[#e5e7eb] px-1">
        {bars.map((h, i) => (
          <div key={i} className="flex flex-1 flex-col items-center justify-end gap-0.5">
            <span className="text-[5px] font-bold text-[#667085]">{h}</span>
            <div className="w-full rounded-t-sm bg-[#006C35]" style={{ height: `${h}%` }} />
          </div>
        ))}
      </div>
      <div className="mt-[4%] grid grid-cols-2 gap-1">
        <div className="flex items-center gap-1 rounded border border-[#e5e7eb] p-1">
          <svg viewBox="0 0 36 36" className="size-6 -rotate-90" aria-hidden>
            <circle cx="18" cy="18" r="14" fill="none" stroke="#e5f6eb" strokeWidth="5" />
            <circle cx="18" cy="18" r="14" fill="none" stroke="#006C35" strokeWidth="5" strokeDasharray="66 88" />
          </svg>
          <div>
            <span className="block text-[5px] text-[#667085]">حصة القنوات الرقمية</span>
            <strong className="text-[8px] font-bold text-[#0F1E33]">75%</strong>
          </div>
        </div>
        <div className="rounded border border-[#d1fae5] bg-[#f0fdf4] p-1">
          <span className="block text-[5px] text-[#006C35]">مقارنة بالعام السابق</span>
          <strong className="text-[8px] font-bold text-[#0F1E33]">+24%</strong>
        </div>
      </div>
      <div className="mt-[4%] space-y-1">
        {[
          ["المنطقة الوسطى", 82],
          ["المنطقة الغربية", 64],
          ["المنطقة الشرقية", 57],
        ].map(([label, v]) => (
          <div key={String(label)} className="flex items-center gap-1 text-[6px]">
            <span className="w-12 shrink-0 text-[#475467]">{label}</span>
            <div className="h-1 flex-1 rounded-full bg-[#f2f4f7]">
              <div className="h-full rounded-full bg-[#0F1E33]" style={{ width: `${v}%` }} />
            </div>
            <span className="w-3 font-bold text-[#0F1E33]">{v}</span>
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
      <div className="mt-[6%] space-y-1 text-[6.5px] leading-[1.6] text-[#344054]">
        <p className="font-bold text-[#0F1E33]">سعادة مدير عام الاتصال المؤسسي، المحترم</p>
        <p>السلام عليكم ورحمة الله وبركاته،</p>
        <p>إشارةً إلى خطة تطوير المخرجات المؤسسية للعام الحالي، نفيدكم باعتماد النماذج الموحدة للتقارير الدورية وفق دليل الهوية البصرية المعتمد، على أن يبدأ العمل بها اعتبارًا من الربع القادم.</p>
        <p>وتقبلوا خالص التحية والتقدير،</p>
      </div>
      <div className="mt-auto flex items-end justify-between pb-[4%]">
        <div className="text-[6px]">
          <span className="block font-bold text-[#475467]">المعتمد</span>
          <svg viewBox="0 0 90 28" className="mt-0.5 h-4 w-14 text-[#0F1E33]" aria-hidden>
            <path d="M4 20c10-14 16-14 14 0s10-16 18-8 6 10 14 2 12-6 18 0 10 2 18-6" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
          <span className="block text-[5.5px] text-[#667085]">مدير إدارة التخطيط</span>
        </div>
        <div className="grid size-8 place-items-center rounded-full border border-[#0F1E33]/20 text-[5px] font-bold text-[#0F1E33]">معتمد</div>
      </div>
      <Footer page="صفحة 1 من 1" />
    </>
  );
}
