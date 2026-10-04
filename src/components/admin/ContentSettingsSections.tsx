/*
 * Site settings, split by authority and address.
 *
 * The old console kept «الإعدادات التجارية» and «محتوى الموقع» as two tabs of
 * one component; the console now has a URL per function, so each becomes its
 * own section — and «الهوية» (the brand palettes) becomes a third, because
 * identity is not the same decision as an announcement bar.
 *
 * All three share one server contract (`adminSaveSettingsFn` per section) and
 * one draft state, so saving a section never writes another section's value.
 */

import { useEffect, useState } from "react";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import {
  ADMIN_TEMPLATES_CHANGED_EVENT,
  invalidateSiteSettings,
} from "@/lib/admin/use-site-settings";
import {
  adminListTemplatesFn,
  adminSaveSettingsFn,
  getSiteSettingsFn,
} from "@/lib/admin/functions";
import {
  DEFAULT_SITE_SETTINGS,
  type AdminTemplateSummary,
  type BrandPreset,
  type PublicSiteSettings,
  type SettingsSection,
} from "@/lib/admin/types";
import { ADMIN_ROUTES } from "@/lib/site-routes";
import { cn } from "@/lib/utils";

const input =
  "h-10 w-full rounded-lg border border-line bg-surface px-3 text-[13px] font-semibold outline-none focus:border-brand focus:ring-1 focus:ring-brand/40";
const label = "grid gap-1.5 text-[12px] font-extrabold text-muted";
const primaryBtn =
  "inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-navy px-4 text-[13px] font-extrabold text-on-brand transition hover:bg-ok disabled:opacity-50";

