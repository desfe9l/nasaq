import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Copy,
  Database,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  FileJson,
  KeyRound,
  LockKeyhole,
  Network,
  Printer,
  RefreshCw,
  Search,
  Server,
  ShieldCheck,
  Sparkles,
  Webhook,
} from "lucide-react";
import { toast } from "sonner";
import { getOwnerVaultFn } from "@/lib/owner/vault-functions";
import {
  downloadTextFile,
  inventoryToCsv,
  maskVaultValue,
  VAULT_SECTION_LABELS,
  type OwnerVaultInventory,
  type VaultEntry,
  type VaultSection,
} from "@/lib/owner/vault";
import { cn } from "@/lib/utils";

const sections: VaultSection[] = [
  "accounts",
  "apis",
  "projects",
  "payments",
  "deployment",
  "database",
  "ai",
  "authentication",
  "domain",
  "webhooks",
  "services",
];

const sectionIcons: Record<VaultSection, typeof Server> = {
  accounts: KeyRound,
  apis: Network,
  projects: Server,
  payments: Sparkles,
  deployment: Server,
  database: Database,
  ai: Sparkles,
  authentication: LockKeyhole,
  domain: Network,
  webhooks: Webhook,
  services: Server,
};

const severityClass = {
  high: "border-red-500/25 bg-red-500/10 text-red-100",
  medium: "border-amber-400/25 bg-amber-400/10 text-amber-50",
  info: "border-sky-400/25 bg-sky-400/10 text-sky-50",
};

function originLabel(entry: VaultEntry): string {
  if (entry.origin === "runtime") return "runtime فعلي";
  if (entry.origin === "source") return "موجود في المصدر";
  if (entry.origin === "default") return "fallback في الكود";
  return "غير مهيأ";
}

function sensitivityLabel(entry: VaultEntry): string {
  if (entry.sensitivity === "secret") return "سر";
  if (entry.sensitivity === "sensitive") return "حساس";
  return "عام";
}

function valueForDisplay(entry: VaultEntry, revealed: boolean): string {
  if (!entry.ownerReadable) return "محجوب بسياسة المنصة";
  /* Optional services carry an honest human-readable status instead of a
     misleading "غير مهيأ" error — the status IS the value. */
  if (!entry.value) return "غير مهيأ";
  return revealed ? entry.value : maskVaultValue(entry.value);
}

function matches(entry: VaultEntry, query: string): boolean {
  if (!query.trim()) return true;
  const haystack = [entry.service, entry.account, entry.label, entry.variable, entry.purpose].join(" ").toLowerCase();
  return haystack.includes(query.trim().toLowerCase());
}

