import { useEffect, useState } from "react";
import {
  CheckCircle2,
  Database,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  X,
  Eye,
  AlertCircle,
} from "lucide-react";
import { toast } from "sonner";
import {
  listStudioReferencesFn,
  mutateStudioReferenceFn,
  getStudioSettingsFn,
  updateStudioSettingsFn,
} from "@/lib/intelligence/admin-functions";
import {
  REFERENCE_CATEGORIES,
  type StudioGenerationSettings,
  type StudioVisualReference,
} from "@/lib/intelligence/references-manager";
import type { DesignFormat, DesignStyle } from "@/lib/intelligence/schema";
import { DESIGN_STYLES } from "@/lib/intelligence/schema";
import { cn } from "@/lib/utils";

const btnPrimary =
  "inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-navy px-3 text-[12px] font-extrabold text-on-brand transition hover:bg-navy-2 disabled:opacity-50";
const btnGhost =
  "inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-line px-3 text-[12px] font-bold text-ink transition hover:border-brand disabled:opacity-50";

export function AdminStudioKnowledgeBase() {
  const [references, setReferences] = useState<StudioVisualReference[]>([]);
  const [settings, setSettings] = useState<StudioGenerationSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // Filters
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [selectedApproval, setSelectedApproval] = useState<"all" | "approved" | "unapproved">("all");
  const [searchQuery, setSearchQuery] = useState("");

  // Modal states
  const [showAddModal, setShowAddModal] = useState(false);
  const [previewRef, setPreviewRef] = useState<StudioVisualReference | null>(null);

  // New Reference Form State
  const [newTitle, setNewTitle] = useState("");
  const [newCategory, setNewCategory] = useState("reports");
  const [newStyle, setNewStyle] = useState<DesignStyle>("institutional");
  const [newFormat, setNewFormat] = useState<DesignFormat>("a4-book");
  const [newPages, setNewPages] = useState(4);
  const [newDesc, setNewDesc] = useState("");
  const [newFieldColor, setNewFieldColor] = useState("#0c3d2c");
  const [newAccentColor, setNewAccentColor] = useState("#c6a05a");

  const loadData = async () => {
    setLoading(true);
    try {
      const [refRes, setRes] = await Promise.all([
        listStudioReferencesFn(),
        getStudioSettingsFn(),
      ]);
      if (refRes.ok) setReferences(refRes.references);
      if (setRes.ok) setSettings(setRes.settings);
    } catch {
      toast.error("تعذر تحميل قاعدة المعرفة");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const handleToggleApproved = async (ref: StudioVisualReference) => {
    setBusy(true);
    try {
      const res = await mutateStudioReferenceFn({
        data: {
          op: "toggle_approved",
          id: ref.id,
          approved: !ref.approved,
        },
      });
      if (res.ok) {
        setReferences(res.references);
        toast.success(ref.approved ? "تم إلغاء اعتماد المرجع" : "تم اعتماد المرجع كمرجع رسمي");
      } else {
        toast.error(res.error || "تعذر تحديث المرجع");
      }
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("هل أنت متأكد من حذف هذا المرجع من قاعدة المعرفة؟")) return;
    setBusy(true);
    try {
      const res = await mutateStudioReferenceFn({
        data: { op: "delete", id },
      });
      if (res.ok) {
        setReferences(res.references);
        toast.success("تم حذف المرجع بنجاح");
      } else {
        toast.error(res.error || "تعذر الحذف");
      }
    } finally {
      setBusy(false);
    }
  };

  const handleResetDefaults = async () => {
    if (!window.confirm("إعادة تعيين كافة المراجع إلى الحزمة المعيارية الأصلية؟")) return;
    setBusy(true);
    try {
      const res = await mutateStudioReferenceFn({
        data: { op: "reset_defaults" },
      });
      if (res.ok) {
        setReferences(res.references);
        toast.success("تمت استعادة المراجع المعيارية");
      }
    } finally {
      setBusy(false);
    }
  };

  const handleCreateReference = async () => {
    if (!newTitle.trim()) {
      toast.error("عنوان المرجع مطلوب");
      return;
    }
    setBusy(true);
    try {
      const res = await mutateStudioReferenceFn({
        data: {
          op: "create",
          reference: {
            title: newTitle.trim(),
            category: newCategory,
            style: newStyle,
            format: newFormat,
            pages: newPages,
            approved: true,
            palette: {
              field: newFieldColor,
              paper: "#faf8f4",
              ink: "#17231c",
              accent: newAccentColor,
              muted: "#5c6660",
              onField: "#faf8f4",
            },
            tags: ["مرجع مخصص", newCategory, newStyle],
            dimensions:
              newFormat === "wide-slide"
                ? { w: 338.7, h: 190.5 }
                : newFormat === "tall-story"
                  ? { w: 210, h: 560 }
                  : { w: 210, h: 297 },
            components: ["cover", "title-block", "running-head", "footer", "kpi"],
            description: newDesc.trim() || "مرجع تصميم مؤسسي مضاف بواسطة الإدارة.",
          },
        },
      });
      if (res.ok) {
        setReferences(res.references);
        setShowAddModal(false);
        setNewTitle("");
        setNewDesc("");
        toast.success("تمت إضافة المرجع بنجاح");
      } else {
        toast.error(res.error || "تعذر إضافة المرجع");
      }
    } finally {
      setBusy(false);
    }
  };

  const handleToggleSource = async (key: keyof StudioGenerationSettings["enabledSources"]) => {
    if (!settings) return;
    const nextSources = {
      ...settings.enabledSources,
      [key]: !settings.enabledSources[key],
    };
    try {
      const res = await updateStudioSettingsFn({
        data: { enabledSources: nextSources },
      });
      if (res.ok) {
        setSettings(res.settings);
        toast.success("تم تحديث مصادر التوليد");
      }
    } catch {
      toast.error("تعذر تحديث الإعدادات");
    }
  };

  // Filtered list
  const filtered = references.filter((item) => {
    if (selectedCategory !== "all" && item.category !== selectedCategory) return false;
    if (selectedApproval === "approved" && !item.approved) return false;
    if (selectedApproval === "unapproved" && item.approved) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const inTitle = item.title.toLowerCase().includes(q);
      const inDesc = item.description?.toLowerCase().includes(q);
      if (!inTitle && !inDesc) return false;
    }
    return true;
  });

  const approvedCount = references.filter((r) => r.approved).length;

  return (
    <div className="grid gap-6 text-ink" dir="rtl">
      {/* ----------------- Stats Cards ----------------- */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-line bg-surface p-4 shadow-sm">
          <span className="text-[11px] font-bold text-muted">إجمالي المراجع البصرية</span>
          <p className="mt-1 text-[22px] font-black text-ink">{references.length}</p>
          <span className="text-[10px] text-muted">قاعدة معرفة نشطة لاستوديو القوالب</span>
        </div>

        <div className="rounded-xl border border-line bg-surface p-4 shadow-sm">
          <span className="text-[11px] font-bold text-muted">المراجع المعتمدة للتوليد</span>
          <p className="mt-1 text-[22px] font-black text-success">{approvedCount}</p>
          <span className="text-[10px] text-muted">تُستخلص منها أنماط التوليد الذكي</span>
        </div>

        <div className="rounded-xl border border-line bg-surface p-4 shadow-sm">
          <span className="text-[11px] font-bold text-muted">التصنيفات المتاحة</span>
          <p className="mt-1 text-[22px] font-black text-ink">{REFERENCE_CATEGORIES.length - 1}</p>
          <span className="text-[10px] text-muted">تقارير، عروض، هويات، وعقود</span>
        </div>

        <div className="rounded-xl border border-line bg-surface p-4 shadow-sm">
          <span className="text-[11px] font-bold text-muted">أنماط التصميم المدعومة</span>
          <p className="mt-1 text-[22px] font-black text-brand">{DESIGN_STYLES.length}</p>
          <span className="text-[10px] text-muted">مؤسسي، حكومي، تنفيذي، تحريري، تقني</span>
        </div>
      </div>

      {/* ----------------- Template Sources Control ----------------- */}
      {settings && (
        <section className="rounded-xl border border-line bg-surface p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="flex items-center gap-2 text-[14px] font-black">
                <Database className="size-4 text-brand" />
                مصادر المعرفة التصميمية للتوليد الذكي
              </h3>
              <p className="text-[11px] font-semibold text-muted">
                تحديد أي مصادر يتم تدريب واستخلاص القواعد البصرية منها أثناء التوليد
              </p>
            </div>

            <button
              type="button"
              onClick={() => void handleResetDefaults()}
              disabled={busy}
              className={btnGhost}
            >
              <RotateCcw className="size-3.5" />
              استعادة المراجع المعيارية
            </button>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="flex items-center gap-2.5 rounded-lg border border-line p-3 transition hover:bg-surface-2 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.enabledSources.referenceCorpus}
                onChange={() => void handleToggleSource("referenceCorpus")}
                className="size-4 rounded text-brand focus:ring-brand"
              />
              <span className="text-[12px] font-bold">حزمة المراجع المقيسة المعتمدة</span>
            </label>

            <label className="flex items-center gap-2.5 rounded-lg border border-line p-3 transition hover:bg-surface-2 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.enabledSources.nativeTemplates}
                onChange={() => void handleToggleSource("nativeTemplates")}
                className="size-4 rounded text-brand focus:ring-brand"
              />
              <span className="text-[12px] font-bold">قوالب نَسَق الأصلية المدمجة</span>
            </label>

            <label className="flex items-center gap-2.5 rounded-lg border border-line p-3 transition hover:bg-surface-2 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.enabledSources.psdImports}
                onChange={() => void handleToggleSource("psdImports")}
                className="size-4 rounded text-brand focus:ring-brand"
              />
              <span className="text-[12px] font-bold">الملفات المستوردة عبر PSD</span>
            </label>

            <label className="flex items-center gap-2.5 rounded-lg border border-line p-3 transition hover:bg-surface-2 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.enabledSources.institutionalBackgrounds}
                onChange={() => void handleToggleSource("institutionalBackgrounds")}
                className="size-4 rounded text-brand focus:ring-brand"
              />
              <span className="text-[12px] font-bold">الخلفيات المؤسسية واللوحات</span>
            </label>
          </div>
        </section>
      )}

      {/* ----------------- Visual Reference Asset Manager ----------------- */}
      <section className="grid gap-4 rounded-xl border border-line bg-surface p-5 shadow-sm">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
          <div>
            <h2 className="text-[15px] font-black">إدارة المراجع البصرية (Reference Assets)</h2>
            <p className="text-[11px] font-semibold text-muted">
              تنظيم المراجع، تعيين التصنيفات، واعتماد المصادر الموثوقة. المراجع تُستخدم داخلياً
              ولا تظهر أسماء ملفاتها للمستخدم النهائي.
            </p>
          </div>

          <button
            type="button"
            onClick={() => setShowAddModal(true)}
            className={btnPrimary}
          >
            <Plus className="size-3.5" />
            إضافة مرجع جديد
          </button>
        </header>

        {/* Filters bar */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {REFERENCE_CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                type="button"
                onClick={() => setSelectedCategory(cat.id)}
                className={cn(
                  "rounded-lg px-2.5 py-1 text-[11px] font-bold transition",
                  selectedCategory === cat.id
                    ? "bg-navy text-on-brand"
                    : "border border-line bg-surface text-muted hover:border-brand hover:text-brand",
                )}
              >
                {cat.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={selectedApproval}
              onChange={(e) => setSelectedApproval(e.target.value as any)}
              className="h-8 rounded-lg border border-line bg-surface px-2 text-[11px] font-bold text-muted"
            >
              <option value="all">كافة الحالات</option>
              <option value="approved">المعتمدة فقط</option>
              <option value="unapproved">قيد المراجعة</option>
            </select>

            <div className="relative">
              <Search className="absolute right-2.5 top-2 size-3.5 text-muted" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="بحث في المراجع…"
                className="h-8 rounded-lg border border-line bg-surface pr-8 pl-2 text-[11px] font-bold outline-none focus:border-brand"
              />
            </div>
          </div>
        </div>

        {/* References Grid */}
        {loading ? (
          <p className="py-8 text-center text-[12px] font-bold text-muted">جارٍ تحميل المراجع…</p>
        ) : filtered.length === 0 ? (
          <div className="rounded-lg border border-dashed border-line p-8 text-center">
            <p className="text-[12px] font-bold text-muted">لا توجد مراجع مطابقة لخيارات التصفية.</p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((item) => (
              <article
                key={item.id}
                className="flex flex-col justify-between rounded-xl border border-line bg-surface p-4 transition hover:border-line-2 hover:shadow-sm"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-extrabold",
                        item.approved
                          ? "bg-success/10 text-success"
                          : "bg-warning/10 text-warning",
                      )}
                    >
                      {item.approved ? (
                        <>
                          <CheckCircle2 className="size-3" />
                          معتمد للتوليد
                        </>
                      ) : (
                        <>
                          <AlertCircle className="size-3" />
                          قيد المراجعة
                        </>
                      )}
                    </span>

                    {/* Palette swatches */}
                    <div className="flex items-center gap-1">
                      <span
                        className="size-3 rounded-full border border-black/10"
                        style={{ backgroundColor: item.palette.field }}
                        title={`حقل: ${item.palette.field}`}
                      />
                      <span
                        className="size-3 rounded-full border border-black/10"
                        style={{ backgroundColor: item.palette.accent }}
                        title={`تمييز: ${item.palette.accent}`}
                      />
                      <span
                        className="size-3 rounded-full border border-black/10"
                        style={{ backgroundColor: item.palette.paper }}
                        title={`ورق: ${item.palette.paper}`}
                      />
                    </div>
                  </div>

                  {/* Curated Title (Clean! Never raw filename) */}
                  <h4 className="mt-2 text-[13px] font-black line-clamp-1">{item.title}</h4>
                  <p className="mt-1 line-clamp-2 text-[11px] leading-5 text-muted">
                    {item.description}
                  </p>

                  <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[10px] text-muted">
                    <span className="rounded bg-surface-2 px-1.5 py-0.5 font-bold">
                      {item.format === "wide-slide" ? "16:9 شريحة" : "A4 قياسي"}
                    </span>
                    <span className="rounded bg-surface-2 px-1.5 py-0.5 font-bold">
                      {item.pages} {item.pages === 1 ? "صفحة" : "صفحات"}
                    </span>
                    <span className="rounded bg-surface-2 px-1.5 py-0.5 font-bold">
                      {item.dimensions.w}×{item.dimensions.h}مم
                    </span>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-1.5 border-t border-line/60 pt-3">
                  <button
                    type="button"
                    onClick={() => setPreviewRef(item)}
                    className="inline-flex h-7 items-center gap-1 rounded border border-line px-2 text-[10px] font-bold hover:border-brand"
                  >
                    <Eye className="size-3" />
                    معاينة الخصائص
                  </button>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleToggleApproved(item)}
                      className={cn(
                        "inline-flex h-7 items-center rounded px-2 text-[10px] font-bold transition",
                        item.approved
                          ? "bg-warning/10 text-warning hover:bg-warning/20"
                          : "bg-success/10 text-success hover:bg-success/20",
                      )}
                    >
                      {item.approved ? "إلغاء الاعتماد" : "اعتماد"}
                    </button>

                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleDelete(item.id)}
                      className="inline-flex size-7 items-center justify-center rounded border border-line text-error hover:border-error"
                      title="حذف المرجع"
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {/* ----------------- Modal: Add New Reference ----------------- */}
      {showAddModal && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4"
          onClick={() => setShowAddModal(false)}
        >
          <div
            className="w-full max-w-lg rounded-2xl border border-line bg-surface p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-line pb-3">
              <h3 className="text-[15px] font-black">إضافة مرجع تصميم بصري جديد</h3>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="grid size-7 place-items-center rounded-lg border border-line text-muted hover:text-ink"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="mt-4 grid gap-3">
              <label className="grid gap-1 text-[11px] font-bold text-muted">
                عنوان المرجع المعياري
                <input
                  type="text"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="مثال: الإطار المرجعي لتقارير الاستدامة والحوكمة"
                  className="h-9 rounded-lg border border-line px-3 text-[12px] font-bold outline-none focus:border-brand"
                />
              </label>

              <div className="grid grid-cols-2 gap-2">
                <label className="grid gap-1 text-[11px] font-bold text-muted">
                  التصنيف
                  <select
                    value={newCategory}
                    onChange={(e) => setNewCategory(e.target.value)}
                    className="h-9 rounded-lg border border-line bg-surface px-2 text-[12px] font-bold"
                  >
                    {REFERENCE_CATEGORIES.filter((c) => c.id !== "all").map((cat) => (
                      <option key={cat.id} value={cat.id}>
                        {cat.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="grid gap-1 text-[11px] font-bold text-muted">
                  نمط التصميم
                  <select
                    value={newStyle}
                    onChange={(e) => setNewStyle(e.target.value as DesignStyle)}
                    className="h-9 rounded-lg border border-line bg-surface px-2 text-[12px] font-bold"
                  >
                    {DESIGN_STYLES.map((st) => (
                      <option key={st} value={st}>
                        {st}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <label className="grid gap-1 text-[11px] font-bold text-muted">
                  التنسيق
                  <select
                    value={newFormat}
                    onChange={(e) => setNewFormat(e.target.value as DesignFormat)}
                    className="h-9 rounded-lg border border-line bg-surface px-2 text-[12px] font-bold"
                  >
                    <option value="a4-book">A4 عمودي (210×297 مم)</option>
                    <option value="wide-slide">16:9 شريحة عرض (338×190 مم)</option>
                    <option value="tall-story">إنفوجرافيك طولي (210×560 مم)</option>
                  </select>
                </label>

                <label className="grid gap-1 text-[11px] font-bold text-muted">
                  عدد الصفحات
                  <input
                    type="number"
                    min={1}
                    max={12}
                    value={newPages}
                    onChange={(e) => setNewPages(Number(e.target.value))}
                    className="h-9 rounded-lg border border-line px-2 text-[12px] font-bold"
                  />
                </label>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <label className="grid gap-1 text-[11px] font-bold text-muted">
                  اللون الأساسي (Field)
                  <input
                    type="color"
                    value={newFieldColor}
                    onChange={(e) => setNewFieldColor(e.target.value)}
                    className="h-9 w-full rounded border border-line cursor-pointer"
                  />
                </label>

                <label className="grid gap-1 text-[11px] font-bold text-muted">
                  لون التمييز (Accent)
                  <input
                    type="color"
                    value={newAccentColor}
                    onChange={(e) => setNewAccentColor(e.target.value)}
                    className="h-9 w-full rounded border border-line cursor-pointer"
                  />
                </label>
              </div>

              <label className="grid gap-1 text-[11px] font-bold text-muted">
                الوصف والملاحظات المعيارية
                <textarea
                  rows={3}
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  placeholder="وصف الخصائص البصرية والهدف من هذا المرجع…"
                  className="rounded-lg border border-line p-2 text-[12px] font-normal outline-none focus:border-brand"
                />
              </label>
            </div>

            <div className="mt-5 flex justify-end gap-2 border-t border-line pt-3">
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className={btnGhost}
              >
                إلغاء
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleCreateReference()}
                className={btnPrimary}
              >
                حفظ المرجع
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ----------------- Modal: Preview Reference Details ----------------- */}
      {previewRef && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4"
          onClick={() => setPreviewRef(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-line bg-surface p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-line pb-3">
              <h3 className="text-[15px] font-black">{previewRef.title}</h3>
              <button
                type="button"
                onClick={() => setPreviewRef(null)}
                className="grid size-7 place-items-center rounded-lg border border-line text-muted hover:text-ink"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="mt-4 grid gap-3 text-[12px]">
              <div>
                <span className="font-bold text-muted">الوصف المعياري:</span>
                <p className="mt-1 leading-6">{previewRef.description}</p>
              </div>

              <div className="grid grid-cols-2 gap-2 border-t border-line pt-2">
                <div>
                  <span className="font-bold text-muted">التصنيف:</span>
                  <p className="font-semibold">{previewRef.category}</p>
                </div>
                <div>
                  <span className="font-bold text-muted">النمط:</span>
                  <p className="font-semibold">{previewRef.style}</p>
                </div>
                <div>
                  <span className="font-bold text-muted">الأبعاد:</span>
                  <p className="font-semibold">
                    {previewRef.dimensions.w}×{previewRef.dimensions.h}مم ({previewRef.pages} صفحات)
                  </p>
                </div>
                <div>
                  <span className="font-bold text-muted">الحالة:</span>
                  <p className="font-semibold text-success">
                    {previewRef.approved ? "معتمد رسمياً للتوليد" : "قيد المراجعة"}
                  </p>
                </div>
              </div>

              <div className="border-t border-line pt-2">
                <span className="font-bold text-muted">الألوان المعيارية:</span>
                <div className="mt-2 flex items-center gap-3">
                  <div className="flex items-center gap-1.5">
                    <span
                      className="size-4 rounded-full border border-black/10"
                      style={{ backgroundColor: previewRef.palette.field }}
                    />
                    <span className="text-[11px] font-mono">{previewRef.palette.field}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span
                      className="size-4 rounded-full border border-black/10"
                      style={{ backgroundColor: previewRef.palette.accent }}
                    />
                    <span className="text-[11px] font-mono">{previewRef.palette.accent}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span
                      className="size-4 rounded-full border border-black/10"
                      style={{ backgroundColor: previewRef.palette.paper }}
                    />
                    <span className="text-[11px] font-mono">{previewRef.palette.paper}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-5 flex justify-end border-t border-line pt-3">
              <button
                type="button"
                onClick={() => setPreviewRef(null)}
                className={btnPrimary}
              >
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