/** Shared loader: the settings draft plus the published-template catalogue. */
function useSettingsDraft(needCatalog: boolean) {
  const [settings, setSettings] = useState<PublicSiteSettings>(DEFAULT_SITE_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<SettingsSection | null>(null);
  const [catalog, setCatalog] = useState<AdminTemplateSummary[]>([]);

  useEffect(() => {
    let alive = true;
    void getSiteSettingsFn().then((value) => {
      if (!alive) return;
      setSettings(value);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!needCatalog) return;
    let alive = true;
    const loadCatalog = () => {
      void adminListTemplatesFn()
        .then((result) => {
          if (!alive) return;
          if (!result.ok) {
            toast.error(result.error);
            return;
          }
          setCatalog(result.templates);
        })
        .catch(() => {
          if (alive) toast.error("تعذر تحميل سجل القوالب المنشورة");
        });
    };
    loadCatalog();
    window.addEventListener(ADMIN_TEMPLATES_CHANGED_EVENT, loadCatalog);
    return () => {
      alive = false;
      window.removeEventListener(ADMIN_TEMPLATES_CHANGED_EVENT, loadCatalog);
    };
  }, [needCatalog]);

  const save = async (section: SettingsSection) => {
    setSaving(section);
    try {
      const result = await adminSaveSettingsFn({
        data: { section, value: settings[section] },
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setSettings((current) => ({ ...current, [section]: result.value }));
      invalidateSiteSettings();
      toast.success("تم الحفظ");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "تعذر حفظ الإعدادات");
    } finally {
      setSaving(null);
    }
  };

  const SaveButton = ({ section }: { section: SettingsSection }) => (
    <button
      type="button"
      className={primaryBtn}
      disabled={saving !== null}
      onClick={() => void save(section)}
    >
      {saving === section ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <Save className="size-4" />
      )}
      حفظ
    </button>
  );

  return { settings, setSettings, loading, catalog, SaveButton };
}

function Loading() {
  return (
    <p className="flex items-center gap-2 text-[13px] text-muted">
      <Loader2 className="size-4 animate-spin" /> جارٍ التحميل…
    </p>
  );
}

/* ── commercial ───────────────────────────────────────────────────────── */

export function AdminCommercialSection() {
  const { settings, setSettings, loading, SaveButton } = useSettingsDraft(false);
  if (loading) return <Loading />;
  const commercial = settings.commercial;
  const set = (patch: Partial<typeof commercial>) =>
    setSettings((current) => ({
      ...current,
      commercial: { ...current.commercial, ...patch },
    }));

  return (
    <div className="grid gap-5">
      <section className="grid gap-4 rounded-xl border border-line bg-surface p-5">
        <h2 className="text-[16px] font-black">الروابط والأسعار</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <label className={label}>
            رقم واتساب (دولي، أرقام فقط)
            <input
              dir="ltr"
              className={input}
              value={commercial.whatsappNumber}
              onChange={(event) => set({ whatsappNumber: event.target.value })}
            />
          </label>
          <label className={cn(label, "md:col-span-2")}>
            رسالة واتساب لطلب الترخيص
            <input
              className={input}
              value={commercial.whatsappLicenseMessage}
              onChange={(event) => set({ whatsappLicenseMessage: event.target.value })}
            />
          </label>
          <label className={cn(label, "md:col-span-2")}>
            رسالة واتساب للترخيص المؤسسي
            <input
              className={input}
              value={commercial.whatsappEnterpriseMessage}
              onChange={(event) => set({ whatsappEnterpriseMessage: event.target.value })}
            />
          </label>
        </div>
        <p className="text-[11px] text-muted">
          الأسعار والمدد ثابتة من الكتالوج المركزي. يتم الدفع عبر Gumroad، ويُفعَّل
          الاشتراك خادميًا عبر Keygen بعد تأكيد العملية.
        </p>
        <div>
          <SaveButton section="commercial" />
        </div>
      </section>

      <section className="rounded-xl border border-line bg-surface p-5">
        <h2 className="text-[16px] font-black">الباقات والاشتراكات</h2>
        <p className="mt-2 text-[12px] leading-6 text-muted">
          تعديل الخطط والأسعار وحالات الاشتراك يتم من قسم{" "}
          <a href={ADMIN_ROUTES.plans} className="font-extrabold text-brand hover:underline">
            الباقات
          </a>
          ، وطلبات الدفع والموافقات من قسم{" "}
          <a href={ADMIN_ROUTES.payments} className="font-extrabold text-brand hover:underline">
            المدفوعات
          </a>
          .
        </p>
      </section>
    </div>
  );
}

/* ── site content ─────────────────────────────────────────────────────── */

export function AdminContentSection() {
  const { settings, setSettings, loading, catalog, SaveButton } = useSettingsDraft(true);
  if (loading) return <Loading />;
  const announcement = settings.announcement;
  const setAnnouncement = (patch: Partial<typeof announcement>) =>
    setSettings((current) => ({
      ...current,
      announcement: { ...current.announcement, ...patch },
    }));
  const texts = settings.texts;
  const setTexts = (patch: Partial<typeof texts>) =>
    setSettings((current) => ({ ...current, texts: { ...current.texts, ...patch } }));

  const featureCandidates = catalog
    .filter((item) => item.status === "published" && item.tier === "free")
    .sort((a, b) => a.title.localeCompare(b.title, "ar"));
  const selectedFeature = catalog.find((item) => item.id === texts.featuredTemplateId);
  const selectedFeatureIsPublic = Boolean(
    selectedFeature && selectedFeature.status === "published" && selectedFeature.tier === "free",
  );

  return (
    <div className="grid gap-5">
      <section className="grid gap-3 rounded-xl border border-line bg-surface p-5">
        <h2 className="text-[16px] font-black">شريط الإعلانات</h2>
        <label className="flex items-center gap-2 text-[13px] font-bold">
          <input
            type="checkbox"
            checked={announcement.enabled}
            onChange={(event) => setAnnouncement({ enabled: event.target.checked })}
            className="size-4 accent-navy"
          />
          إظهار الإعلان في أعلى صفحات الموقع
        </label>
        <div className="grid gap-3 md:grid-cols-[2fr_1fr_1fr]">
          <label className={label}>
            النص
            <input
              className={input}
              value={announcement.text}
              onChange={(event) => setAnnouncement({ text: event.target.value })}
            />
          </label>
          <label className={label}>
            الرابط (اختياري)
            <input
              dir="ltr"
              className={input}
              value={announcement.href}
              onChange={(event) => setAnnouncement({ href: event.target.value })}
              placeholder="/purchase"
            />
          </label>
          <label className={label}>
            النمط
            <select
              className={input}
              value={announcement.tone}
              onChange={(event) =>
                setAnnouncement({ tone: event.target.value as typeof announcement.tone })
              }
            >
              <option value="info">معلومة</option>
              <option value="success">نجاح</option>
              <option value="warning">تنبيه</option>
            </select>
          </label>
        </div>
        <div>
          <SaveButton section="announcement" />
        </div>
      </section>

      <section className="grid gap-3 rounded-xl border border-line bg-surface p-5">
        <h2 className="text-[16px] font-black">نصوص الموقع</h2>
        <p className="text-[11px] text-muted">اترك الحقل فارغًا لاستخدام النص الافتراضي.</p>
        <label className={label}>
          شارة الواجهة
          <input
            className={input}
            value={texts.heroEyebrow}
            onChange={(event) => setTexts({ heroEyebrow: event.target.value })}
          />
        </label>
        <label className={label}>
          عنوان الواجهة
          <input
            className={input}
            value={texts.heroTitle}
            onChange={(event) => setTexts({ heroTitle: event.target.value })}
          />
        </label>
        <label className={label}>
          وصف الواجهة
          <textarea
            className={cn(input, "h-20 py-2")}
            value={texts.heroDescription}
            onChange={(event) => setTexts({ heroDescription: event.target.value })}
          />
        </label>
        <label className={label}>
          ملاحظة التذييل
          <input
            className={input}
            value={texts.footerNote}
            onChange={(event) => setTexts({ footerNote: event.target.value })}
          />
        </label>
        <section className="grid gap-3 border-t border-line pt-4">
          <div>
            <h3 className="text-[13px] font-extrabold text-ink">
              المستند المميز في الصفحة الرئيسية
            </h3>
            <p className="mt-1 max-w-2xl text-[11px] leading-5 text-muted">
              اختر سجلًا منشورًا مجانيًا من كتالوج القوالب. المعاينة الحية تفتح
              محتوى السجل نفسه.
            </p>
          </div>
          <label className={label}>
            سجل القالب المنشور
            <select
              className={input}
              value={selectedFeatureIsPublic ? texts.featuredTemplateId : ""}
              onChange={(event) => setTexts({ featuredTemplateId: event.currentTarget.value })}
            >
              <option value="">بدون مستند مميز</option>
              {featureCandidates.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title} · {item.category}
                </option>
              ))}
            </select>
          </label>
          {texts.featuredTemplateId && !selectedFeatureIsPublic && (
            <div
              role="alert"
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-[11px] font-bold text-error"
            >
              <span>السجل المحفوظ غير منشور أو يتطلب ترخيصًا، لذلك لا يظهر في المعاينة العامة.</span>
              <button
                type="button"
                className="inline-flex h-8 items-center rounded-lg border border-line px-2.5 text-[11px] font-bold"
                onClick={() => setTexts({ featuredTemplateId: "" })}
              >
                إزالة التحديد
              </button>
            </div>
          )}
        </section>
        <div>
          <SaveButton section="texts" />
        </div>
      </section>
    </div>
  );
}

