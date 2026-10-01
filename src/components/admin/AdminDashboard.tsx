/**
 * /admin — NASAQ administration dashboard.
 *
 * Every privileged call is authorized from the verified Better Auth session.
 * Owner configuration stays server-side; all changes remain persisted in
 * site_settings / admin_templates.
 */
import { useEffect, useState } from "react";
import {
  Shield,
  LayoutTemplate,
  Store,
  Megaphone,
  Image as ImageIcon,
  KeyRound,
  Trash2,
  Loader2,
  Save,
  Plus,
  LogOut,
} from "lucide-react";
import { toast } from "sonner";
import { ThemedToaster } from "@/components/ui/ThemedToaster";
import {
  adminSaveSettingsFn,
  adminTemplatesAccessFn,
  getSiteSettingsFn,
} from "@/lib/admin/functions";
import {
  DEFAULT_SITE_SETTINGS,
  type BrandPreset,
  type PublicSiteSettings,
  type SettingsSection,
} from "@/lib/admin/types";
import AdminLicensePanel from "@/components/license/AdminLicensePanel";
import { AdminTemplatesPanel } from "@/components/admin/AdminTemplatesPanel";
import { SiteImagesPanel } from "@/components/admin/SiteImagesPanel";
import { cn } from "@/lib/utils";
import { signOut } from "@/lib/auth/client";

type Tab = "templates" | "commercial" | "content" | "images" | "licenses";

const TABS: { id: Tab; label: string; icon: typeof Shield }[] = [
  { id: "templates", label: "إدارة القوالب", icon: LayoutTemplate },
  { id: "commercial", label: "الإعدادات التجارية", icon: Store },
  { id: "content", label: "محتوى الموقع", icon: Megaphone },
  { id: "images", label: "صور الموقع", icon: ImageIcon },
  { id: "licenses", label: "التراخيص", icon: KeyRound },
];

const input =
 "h-10 w-full rounded-lg border border-line bg-surface px-3 text-[13px] font-semibold outline-none focus:border-brand focus:ring-1 focus:ring-brand/40";
const label = "grid gap-1.5 text-[12px] font-extrabold text-muted";
const primaryBtn =
 "inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-navy px-4 text-[13px] font-extrabold text-on-brand transition hover:bg-ok disabled:opacity-50";
const ghostBtn =
 "inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-line px-3 text-[12px] font-bold transition hover:border-brand/30 disabled:opacity-50";

