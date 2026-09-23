/**
 * /admin — NASAQ administration dashboard.
 *
 * Every privileged call is authorized from the verified Better Auth session.
 * Owner configuration stays server-side; all changes remain persisted in
 * site_settings / admin_templates.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Shield,
  LayoutTemplate,
  Store,
  Megaphone,
  KeyRound,
  Upload,
  Trash2,
  Loader2,
  Save,
  Plus,
  Eye,
  EyeOff,
  Lock,
  Unlock,
  LogOut,
  Image as ImageIcon,
} from "lucide-react";
import { Toaster, toast } from "sonner";
import {
  adminDeleteTemplateFn,
  adminListTemplatesFn,
  adminSaveSettingsFn,
  adminSetTemplateStatusFn,
  adminUpsertTemplateFn,
  adminVerifyFn,
  getSiteSettingsFn,
} from "@/lib/admin/functions";
import {
  DEFAULT_SITE_SETTINGS,
  type AdminTemplateSummary,
  type BrandPreset,
  type PublicSiteSettings,
  type SettingsSection,
  type TemplateKind,
  type TemplateStatus,
  type TemplateTier,
} from "@/lib/admin/types";
import AdminLicensePanel from "@/components/license/AdminLicensePanel";
import { cn } from "@/lib/utils";
import { signOut } from "@/lib/auth/client";

type Tab = "templates" | "commercial" | "content" | "licenses";

const TABS: { id: Tab; label: string; icon: typeof Shield }[] = [
  { id: "templates", label: "إدارة القوالب", icon: LayoutTemplate },
  { id: "commercial", label: "الإعدادات التجارية", icon: Store },
  { id: "content", label: "محتوى الموقع", icon: Megaphone },
  { id: "licenses", label: "التراخيص", icon: KeyRound },
];

const input =
  "h-10 w-full rounded-lg border border-line bg-white px-3 text-[13px] font-semibold outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-white/10 dark:bg-white/5 dark:text-white";
const label = "grid gap-1.5 text-[12px] font-extrabold text-muted";
const primaryBtn =
  "inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 text-[13px] font-extrabold text-white transition hover:bg-emerald-500 disabled:opacity-50";
const ghostBtn =
  "inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-line px-3 text-[12px] font-bold transition hover:border-emerald-500/50 disabled:opacity-50 dark:border-white/10";

function readFile(file: File, as: "text" | "dataUrl"): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("read failed"));
    if (as === "text") reader.readAsText(file);
    else reader.readAsDataURL(file);
  });
}

export default function AdminDashboard() {
  const [authed, setAuthed] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("templates");

  useEffect(() => {
    setChecking(true);
    void adminVerifyFn()
      .then((res) => {
      if (!res.configured) setError("لوحة الإدارة غير مهيأة: عيّن هوية المالك على الخادم.");
      else if (!res.ok) setError("هذا الحساب لا يملك صلاحية الإدارة.");
      else setAuthed(true);
      })
      .catch(() => setError("تعذر التحقق من صلاحيات الحساب."))
      .finally(() => setChecking(false));
  }, []);

  if (!authed) {
    return (
      <div dir="rtl" className="grid min-h-screen place-items-center bg-[#07110f] p-4 text-white">
        <Toaster position="top-center" richColors dir="rtl" />
        <section className="w-full max-w-sm rounded-2xl border border-emerald-500/25 bg-white/[0.04] p-6 shadow-2xl backdrop-blur-xl">
          <div className="mb-5 flex items-center gap-3">
            <span className="grid size-11 place-items-center rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
              <Shield className="size-5" />
            </span>
            <div>
              <h1 className="text-[18px] font-black">لوحة إدارة نَسَق</h1>
              <p className="text-[12px] text-slate-400">الوصول متاح لحساب المالك الموثّق فقط</p>
            </div>
          </div>
          {checking && <p className="text-sm text-slate-300">جارٍ التحقق…</p>}
          {error && <p className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] font-bold text-red-300">{error}</p>}
          <a href="/login" className={cn(primaryBtn, "mt-4 h-11 w-full")}>تسجيل الدخول</a>
        </section>
      </div>
    );
  }

  return (
    <div dir="rtl" className="min-h-screen bg-paper text-ink dark:bg-[#111722] dark:text-white">
      <Toaster position="top-center" richColors dir="rtl" />
      <header className="sticky top-0 z-20 border-b border-line bg-white/80 backdrop-blur-md dark:border-white/10 dark:bg-[#111722]/80">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2">
            <Shield className="size-5 text-emerald-600" />
            <strong className="text-[15px] font-black">لوحة إدارة نَسَق</strong>
          </div>
          <div className="flex items-center gap-2">
            <a href="/" className={ghostBtn}>الموقع</a>
            <button
              type="button"
              className={ghostBtn}
              onClick={() => void signOut("/")}
            >
              <LogOut className="size-3.5" /> خروج
            </button>
          </div>
        </div>
        <nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-3" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-[13px] font-extrabold transition",
                tab === t.id ? "border-emerald-500 text-emerald-700 dark:text-emerald-300" : "border-transparent text-muted hover:text-ink dark:hover:text-white",
              )}
            >
              <t.icon className="size-4" />
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
        {tab === "templates" && <TemplatesTab />}
        {tab === "commercial" && <SettingsTab kind="commercial" />}
        {tab === "content" && <SettingsTab kind="content" />}
        {tab === "licenses" && (
          <div className="overflow-hidden rounded-xl border border-line dark:border-white/10">
            <AdminLicensePanel />
          </div>
        )}
      </main>
    </div>
  );
}

// ── Templates ──────────────────────────────────────────────────────────────

interface Draft {
  id?: string;
  title: string;
  description: string;
  category: string;
  tier: TemplateTier;
  status: TemplateStatus;
  kind: TemplateKind;
  content: string;
  fileName: string;
  thumbnail: string | null;
  sortOrder: number;
}

const EMPTY_DRAFT: Draft = {
  title: "",
  description: "",
  category: "general",
  tier: "free",
  status: "draft",
  kind: "json",
  content: "",
  fileName: "",
  thumbnail: null,
  sortOrder: 0,
};

function TemplatesTab() {
  const [items, setItems] = useState<AdminTemplateSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const thumbRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await adminListTemplatesFn();
    if (res.ok) setItems(res.templates);
    else toast.error(res.error);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onFile = async (file: File) => {
    const isSvg = /\.svg$/i.test(file.name) || file.type === "image/svg+xml";
    const isJson = /\.json$/i.test(file.name) || file.type === "application/json";
    if (!isSvg && !isJson) {
      toast.error("يُقبل ملف JSON (مشروع نَسَق) أو SVG فقط");
      return;
    }
    const content = await readFile(file, "text");
    if (isJson) {
      try {
        const parsed = JSON.parse(content) as { pages?: unknown[]; name?: string; thumbnail?: string };
        if (!Array.isArray(parsed.pages) || !parsed.pages.length) throw new Error();
        setDraft((d) => ({
          ...(d ?? EMPTY_DRAFT),
          kind: "json",
          content,
          fileName: file.name,
          title: d?.title || parsed.name || file.name.replace(/\.json$/i, ""),
          thumbnail: d?.thumbnail || (typeof parsed.thumbnail === "string" && parsed.thumbnail.startsWith("data:image/") ? parsed.thumbnail : null),
        }));
      } catch {
        toast.error("ملف JSON لا يحتوي على صفحات مشروع صالحة");
      }
      return;
    }
    const thumb = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(content)))}`;
    setDraft((d) => ({
      ...(d ?? EMPTY_DRAFT),
      kind: "svg",
      content,
      fileName: file.name,
      title: d?.title || file.name.replace(/\.svg$/i, ""),
      thumbnail: d?.thumbnail || (thumb.length < 600_000 ? thumb : null),
    }));
  };

  const save = async () => {
    if (!draft) return;
    if (!draft.title.trim()) return toast.error("العنوان مطلوب");
    if (!draft.id && !draft.content) return toast.error("ارفع ملف JSON أو SVG");
    setSaving(true);
    const res = await adminUpsertTemplateFn({
      data: {
        template: {
          id: draft.id,
          title: draft.title,
          description: draft.description,
          category: draft.category,
          tier: draft.tier,
          status: draft.status,
          kind: draft.kind,
          content: draft.content,
          thumbnail: draft.thumbnail,
          sortOrder: draft.sortOrder,
        },
      },
    });
    setSaving(false);
    if (!res.ok) return toast.error(res.error);
    toast.success("تم حفظ القالب");
    setDraft(null);
    void load();
  };

  const setStatus = async (id: string, patch: { status?: TemplateStatus; tier?: TemplateTier }) => {
    const res = await adminSetTemplateStatusFn({ data: { id, ...patch } });
    if (!res.ok) return toast.error(res.error);
    setItems((list) => list.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  };

  const remove = async (t: AdminTemplateSummary) => {
    if (!window.confirm(`حذف القالب «${t.title}» نهائيًا؟`)) return;
    const res = await adminDeleteTemplateFn({ data: { id: t.id } });
    if (!res.ok) return toast.error(res.error);
    setItems((list) => list.filter((x) => x.id !== t.id));
    toast.success("تم الحذف");
  };

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[18px] font-black">القوالب المُدارة</h2>
          <p className="text-[12px] text-muted">القوالب المنشورة تظهر في صفحة القوالب؛ «مرخّص» يتطلب رخصة نشطة.</p>
        </div>
        <button type="button" className={primaryBtn} onClick={() => setDraft({ ...EMPTY_DRAFT })}>
          <Plus className="size-4" /> قالب جديد
        </button>
      </div>

      {draft && (
        <section className="grid gap-4 rounded-xl border border-emerald-500/30 bg-white p-4 dark:bg-white/[0.03]">
          <div className="grid gap-3 md:grid-cols-2">
            <label className={label}>
              العنوان
              <input className={input} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
            </label>
            <label className={label}>
              التصنيف
              <input className={input} value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} />
            </label>
            <label className={cn(label, "md:col-span-2")}>
              الوصف
              <input className={input} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
            </label>
            <label className={label}>
              الإتاحة
              <select className={input} value={draft.tier} onChange={(e) => setDraft({ ...draft, tier: e.target.value as TemplateTier })}>
                <option value="free">مجاني</option>
                <option value="licensed">مرخّص (النسخة الكاملة)</option>
              </select>
            </label>
            <label className={label}>
              الحالة
              <select className={input} value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as TemplateStatus })}>
                <option value="draft">مسودة</option>
                <option value="published">منشور</option>
                <option value="archived">مؤرشف</option>
              </select>
            </label>
            <label className={label}>
              ترتيب العرض
              <input type="number" className={input} value={draft.sortOrder} onChange={(e) => setDraft({ ...draft, sortOrder: Number(e.target.value) || 0 })} />
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <input ref={fileRef} type="file" accept=".json,application/json,.svg,image/svg+xml" className="hidden" onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onFile(f);
              e.target.value = "";
            }} />
            <button type="button" className={ghostBtn} onClick={() => fileRef.current?.click()}>
              <Upload className="size-3.5" /> رفع JSON / SVG
            </button>
            <span className="text-[12px] text-muted">
              {draft.fileName ? `${draft.fileName} · ${draft.kind.toUpperCase()}` : draft.id ? "المحتوى الحالي محفوظ — ارفع ملفًا لاستبداله" : "لم يُرفع ملف بعد"}
            </span>
            <input ref={thumbRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden" onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              if (f.size > 450_000) return toast.error("الصورة المصغرة يجب ألا تتجاوز 450KB");
              setDraft((d) => (d ? { ...d, thumbnail: null } : d));
              const url = await readFile(f, "dataUrl");
              setDraft((d) => (d ? { ...d, thumbnail: url } : d));
            }} />
            <button type="button" className={ghostBtn} onClick={() => thumbRef.current?.click()}>
              <ImageIcon className="size-3.5" /> صورة مصغرة
            </button>
            {draft.thumbnail && <img src={draft.thumbnail} alt="" className="h-14 w-10 rounded border border-line bg-white object-contain" />}
          </div>

          <div className="flex gap-2">
            <button type="button" className={primaryBtn} disabled={saving} onClick={() => void save()}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} حفظ
            </button>
            <button type="button" className={ghostBtn} onClick={() => setDraft(null)}>إلغاء</button>
          </div>
        </section>
      )}

      {loading ? (
        <p className="flex items-center gap-2 text-[13px] text-muted"><Loader2 className="size-4 animate-spin" /> جارٍ التحميل…</p>
      ) : items.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line p-8 text-center text-[13px] text-muted dark:border-white/15">لا توجد قوالب مُدارة بعد.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((t) => (
            <article key={t.id} className="flex gap-3 rounded-xl border border-line bg-white p-3 dark:border-white/10 dark:bg-white/[0.03]">
              <div className="grid aspect-[210/297] w-16 shrink-0 place-items-center overflow-hidden rounded border border-line bg-white">
                {t.thumbnail ? <img src={t.thumbnail} alt="" className="h-full w-full object-contain" /> : <LayoutTemplate className="size-5 text-slate-300" />}
              </div>
              <div className="min-w-0 flex-1">
                <strong className="block truncate text-[13px]">{t.title}</strong>
                <div className="mt-1 flex flex-wrap gap-1 text-[10px] font-extrabold">
                  <span className="rounded bg-line-2 px-1.5 py-0.5 dark:bg-white/10">{t.kind.toUpperCase()}</span>
                  <span className={cn("rounded px-1.5 py-0.5", t.tier === "licensed" ? "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-200" : "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200")}>
                    {t.tier === "licensed" ? "مرخّص" : "مجاني"}
                  </span>
                  <span className="rounded bg-line-2 px-1.5 py-0.5 dark:bg-white/10">
                    {t.status === "published" ? "منشور" : t.status === "archived" ? "مؤرشف" : "مسودة"}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  <button type="button" className={ghostBtn} title={t.status === "published" ? "إلغاء النشر" : "نشر"} onClick={() => void setStatus(t.id, { status: t.status === "published" ? "draft" : "published" })}>
                    {t.status === "published" ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                  </button>
                  <button type="button" className={ghostBtn} title={t.tier === "licensed" ? "جعله مجانيًا" : "جعله مرخّصًا"} onClick={() => void setStatus(t.id, { tier: t.tier === "licensed" ? "free" : "licensed" })}>
                    {t.tier === "licensed" ? <Unlock className="size-3.5" /> : <Lock className="size-3.5" />}
                  </button>
                  <button type="button" className={ghostBtn} title="تعديل البيانات" onClick={() => setDraft({ ...EMPTY_DRAFT, ...t, content: "", fileName: "", thumbnail: t.thumbnail })}>
                    تعديل
                  </button>
                  <button type="button" className={cn(ghostBtn, "text-danger")} title="حذف" onClick={() => void remove(t)}>
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Settings (commercial + content) ────────────────────────────────────────

function SettingsTab({ kind }: { kind: "commercial" | "content" }) {
  const [settings, setSettings] = useState<PublicSiteSettings>(DEFAULT_SITE_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<SettingsSection | null>(null);

  useEffect(() => {
    void getSiteSettingsFn().then((s) => {
      setSettings(s);
      setLoading(false);
    });
  }, []);

  const save = async (section: SettingsSection) => {
    setSaving(section);
    const res = await adminSaveSettingsFn({ data: { section, value: settings[section] } });
    setSaving(null);
    if (!res.ok) return toast.error(res.error);
    setSettings((s) => ({ ...s, [section]: res.value }));
    toast.success("تم الحفظ");
  };

  if (loading) return <p className="flex items-center gap-2 text-[13px] text-muted"><Loader2 className="size-4 animate-spin" /> جارٍ التحميل…</p>;

  const c = settings.commercial;
  const setC = (patch: Partial<typeof c>) => setSettings((s) => ({ ...s, commercial: { ...s.commercial, ...patch } }));
  const a = settings.announcement;
  const setA = (patch: Partial<typeof a>) => setSettings((s) => ({ ...s, announcement: { ...s.announcement, ...patch } }));
  const t = settings.texts;
  const setT = (patch: Partial<typeof t>) => setSettings((s) => ({ ...s, texts: { ...s.texts, ...patch } }));

  const SaveBtn = ({ section }: { section: SettingsSection }) => (
    <button type="button" className={primaryBtn} disabled={saving !== null} onClick={() => void save(section)}>
      {saving === section ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} حفظ
    </button>
  );

  if (kind === "commercial") {
    return (
      <section className="grid gap-4 rounded-xl border border-line bg-white p-5 dark:border-white/10 dark:bg-white/[0.03]">
        <h2 className="text-[16px] font-black">الروابط والأسعار</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <label className={label}>رقم واتساب (دولي، أرقام فقط)<input dir="ltr" className={input} value={c.whatsappNumber} onChange={(e) => setC({ whatsappNumber: e.target.value })} /></label>
          <label className={label}>خصم الاشتراك السنوي (%)<input type="number" className={input} value={c.annualDiscountPercent} onChange={(e) => setC({ annualDiscountPercent: Number(e.target.value) })} /></label>
          <label className={cn(label, "md:col-span-2")}>رسالة واتساب لطلب الترخيص<input className={input} value={c.whatsappLicenseMessage} onChange={(e) => setC({ whatsappLicenseMessage: e.target.value })} /></label>
          <label className={cn(label, "md:col-span-2")}>رسالة واتساب للترخيص المؤسسي<input className={input} value={c.whatsappEnterpriseMessage} onChange={(e) => setC({ whatsappEnterpriseMessage: e.target.value })} /></label>
          <label className={label}>سعر الترخيص الفردي الشهري (ر.س)<input type="number" className={input} value={c.priceIndividualMonthly} onChange={(e) => setC({ priceIndividualMonthly: Number(e.target.value) })} /></label>
          <label className={label}>سعر ترخيص الفريق الشهري (ر.س)<input type="number" className={input} value={c.priceTeamMonthly} onChange={(e) => setC({ priceTeamMonthly: Number(e.target.value) })} /></label>
          <label className={label}>رابط الدفع — الفردي الشهري (https)<input dir="ltr" className={input} value={c.checkoutIndividualMonthly} onChange={(e) => setC({ checkoutIndividualMonthly: e.target.value })} placeholder="https://…lemonsqueezy.com/checkout/…" /></label>
          <label className={label}>رابط الدفع — الفريق الشهري (https)<input dir="ltr" className={input} value={c.checkoutTeamMonthly} onChange={(e) => setC({ checkoutTeamMonthly: e.target.value })} placeholder="https://…lemonsqueezy.com/checkout/…" /></label>
        </div>
        <p className="text-[11px] text-muted">روابط الدفع الفارغة تعود لإعدادات Lemon Squeezy في متغيرات البيئة.</p>
        <div><SaveBtn section="commercial" /></div>
      </section>
    );
  }

  const presets = settings.brandPresets;
  const setPresets = (next: BrandPreset[]) => setSettings((s) => ({ ...s, brandPresets: next }));
  const colorKeys: (keyof BrandPreset)[] = ["primaryColor", "secondaryColor", "accentColor", "paperColor", "textColor"];

  return (
    <div className="grid gap-5">
      <section className="grid gap-3 rounded-xl border border-line bg-white p-5 dark:border-white/10 dark:bg-white/[0.03]">
        <h2 className="text-[16px] font-black">شريط الإعلانات</h2>
        <label className="flex items-center gap-2 text-[13px] font-bold">
          <input type="checkbox" checked={a.enabled} onChange={(e) => setA({ enabled: e.target.checked })} className="size-4 accent-emerald-600" />
          إظهار الإعلان في أعلى صفحات الموقع
        </label>
        <div className="grid gap-3 md:grid-cols-[2fr_1fr_1fr]">
          <label className={label}>النص<input className={input} value={a.text} onChange={(e) => setA({ text: e.target.value })} /></label>
          <label className={label}>الرابط (اختياري)<input dir="ltr" className={input} value={a.href} onChange={(e) => setA({ href: e.target.value })} placeholder="/purchase" /></label>
          <label className={label}>النمط
            <select className={input} value={a.tone} onChange={(e) => setA({ tone: e.target.value as typeof a.tone })}>
              <option value="info">معلومة</option>
              <option value="success">نجاح</option>
              <option value="warning">تنبيه</option>
            </select>
          </label>
        </div>
        <div><SaveBtn section="announcement" /></div>
      </section>

      <section className="grid gap-3 rounded-xl border border-line bg-white p-5 dark:border-white/10 dark:bg-white/[0.03]">
        <h2 className="text-[16px] font-black">نصوص الموقع</h2>
        <p className="text-[11px] text-muted">اترك الحقل فارغًا لاستخدام النص الافتراضي.</p>
        <label className={label}>شارة الواجهة<input className={input} value={t.heroEyebrow} onChange={(e) => setT({ heroEyebrow: e.target.value })} /></label>
        <label className={label}>عنوان الواجهة<input className={input} value={t.heroTitle} onChange={(e) => setT({ heroTitle: e.target.value })} /></label>
        <label className={label}>وصف الواجهة<textarea className={cn(input, "h-20 py-2")} value={t.heroDescription} onChange={(e) => setT({ heroDescription: e.target.value })} /></label>
        <label className={label}>ملاحظة التذييل<input className={input} value={t.footerNote} onChange={(e) => setT({ footerNote: e.target.value })} /></label>
        <div><SaveBtn section="texts" /></div>
      </section>

      <section className="grid gap-3 rounded-xl border border-line bg-white p-5 dark:border-white/10 dark:bg-white/[0.03]">
        <div className="flex items-center justify-between">
          <h2 className="text-[16px] font-black">لوحات الهوية الافتراضية (Brand Kit)</h2>
          <button type="button" className={ghostBtn} onClick={() => setPresets([...presets, { id: `preset-${Date.now()}`, name: "لوحة جديدة", primaryColor: "#0c3d2c", secondaryColor: "#145c42", accentColor: "#c6a05a", paperColor: "#fbfaf6", textColor: "#1f2937" }])}>
            <Plus className="size-3.5" /> إضافة لوحة
          </button>
        </div>
        {presets.length === 0 && <p className="text-[12px] text-muted">لا توجد لوحات مخصصة — تُعرض اللوحات المدمجة في صفحة الهوية.</p>}
        {presets.map((p, i) => (
          <div key={p.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-line p-2 dark:border-white/10">
            <input className={cn(input, "w-40")} value={p.name} onChange={(e) => setPresets(presets.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} aria-label="اسم اللوحة" />
            {colorKeys.map((k) => (
              <input key={k} type="color" value={String(p[k])} aria-label={k} className="h-9 w-10 cursor-pointer rounded border border-line bg-transparent dark:border-white/10" onChange={(e) => setPresets(presets.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)))} />
            ))}
            <button type="button" className={cn(ghostBtn, "text-danger")} onClick={() => setPresets(presets.filter((_, j) => j !== i))} aria-label="حذف اللوحة">
              <Trash2 className="size-3.5" />
            </button>
          </div>
        ))}
        <div><SaveBtn section="brandPresets" /></div>
      </section>
    </div>
  );
}