export default function OwnerVaultPage() {
  const [inventory, setInventory] = useState<OwnerVaultInventory | null>(null);
  const [selectedSection, setSelectedSection] = useState<VaultSection | "all">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await getOwnerVaultFn();
      setInventory(next);
      setSelectedId((current) => current ?? next.entries[0]?.id ?? null);
    } catch {
      setError("تعذر تحميل خزنة المالك. تأكد من تسجيل الدخول بحساب MASTER OWNER.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredEntries = useMemo(() => {
    if (!inventory) return [];
    return inventory.entries.filter((entry) =>
      (selectedSection === "all" || entry.section === selectedSection) && matches(entry, query),
    );
  }, [inventory, query, selectedSection]);

  const selectedEntry = inventory?.entries.find((entry) => entry.id === selectedId) ?? filteredEntries[0] ?? null;

  const copyValue = async (entry: VaultEntry) => {
    if (!entry.ownerReadable || !entry.value) return;
    try {
      await navigator.clipboard.writeText(entry.value);
      toast.success("تم نسخ القيمة إلى الحافظة");
    } catch {
      toast.error("تعذر النسخ من المتصفح");
    }
  };

  const exportJson = () => {
    if (!inventory) return;
    downloadTextFile(`nasaq-owner-vault-${Date.now()}.json`, JSON.stringify(inventory, null, 2), "application/json;charset=utf-8");
    toast.success("تم تنزيل JSON الكامل للمالك");
  };

  const exportCsv = () => {
    if (!inventory) return;
    downloadTextFile(`nasaq-owner-vault-${Date.now()}.csv`, inventoryToCsv(inventory), "text/csv;charset=utf-8");
    toast.success("تم تنزيل CSV الكامل للمالك");
  };

  if (loading) {
    return <div dir="rtl" className="grid min-h-[70vh] place-items-center bg-[#07110f] text-white"><RefreshCw className="size-7 animate-spin text-emerald-400" /></div>;
  }

  if (error || !inventory) {
    return (
      <div dir="rtl" className="grid min-h-[70vh] place-items-center bg-[#07110f] p-5 text-white">
        <section className="w-full max-w-md rounded-2xl border border-red-400/25 bg-white/[0.05] p-7 text-center shadow-2xl">
          <ShieldCheck className="mx-auto mb-4 size-10 text-red-300" />
          <h1 className="text-xl font-black">NASAQ Owner Vault</h1>
          <p className="mt-2 text-sm leading-7 text-slate-300">{error ?? "لا توجد بيانات متاحة."}</p>
          <button type="button" onClick={() => void load()} className="mt-5 inline-flex h-10 items-center gap-2 rounded-lg bg-emerald-500 px-4 text-sm font-black text-[#07110f] hover:bg-emerald-400"><RefreshCw className="size-4" /> إعادة المحاولة</button>
        </section>
      </div>
    );
  }

  return (
    <div dir="rtl" className="min-h-screen bg-[#07110f] text-white">
      <header className="border-b border-white/10 bg-[#07110f]/90 px-4 py-5 backdrop-blur-xl print:hidden">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="grid size-11 place-items-center rounded-2xl border border-emerald-400/30 bg-emerald-400/10 text-emerald-300"><ShieldCheck className="size-6" /></span>
            <div>
              <p className="text-[11px] font-bold tracking-[0.22em] text-emerald-300/80">MASTER OWNER ACCESS</p>
              <h1 className="text-xl font-black tracking-tight">NASAQ Owner Vault</h1>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs font-bold text-slate-300">
            <span className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1.5 text-emerald-200">بيئة: {inventory.environment}</span>
            <span className={cn("rounded-full border px-3 py-1.5", inventory.ownerConfigured ? "border-emerald-400/25 text-emerald-200" : "border-red-400/25 text-red-200")}>{inventory.ownerConfigured ? "هوية المالك مهيأة" : "هوية المالك غير مهيأة"}</span>
            <button type="button" onClick={() => void load()} className="inline-flex h-9 items-center gap-2 rounded-lg border border-white/15 px-3 hover:border-emerald-400/50"><RefreshCw className="size-3.5" /> تحديث</button>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-[1500px] gap-5 px-4 py-5 lg:grid-cols-[240px_minmax(0,1fr)_390px]">
        <aside className="space-y-4 print:hidden">
          <div className="rounded-2xl border border-white/10 bg-white/[0.045] p-3">
            <p className="px-2 pb-2 text-[11px] font-black tracking-[0.16em] text-slate-500">SECTIONS</p>
            <button type="button" onClick={() => setSelectedSection("all")} className={cn("mb-1 flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-right text-sm font-bold", selectedSection === "all" ? "bg-emerald-400/15 text-emerald-200" : "text-slate-300 hover:bg-white/5")}><span>كل inventory</span><span className="text-xs text-slate-500">{inventory.entries.length}</span></button>
            {sections.map((section) => {
              const Icon = sectionIcons[section];
              const count = inventory.entries.filter((entry) => entry.section === section).length;
              return <button key={section} type="button" onClick={() => setSelectedSection(section)} className={cn("flex w-full items-center gap-2 rounded-xl px-3 py-2 text-right text-[13px] font-bold", selectedSection === section ? "bg-emerald-400/15 text-emerald-200" : "text-slate-300 hover:bg-white/5")}><Icon className="size-4 opacity-70" /><span className="flex-1">{VAULT_SECTION_LABELS[section]}</span><span className="text-xs text-slate-500">{count}</span></button>;
            })}
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.045] p-4 text-sm leading-7 text-slate-300">
            <div className="mb-2 flex items-center gap-2 text-emerald-200"><LockKeyhole className="size-4" /><strong>سياسة الخزنة</strong></div>
            <p>القيم تُقرأ server-side بعد التحقق من هوية MASTER OWNER. أسرار المنصة لا تُعرض ولا تدخل في exports.</p>
          </div>
        </aside>

        <section className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><p className="text-sm text-slate-400">جرد قابل للمراجعة</p><h2 className="text-2xl font-black">البنية التحتية والاعتمادات</h2></div>
            <div className="flex flex-wrap gap-2 print:hidden">
              <button type="button" onClick={exportCsv} className="inline-flex h-9 items-center gap-2 rounded-lg border border-white/15 px-3 text-xs font-black hover:border-emerald-400/50"><Download className="size-3.5" /> CSV كامل</button>
              <button type="button" onClick={exportJson} className="inline-flex h-9 items-center gap-2 rounded-lg border border-white/15 px-3 text-xs font-black hover:border-emerald-400/50"><FileJson className="size-3.5" /> JSON كامل</button>
              <button type="button" onClick={() => window.print()} className="inline-flex h-9 items-center gap-2 rounded-lg border border-white/15 px-3 text-xs font-black hover:border-emerald-400/50"><Printer className="size-3.5" /> طباعة</button>
            </div>
          </div>
          <div className="relative print:hidden"><Search className="pointer-events-none absolute right-3 top-3 size-4 text-slate-500" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ابحث عن مزود، حساب، متغير أو غرض…" className="h-10 w-full rounded-xl border border-white/10 bg-white/[0.045] pr-10 pl-4 text-sm outline-none placeholder:text-slate-600 focus:border-emerald-400/60" /></div>
          <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.035]">
            {filteredEntries.map((entry) => {
              const active = entry.id === selectedEntry?.id;
              const isRevealed = revealed.has(entry.id);
              return (
                <button key={entry.id} type="button" onClick={() => setSelectedId(entry.id)} className={cn("grid w-full gap-2 border-b border-white/8 p-4 text-right transition last:border-b-0 sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_auto] sm:items-center", active ? "bg-emerald-400/10" : "hover:bg-white/[0.04]")}>
                  <span className="min-w-0"><span className="flex items-center gap-2"><span className="truncate text-sm font-black">{entry.label}</span>{entry.sensitivity === "secret" && <LockKeyhole className="size-3.5 shrink-0 text-amber-300" />}</span><span className="mt-1 block truncate text-xs text-slate-500">{entry.service} · {entry.account}</span></span>
                  <span className={cn("truncate font-mono text-xs", entry.ownerReadable ? "text-slate-300" : "text-slate-500")}>{valueForDisplay(entry, isRevealed)}</span>
                  <span className="flex items-center justify-between gap-2 sm:justify-end"><span className={cn("rounded-full px-2 py-1 text-[10px] font-black", entry.configured ? "bg-emerald-400/10 text-emerald-200" : "bg-slate-700/60 text-slate-400")}>{originLabel(entry)}</span><ChevronDown className={cn("size-4 text-slate-600 transition", active && "-rotate-90 text-emerald-300")} /></span>
                </button>
              );
            })}
            {!filteredEntries.length && <div className="p-10 text-center text-sm text-slate-500">لا توجد نتائج مطابقة.</div>}
          </div>
        </section>

        <aside className="space-y-4">
          {inventory.findings.map((finding, index) => <article key={`${finding.title}-${index}`} className={cn("rounded-2xl border p-4", severityClass[finding.severity])}><div className="flex gap-3">{finding.severity === "high" ? <AlertTriangle className="mt-0.5 size-5 shrink-0" /> : <CheckCircle2 className="mt-0.5 size-5 shrink-0" />}<div><h3 className="text-sm font-black">{finding.title}</h3><p className="mt-1 text-xs leading-6 opacity-80">{finding.detail}</p><p className="mt-2 text-xs font-bold leading-6">الإجراء: {finding.action}</p></div></div></article>)}
          {selectedEntry && <EntryDetails entry={selectedEntry} revealed={revealed.has(selectedEntry.id)} onReveal={() => setRevealed((current) => { const next = new Set(current); if (next.has(selectedEntry.id)) next.delete(selectedEntry.id); else next.add(selectedEntry.id); return next; })} onCopy={() => void copyValue(selectedEntry)} />}
        </aside>
      </main>
    </div>
  );
}