export default function AdminDashboard() {
  const [authed, setAuthed] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("templates");

  /*
   * The panel owns the platform's PAID template catalogue, so it asks the
   * server's owner gate — not a client-side flag — before it shows a single
   * row. The route's `beforeLoad` already redirected a caller with no session;
   * this is the check that keeps the component honest when it is reached from
   * inside the app (and re-checked on every server call below).
   */
  useEffect(() => {
    let alive = true;
    setChecking(true);
    void (async () => {
      try {
        const access = await adminTemplatesAccessFn();
        if (!alive) return;
        if (access.ok) setAuthed(true);
        else setError(access.error);
      } catch {
        if (alive) setError("يجب تسجيل الدخول بحساب المالك للوصول إلى لوحة إدارة القوالب.");
      } finally {
        if (alive) setChecking(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (!authed) {
    return (
      <div dir="rtl" className="grid min-h-screen place-items-center bg-[#07110f] p-4 text-on-inverse">
        <ThemedToaster position="top-center" richColors dir="rtl" />
        <section className="w-full max-w-sm rounded-2xl border border-brand bg-surface/[0.04] p-6 shadow-2xl backdrop-blur-xl">
          <div className="mb-5 flex items-center gap-3">
            <span className="grid size-11 place-items-center rounded-xl border border-brand bg-ok/10 text-success">
              <Shield className="size-5" />
            </span>
            <div>
              <h1 className="text-[18px] font-black">لوحة إدارة نَسَق</h1>
              <p className="text-[12px] text-muted">الوصول متاح لحساب المالك الموثّق فقط</p>
            </div>
          </div>
          {checking && <p className="text-sm text-muted">جارٍ التحقق…</p>}
          {error && <p className="mt-3 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[12px] font-bold text-red-300">{error}</p>}
          <a href="/login" className={cn(primaryBtn, "mt-4 h-11 w-full")}>تسجيل الدخول</a>
        </section>
      </div>
    );
  }

  return (
    <div dir="rtl" className="min-h-screen bg-paper text-ink">
      <ThemedToaster position="top-center" richColors dir="rtl" />
      <header className="sticky top-0 z-20 border-b border-line bg-surface/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2">
            <Shield className="size-5 text-brand" />
            <strong className="text-[15px] font-black">لوحة إدارة نَسَق</strong>
          </div>
          <div className="flex items-center gap-2">
            <a href="/owner-vault" className={ghostBtn}><KeyRound className="size-3.5" /> Owner Vault</a>
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
                tab === t.id ? "border-brand text-success" : "border-transparent text-muted hover:text-ink",
              )}
            >
              <t.icon className="size-4" />
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
        {tab === "templates" && <AdminTemplatesPanel />}
        {tab === "commercial" && <SettingsTab kind="commercial" />}
        {tab === "content" && <SettingsTab kind="content" />}
        {tab === "images" && <SiteImagesPanel />}
        {tab === "licenses" && (
          <div className="overflow-hidden rounded-xl border border-line">
            <AdminLicensePanel />
          </div>
        )}
      </main>
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
      <section className="grid gap-4 rounded-xl border border-line bg-surface p-5">
        <h2 className="text-[16px] font-black">الروابط والأسعار</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <label className={label}>رقم واتساب (دولي، أرقام فقط)<input dir="ltr" className={input} value={c.whatsappNumber} onChange={(e) => setC({ whatsappNumber: e.target.value })} /></label>
          <label className={cn(label, "md:col-span-2")}>رسالة واتساب لطلب الترخيص<input className={input} value={c.whatsappLicenseMessage} onChange={(e) => setC({ whatsappLicenseMessage: e.target.value })} /></label>
          <label className={cn(label, "md:col-span-2")}>رسالة واتساب للترخيص المؤسسي<input className={input} value={c.whatsappEnterpriseMessage} onChange={(e) => setC({ whatsappEnterpriseMessage: e.target.value })} /></label>
        </div>
        <p className="text-[11px] text-muted">الأسعار والمدد ثابتة من الكتالوج المركزي. يتم الدفع عبر Gumroad، ويُفعَّل الاشتراك خادميًا عبر Keygen بعد تأكيد العملية.</p>
        <div><SaveBtn section="commercial" /></div>
      </section>
    );
  }

  const presets = settings.brandPresets;
  const setPresets = (next: BrandPreset[]) => setSettings((s) => ({ ...s, brandPresets: next }));
  const colorKeys: (keyof BrandPreset)[] = ["primaryColor", "secondaryColor", "accentColor", "paperColor", "textColor"];

  return (
    <div className="grid gap-5">
      <section className="grid gap-3 rounded-xl border border-line bg-surface p-5">
        <h2 className="text-[16px] font-black">شريط الإعلانات</h2>
        <label className="flex items-center gap-2 text-[13px] font-bold">
          <input type="checkbox" checked={a.enabled} onChange={(e) => setA({ enabled: e.target.checked })} className="size-4 accent-navy" />
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

      <section className="grid gap-3 rounded-xl border border-line bg-surface p-5">
        <h2 className="text-[16px] font-black">نصوص الموقع</h2>
        <p className="text-[11px] text-muted">اترك الحقل فارغًا لاستخدام النص الافتراضي.</p>
        <label className={label}>شارة الواجهة<input className={input} value={t.heroEyebrow} onChange={(e) => setT({ heroEyebrow: e.target.value })} /></label>
        <label className={label}>عنوان الواجهة<input className={input} value={t.heroTitle} onChange={(e) => setT({ heroTitle: e.target.value })} /></label>
        <label className={label}>وصف الواجهة<textarea className={cn(input, "h-20 py-2")} value={t.heroDescription} onChange={(e) => setT({ heroDescription: e.target.value })} /></label>
        <label className={label}>ملاحظة التذييل<input className={input} value={t.footerNote} onChange={(e) => setT({ footerNote: e.target.value })} /></label>
        <div><SaveBtn section="texts" /></div>
      </section>

      <section className="grid gap-3 rounded-xl border border-line bg-surface p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-[16px] font-black">لوحات الهوية الافتراضية (Brand Kit)</h2>
          <button type="button" className={ghostBtn} onClick={() => setPresets([...presets, { id: `preset-${Date.now()}`, name: "لوحة جديدة", primaryColor: "#0c3d2c", secondaryColor: "#145c42", accentColor: "#c6a05a", paperColor: "#fbfaf6", textColor: "#1f2937" }])}>
            <Plus className="size-3.5" /> إضافة لوحة
          </button>
        </div>
        {presets.length === 0 && <p className="text-[12px] text-muted">لا توجد لوحات مخصصة — تُعرض اللوحات المدمجة في صفحة الهوية.</p>}
        {presets.map((p, i) => (
          <div key={p.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-line p-2">
            <input className={cn(input, "w-40")} value={p.name} onChange={(e) => setPresets(presets.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} aria-label="اسم اللوحة" />
            {colorKeys.map((k) => (
              <input key={k} type="color" value={String(p[k])} aria-label={k} className="h-9 w-10 cursor-pointer rounded border border-line bg-transparent" onChange={(e) => setPresets(presets.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)))} />
            ))}
            <button type="button" className={cn(ghostBtn, "text-error")} onClick={() => setPresets(presets.filter((_, j) => j !== i))} aria-label="حذف اللوحة">
              <Trash2 className="size-3.5" />
            </button>
          </div>
        ))}
        <div><SaveBtn section="brandPresets" /></div>
      </section>
    </div>
  );
}