/* ── brand identity ───────────────────────────────────────────────────── */

export function AdminBrandingSection() {
  const { settings, setSettings, loading, SaveButton } = useSettingsDraft(false);
  if (loading) return <Loading />;
  const presets = settings.brandPresets;
  const setPresets = (next: BrandPreset[]) =>
    setSettings((current) => ({ ...current, brandPresets: next }));
  const colorKeys: (keyof BrandPreset)[] = [
    "primaryColor",
    "secondaryColor",
    "accentColor",
    "paperColor",
    "textColor",
  ];

  return (
    <div className="grid gap-5">
      <section className="grid gap-3 rounded-xl border border-line bg-surface p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[16px] font-black">لوحات الهوية الافتراضية (Brand Kit)</h2>
          <button
            type="button"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line px-3 text-[12px] font-bold"
            onClick={() =>
              setPresets([
                ...presets,
                {
                  id: `preset-${Date.now()}`,
                  name: "لوحة جديدة",
                  primaryColor: "#0c3d2c",
                  secondaryColor: "#145c42",
                  accentColor: "#c6a05a",
                  paperColor: "#fbfaf6",
                  textColor: "#1f2937",
                },
              ])
            }
          >
            إضافة لوحة
          </button>
        </div>
        <p className="text-[11px] text-muted">
          تُعرض هذه اللوحات في صفحة الهوية وفي مُنتقي الألوان بالقوالب. اللوحات
          المدمجة تبقى متاحة دائمًا.
        </p>
        {presets.length === 0 && (
          <p className="text-[12px] text-muted">
            لا توجد لوحات مخصصة — تُعرض اللوحات المدمجة في{" "}
            <a href="/الهوية" className="font-extrabold text-brand hover:underline">
              صفحة الهوية
            </a>
            .
          </p>
        )}
        {presets.map((preset, index) => (
          <div key={preset.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-line p-2">
            <input
              className={cn(input, "w-40")}
              value={preset.name}
              onChange={(event) =>
                setPresets(
                  presets.map((item, i) => (i === index ? { ...item, name: event.target.value } : item)),
                )
              }
              aria-label="اسم اللوحة"
            />
            {colorKeys.map((key) => (
              <input
                key={key}
                type="color"
                value={String(preset[key])}
                aria-label={String(key)}
                className="h-9 w-10 cursor-pointer rounded border border-line bg-transparent"
                onChange={(event) =>
                  setPresets(
                    presets.map((item, i) =>
                      i === index ? { ...item, [key]: event.target.value } : item,
                    ),
                  )
                }
              />
            ))}
            <button
              type="button"
              className="inline-flex h-9 items-center rounded-lg border border-line px-2.5 text-error"
              onClick={() => setPresets(presets.filter((_, i) => i !== index))}
              aria-label="حذف اللوحة"
            >
              حذف
            </button>
          </div>
        ))}
        <div>
          <SaveButton section="brandPresets" />
        </div>
      </section>
    </div>
  );
}