function EntryDetails({ entry, revealed, onReveal, onCopy }: { entry: VaultEntry; revealed: boolean; onReveal: () => void; onCopy: () => void }) {
  return (
    <article className="rounded-2xl border border-white/10 bg-white/[0.055] p-5 shadow-xl">
      <div className="flex items-start justify-between gap-3"><div><p className="text-[11px] font-black tracking-[0.16em] text-emerald-300/80">SELECTED ENTRY</p><h2 className="mt-1 text-lg font-black">{entry.label}</h2><p className="mt-1 text-xs text-slate-500">{entry.service} · {entry.account}</p></div><span className="rounded-full border border-white/10 px-2 py-1 text-[10px] font-black text-slate-400">{sensitivityLabel(entry)}</span></div>
      <div className="mt-5 rounded-xl border border-white/10 bg-black/20 p-3"><div className="mb-2 flex items-center justify-between gap-2"><span className="text-[11px] font-bold text-slate-500">القيمة</span><div className="flex gap-1 print:hidden">{entry.ownerReadable && entry.value && <><button type="button" onClick={onReveal} className="grid size-7 place-items-center rounded-md border border-white/10 text-slate-300 hover:border-emerald-400/50" aria-label={revealed ? "إخفاء القيمة" : "إظهار القيمة"}>{revealed ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}</button><button type="button" onClick={onCopy} className="grid size-7 place-items-center rounded-md border border-white/10 text-slate-300 hover:border-emerald-400/50" aria-label="نسخ القيمة"><Copy className="size-3.5" /></button></>}</div></div><code className="block break-all text-xs leading-6 text-emerald-100">{valueForDisplay(entry, revealed)}</code></div>
      <dl className="mt-4 grid gap-3 text-xs"><Detail label="المتغير" value={entry.variable ?? "مرجع ثابت"} /><Detail label="المصدر" value={entry.configurationLocation} /><Detail label="الحالة" value={`${originLabel(entry)} · ${entry.configured ? "متاح في runtime" : "ليس من runtime"}`} /><Detail label="الغرض" value={entry.purpose} /></dl>
      <div className="mt-5 border-t border-white/10 pt-4"><p className="text-xs font-black text-emerald-200">دليل التغيير الآمن</p><div className="mt-3 grid gap-2 text-xs leading-6 text-slate-300"><Detail label="من المزود" value={entry.changeGuide.providerAction} /><Detail label="في NASAQ" value={entry.changeGuide.nasaqLocation} /><Detail label="البيئات" value={entry.changeGuide.environments} /><Detail label="إعادة النشر" value={entry.changeGuide.redeploy} /><Detail label="Webhook" value={entry.changeGuide.webhook} /><Detail label="الإلغاء" value={entry.changeGuide.revoke} /></div></div>
      <div className="mt-5 flex flex-wrap gap-2 print:hidden">{entry.loginUrl && <a href={entry.loginUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-2 text-xs font-bold text-slate-300 hover:border-emerald-400/50"><ExternalLink className="size-3.5" /> تسجيل الدخول</a>}{entry.dashboardUrl && <a href={entry.dashboardUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-2 text-xs font-bold text-slate-300 hover:border-emerald-400/50"><ExternalLink className="size-3.5" /> لوحة المزود</a>}</div>
    </article>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div className="grid gap-0.5"><dt className="font-black text-slate-500">{label}</dt><dd className="text-slate-300">{value}</dd></div>;
}
