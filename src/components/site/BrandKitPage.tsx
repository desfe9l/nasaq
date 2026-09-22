import { useEffect, useRef, useState } from "react";
import { CheckCircle2, FilePenLine, FolderKanban, LayoutTemplate, LockKeyhole, Palette, Plus, RotateCcw, Save, ShieldCheck, Type, Download, Upload, Pencil, Trash2 } from "lucide-react";
import { BrandLogo, SiteFooter, SiteHeader } from "@/components/site/SiteChrome";
import { DEFAULT_BRAND_KIT, type BrandKit } from "@/lib/product/product";
import {
  createBrandProfile,
  deleteBrandProfile,
  exportBrandProfiles,
  importBrandProfiles,
  listBrandProfiles,
  readBrandKit,
  renameBrandProfile,
  resetBrandKit,
  saveBrandKit,
  switchBrandProfile,
} from "@/lib/product/brand-kit";
import { BRAND } from "@/lib/brand";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

/** Saudi-flavoured palette presets — five colours each (paper + text included). */
const PALETTE_PRESETS: {
  name: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  paperColor: string;
  textColor: string;
}[] = [
  { name: "الهوية الوطنية", primaryColor: "#006c35", secondaryColor: "#0b3d2e", accentColor: "#c9a227", paperColor: "#fdfcf8", textColor: "#1c2b24" },
  { name: "رؤية 2030", primaryColor: "#0072ce", secondaryColor: "#00614b", accentColor: "#b4924b", paperColor: "#f7f9fb", textColor: "#152536" },
  { name: "العنابي التنفيذي", primaryColor: "#6b1f3a", secondaryColor: "#3e1224", accentColor: "#c6a05a", paperColor: "#fbf7f7", textColor: "#2a1520" },
  { name: "الأزرق الملكي", primaryColor: "#143c7b", secondaryColor: "#0c2552", accentColor: "#c6a05a", paperColor: "#f7f8fb", textColor: "#14213a" },
];

type PreviewMode = "cover" | "letter" | "certificate";
const PREVIEW_MODES: { id: PreviewMode; label: string }[] = [
  { id: "cover", label: "غلاف تقرير" },
  { id: "letter", label: "خطاب رسمي" },
  { id: "certificate", label: "شهادة تقدير" },
];

function formatKitDate(kit: BrandKit) {
  const now = new Date();
  try {
    if (kit.dateFormat === "gregorian") {
      return new Intl.DateTimeFormat("ar-SA-u-ca-gregory", { dateStyle: "long" }).format(now);
    }
    return new Intl.DateTimeFormat("ar-SA-u-ca-islamic-umalqura", { dateStyle: "long" }).format(now);
  } catch {
    return now.toLocaleDateString("ar-SA");
  }
}

function readFileDataUrl(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    if (!file.type.startsWith("image/")) {
      resolve(null);
      return;
    }
    const reader = new FileReader();
    reader.onload = () =>
      resolve(typeof reader.result === "string" ? reader.result : null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

export function BrandKitPage() {
  const [kit, setKit] = useState<BrandKit>(DEFAULT_BRAND_KIT);
  const [saved, setSaved] = useState(false);
  const [profiles, setProfiles] = useState<Array<{ id: string; name: string }>>([]);
  const [activeId, setActiveId] = useState("");
  const [profileNameDraft, setProfileNameDraft] = useState("");
  const [renamingProfile, setRenamingProfile] = useState(false);
  const [previewMode, setPreviewMode] = useState<PreviewMode>("cover");
  const logoInput = useRef<HTMLInputElement>(null);
  const darkLogoInput = useRef<HTMLInputElement>(null);
  const stampInput = useRef<HTMLInputElement>(null);
  const importInput = useRef<HTMLInputElement>(null);

  const refreshProfiles = () => {
    const { profiles: list, activeId: active } = listBrandProfiles();
    setProfiles(list);
    setActiveId(active);
  };

  useEffect(() => {
    setKit(readBrandKit());
    refreshProfiles();
  }, []);

  const update = <K extends keyof BrandKit>(key: K, value: BrandKit[K]) =>
    setKit((current) => ({ ...current, [key]: value }));

  const save = () => {
    saveBrandKit(kit);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1800);
  };

  const onLogoFile =
    (key: "logoSrc" | "secondaryLogoSrc" | "stampSrc") =>
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;
      const url = await readFileDataUrl(file);
      if (!url) {
        toast.error("تعذر قراءة الصورة — اختر ملفًا بصيغة صورة");
        return;
      }
      update(key, url);
    };

  const applyPreset = (preset: (typeof PALETTE_PRESETS)[number]) => {
    const { name: _name, ...colors } = preset;
    void _name;
    setKit((current) => ({ ...current, ...colors }));
    toast.success(`طُبّق لوحة «${preset.name}»`);
  };

  const createProfile = () => {
    const name = window.prompt("اسم الهوية الجديدة؟", `هوية ${profiles.length + 1}`);
    if (name === null) return;
    const id = createBrandProfile(name);
    setActiveId(id);
    setKit(readBrandKit());
    refreshProfiles();
    toast.success("أُنشئت هوية جديدة");
  };

  const switchTo = (id: string) => {
    saveBrandKit(kit); // keep unsaved edits of the outgoing profile
    setKit(switchBrandProfile(id));
    setActiveId(id);
  };

  const commitRenameProfile = () => {
    if (activeId && profileNameDraft.trim()) {
      renameBrandProfile(activeId, profileNameDraft);
      refreshProfiles();
      toast.success("تم تحديث اسم الهوية");
    }
    setRenamingProfile(false);
  };

  const removeProfile = () => {
    if (profiles.length <= 1) {
      toast.error("يجب الإبقاء على هوية واحدة على الأقل");
      return;
    }
    const current = profiles.find((p) => p.id === activeId);
    if (!window.confirm(`حذف هوية «${current?.name}» نهائيًا؟`)) return;
    if (deleteBrandProfile(activeId)) {
      const next = listBrandProfiles();
      setActiveId(next.activeId);
      setKit(readBrandKit());
      refreshProfiles();
      toast.success("حُذفت الهوية");
    }
  };

  const doExport = () => {
    saveBrandKit(kit);
    const name = exportBrandProfiles();
    toast.success(`تم تنزيل الهوية — ${name}`);
  };

  const doImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const added = importBrandProfiles(JSON.parse(await file.text()));
      refreshProfiles();
      toast.success(added ? `أُضيف ${added} هوية من الملف` : "لا هويات جديدة في الملف");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "تعذر قراءة ملف الهوية");
    }
  };

  const kitDate = formatKitDate(kit);

  return (
    <div className="min-h-full bg-paper dark:bg-[#111722]">
      <SiteHeader current="/الهوية" />
      <main className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6 md:py-16">
        <section className="border-b border-line pb-10 dark:border-white/10"><div className="flex items-center gap-4"><span className="scale-125 origin-right"><BrandLogo /></span><div><p className="text-[11px] font-bold tracking-[0.18em] text-green">هوية المنتج</p><p className="mt-3 max-w-2xl text-[14px] leading-7 text-muted">منصة عربية تساعدك على إنشاء التقارير والمستندات والعروض وتنظيمها في مساحة عمل واحدة.</p></div></div></section>

        <section className="grid gap-6 border-b border-line py-12 lg:grid-cols-[1.15fr_.85fr] dark:border-white/10"><div><h2 className="text-[20px] font-extrabold">صُممت وطُوّرت بعناية</h2><p className="mt-3 text-[14px] leading-7 text-muted">{BRAND.owner} هو المصمم والمطور خلف {BRAND.name}. يركز العمل على أدوات عملية وواضحة تساعد الفرق والأفراد على تجهيز مخرجاتهم الرسمية بطريقة منظمة.</p></div><div className="flex items-center gap-4 border-r-2 border-gold pr-4"><img src="/nasaq-mark.svg" alt="" aria-hidden className="size-12" /><div><strong className="block text-[16px] font-extrabold">فيصل المضياني</strong><span className="mt-1 block text-[12px] text-muted">المصمم والمطور</span></div></div></section>

        <section className="py-12"><h2 className="text-[20px] font-extrabold">ماذا تقدم {BRAND.name}؟</h2><div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3"><Service icon={FilePenLine} title="تحرير التصاميم والمستندات" body="نصوص وصور وأشكال وجداول وعناصر قابلة للتحريك والتعديل." /><Service icon={LayoutTemplate} title="قوالب وصفحات جاهزة" body="ابدأ بتكوين منظم ثم عدّل المحتوى والهوية بما يناسب عملك." /><Service icon={FolderKanban} title="إدارة المشاريع" body="احفظ مشاريعك محلياً، وافتحها ونظم صفحاتها قبل التصدير." /><Service icon={Type} title="تجربة عربية" body="دعم RTL، النص العربي، المحاذاة، الخطوط، والأرقام في مساحة عمل واحدة." /><Service icon={Palette} title="هوية مرنة" body="اضبط ألوان الجهة وخطوطها ورؤوس الصفحات وتذييلها للمستند." /><Service icon={CheckCircle2} title="معاينة وتصدير" body="راجع التصميم ثم صدّره بالصيغة المتاحة وفق نوع الترخيص." /></div></section>

        <section className="grid gap-5 border-y border-line py-12 lg:grid-cols-2 dark:border-white/10"><div><div className="flex items-center gap-2"><ShieldCheck className="size-5 text-navy-2 dark:text-gold-2" /><h2 className="text-[20px] font-extrabold">لماذا {BRAND.name}؟</h2></div><p className="mt-3 text-[14px] leading-7 text-muted">تجمع المنصة القوالب والمشاريع والصفحات والعناصر وأدوات التحرير في واجهة عربية واحدة، لتصل إلى أدوات العمل بسرعة وتحافظ على تنظيم الملف من البداية إلى التصدير.</p></div><div><div className="flex items-center gap-2"><LockKeyhole className="size-5 text-navy-2 dark:text-gold-2" /><h2 className="text-[20px] font-extrabold">الأمان والخصوصية</h2></div><p className="mt-3 text-[14px] leading-7 text-muted">يحفظ الإصدار الحالي المشاريع داخل متصفحك ولا يرفعها تلقائياً إلى خادم. لا تُضمَّن مفاتيح API أو بيانات اعتماد في الواجهة أو المستودع. أما التراخيص المدفوعة فتحتاج تحققاً خادمياً عند نشر النسخة التجارية، ولا يمكن اعتبار كود الواجهة المتاح للمتصفح محمياً من النسخ.</p></div></section>

        <section className="py-12"><h2 className="text-[20px] font-extrabold">معلومات المنتج</h2><dl className="mt-5 grid gap-3 sm:grid-cols-3"><Fact label="اسم المنتج" value="نَسَق | NASAQ" /><Fact label="المصمم والمطور" value="فيصل المضياني" /><Fact label="نوع المنتج" value="منصة تصميم وتحرير عربية" /></dl></section>

        <section className="border-t border-line pt-10 dark:border-white/10">
          <div className="max-w-2xl">
            <h2 className="text-[20px] font-extrabold">هوية مستندك</h2>
            <p className="mt-2 text-[14px] leading-7 text-muted">
              ارفع الشعار والختم، اضبط لوحة الألوان الرسمية والبيانات الوصفية، ثم راجع المعاينة
              الحية لغلاف التقرير أو الخطاب الرسمي أو شهادة التقدير — ويُحفظ كل شيء محليًا.
            </p>
          </div>

          {/* Multi-profile bar: create / switch / rename / export / import. */}
          <div className="mt-6 flex flex-wrap items-center gap-2 rounded-[10px] border border-line bg-white p-2 dark:border-white/10 dark:bg-white/5">
            {renamingProfile ? (
              <>
                <input
                  autoFocus
                  value={profileNameDraft}
                  onChange={(e) => setProfileNameDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRenameProfile();
                    if (e.key === "Escape") setRenamingProfile(false);
                  }}
                  aria-label="اسم الهوية"
                  className="h-9 w-44 rounded-[7px] border border-line px-2 text-[12px] font-bold dark:border-white/10 dark:bg-white/5"
                />
                <button type="button" onClick={commitRenameProfile} className="inline-flex h-9 items-center gap-1 rounded-[7px] bg-navy px-3 text-[11px] font-extrabold text-white">
                  <CheckCircle2 className="size-3.5" /> حفظ الاسم
                </button>
              </>
            ) : (
              <select
                value={activeId}
                onChange={(e) => switchTo(e.target.value)}
                aria-label="الهوية النشطة"
                className="h-9 min-w-[170px] rounded-[7px] border border-line bg-transparent px-2 text-[12px] font-extrabold dark:border-white/10"
              >
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            )}
            <button type="button" onClick={createProfile} className="inline-flex h-9 items-center gap-1.5 rounded-[7px] border border-line px-3 text-[11px] font-bold dark:border-white/10" title="هوية جديدة">
              <Plus className="size-3.5" /> جديدة
            </button>
            <button type="button" onClick={() => { const cur = profiles.find((p) => p.id === activeId); setProfileNameDraft(cur?.name || ""); setRenamingProfile(true); }} className="inline-flex h-9 items-center gap-1.5 rounded-[7px] border border-line px-3 text-[11px] font-bold dark:border-white/10" title="إعادة تسمية الهوية">
              <Pencil className="size-3.5" /> تسمية
            </button>
            <button type="button" onClick={doExport} className="inline-flex h-9 items-center gap-1.5 rounded-[7px] border border-line px-3 text-[11px] font-bold dark:border-white/10" title="تصدير كل الهويات كملف .json">
              <Download className="size-3.5" /> تصدير .json
            </button>
            <button type="button" onClick={() => importInput.current?.click()} className="inline-flex h-9 items-center gap-1.5 rounded-[7px] border border-line px-3 text-[11px] font-bold dark:border-white/10" title="استيراد هويات من ملف .json">
              <Upload className="size-3.5" /> استيراد
            </button>
            <button type="button" onClick={removeProfile} className="inline-flex h-9 items-center gap-1.5 rounded-[7px] border border-red-200 px-3 text-[11px] font-bold text-red-600 dark:border-red-500/30" title="حذف الهوية الحالية">
              <Trash2 className="size-3.5" /> حذف
            </button>
            <input ref={importInput} type="file" accept="application/json,.json" className="hidden" onChange={(e) => void doImport(e)} />
            <span className="mr-auto text-[10px] text-muted">تُحفظ محليًا في متصفحك</span>
          </div>

          <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_340px]">
            <section className="grid gap-5 shadow-card dark:shadow-card-dark rounded-xl border border-line bg-white p-5 dark:border-white/10 dark:bg-white/5">
              {/* 3 logo/stamp drop zones. */}
              <div>
                <p className="text-[11px] font-extrabold text-muted">الصور الرسمية</p>
                <div className="mt-2 grid gap-3 sm:grid-cols-3">
                  <LogoZone label="الشعار الأساسي" hint="PNG/SVG بخلفية شفافة" src={kit.logoSrc} onPick={() => logoInput.current?.click()} onClear={() => update("logoSrc", undefined)} />
                  <LogoZone label="شعار للوضع الداكن" hint="للالصاق على خلفيات داكنة" src={kit.secondaryLogoSrc} onPick={() => darkLogoInput.current?.click()} onClear={() => update("secondaryLogoSrc", undefined)} />
                  <LogoZone label="الختم أو التوقيع" hint="ختم دائري أو توقيع ممسوح" src={kit.stampSrc} onPick={() => stampInput.current?.click()} onClear={() => update("stampSrc", undefined)} />
                </div>
                <input ref={logoInput} type="file" accept="image/*" className="hidden" onChange={(e) => void onLogoFile("logoSrc")(e)} />
                <input ref={darkLogoInput} type="file" accept="image/*" className="hidden" onChange={(e) => void onLogoFile("secondaryLogoSrc")(e)} />
                <input ref={stampInput} type="file" accept="image/*" className="hidden" onChange={(e) => void onLogoFile("stampSrc")(e)} />
              </div>

              {/* Saudi palette presets. */}
              <div>
                <p className="text-[11px] font-extrabold text-muted">لوائح جاهزة سعودية</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {PALETTE_PRESETS.map((preset) => (
                    <button
                      key={preset.name}
                      type="button"
                      onClick={() => applyPreset(preset)}
                      className="inline-flex items-center gap-2 rounded-full border border-line px-3 py-1.5 text-[11px] font-bold transition hover:border-navy-2 dark:border-white/10"
                    >
                      <span className="flex -space-x-1 rtl:space-x-reverse">
                        {[preset.primaryColor, preset.secondaryColor, preset.accentColor].map((c) => (
                          <span key={c} className="size-3.5 rounded-full border border-white shadow-sm" style={{ background: c }} />
                        ))}
                      </span>
                      {preset.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* 5-colour palette. */}
              <div className="grid gap-3 sm:grid-cols-5">
                <ColorField label="أساسي" value={kit.primaryColor} onChange={(v) => update("primaryColor", v)} />
                <ColorField label="ثانوي" value={kit.secondaryColor} onChange={(v) => update("secondaryColor", v)} />
                <ColorField label="ذهبي / لمسة" value={kit.accentColor} onChange={(v) => update("accentColor", v)} />
                <ColorField label="لون الورق" value={kit.paperColor || DEFAULT_BRAND_KIT.paperColor || "#ffffff"} onChange={(v) => update("paperColor", v)} />
                <ColorField label="لون النص" value={kit.textColor || DEFAULT_BRAND_KIT.textColor || "#1f2937"} onChange={(v) => update("textColor", v)} />
              </div>

              {/* Official metadata. */}
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="اسم الجهة"><input value={kit.organizationName} onChange={(e) => update("organizationName", e.target.value)} placeholder="اسم الجهة أو الإدارة" /></Field>
                <Field label="الإدارة الفرعية"><input value={kit.subDepartment || ""} onChange={(e) => update("subDepartment", e.target.value)} placeholder="مثال: إدارة الاتصال" /></Field>
                <Field label="بيانات تواصل التذييل"><input value={kit.contactLine || ""} onChange={(e) => update("contactLine", e.target.value)} placeholder="هاتف · بريد · عنوان" dir="rtl" /></Field>
                <Field label="تنسيق التاريخ"><select value={kit.dateFormat || "hijri"} onChange={(e) => update("dateFormat", e.target.value as BrandKit["dateFormat"])}><option value="hijri">هجري (أم القرى)</option><option value="gregorian">ميلادي</option></select></Field>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="الخط العربي"><select value={kit.arabicFont} onChange={(e) => update("arabicFont", e.target.value)}><option>Tajawal</option><option>Cairo</option><option>IBM Plex Sans Arabic</option><option>Noto Sans Arabic</option></select></Field>
                <Field label="الخط الإنجليزي"><input value={kit.englishFont} onChange={(e) => update("englishFont", e.target.value)} /></Field>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="أسلوب الترويسة"><select value={kit.headerStyle} onChange={(e) => update("headerStyle", e.target.value as BrandKit["headerStyle"])}><option value="official">رسمي</option><option value="minimal">مختصر</option><option value="band">شريط هوية</option></select></Field>
                <Field label="أسلوب التذييل"><select value={kit.footerStyle} onChange={(e) => update("footerStyle", e.target.value as BrandKit["footerStyle"])}><option value="official">رسمي</option><option value="simple">بسيط</option><option value="none">بدون تذييل</option></select></Field>
              </div>
              <div className="flex flex-wrap gap-2 border-t border-line pt-4 dark:border-white/10">
                <button type="button" onClick={save} className="inline-flex h-10 items-center gap-2 rounded-[8px] bg-navy px-4 text-[12px] font-extrabold text-white"><Save className="size-4" />{saved ? "تم الحفظ" : "حفظ الهوية محليًا"}</button>
                <button type="button" onClick={() => setKit(resetBrandKit())} className="inline-flex h-10 items-center gap-2 rounded-[8px] border border-line px-4 text-[12px] font-bold dark:border-white/10"><RotateCcw className="size-4" />إعادة الضبط</button>
              </div>
            </section>

            {/* Reactive A4 live preview with mode toggles. */}
            <aside className="shadow-card dark:shadow-card-dark h-fit rounded-xl border border-line bg-white p-4 dark:border-white/10 dark:bg-white/5">
              <div className="flex items-start gap-2">
                <ShieldCheck className="size-5 shrink-0 text-green" />
                <div>
                  <h2 className="text-[14px] font-extrabold">معاينة حية A4</h2>
                  <p className="mt-1 text-[12px] leading-5 text-muted">تتحدّث فور تعديل أي لون أو حقل.</p>
                </div>
              </div>
              <div role="tablist" aria-label="نوع المعاينة" className="mt-3 grid grid-cols-3 gap-1 rounded-[8px] bg-line-2 p-1 dark:bg-white/10">
                {PREVIEW_MODES.map((mode) => (
                  <button
                    key={mode.id}
                    type="button"
                    role="tab"
                    aria-selected={previewMode === mode.id}
                    onClick={() => setPreviewMode(mode.id)}
                    className={cn(
                      "rounded-[6px] px-1 py-1.5 text-[10px] font-extrabold transition",
                      previewMode === mode.id
                        ? "bg-white text-navy shadow-sm dark:bg-[#1b2431] dark:text-gold-2"
                        : "text-muted",
                    )}
                  >
                    {mode.label}
                  </button>
                ))}
              </div>

              <div
                className="mt-3 overflow-hidden rounded-[6px] border border-line shadow-sm dark:border-white/10"
                style={{ background: kit.paperColor || "#fbfaf6", aspectRatio: "1 / 1.414" }}
                dir="rtl"
              >
                {previewMode === "cover" && (
                  <div className="flex h-full flex-col" style={{ fontFamily: kit.arabicFont, color: kit.textColor || "#1f2937" }}>
                    <div className="flex items-center justify-between gap-2 px-4 py-3" style={{ background: kit.primaryColor }}>
                      <div className="min-w-0">
                        <p className="truncate text-[11px] font-extrabold text-white">{kit.organizationName || "اسم الجهة"}</p>
                        {kit.subDepartment && <p className="truncate text-[8px] text-white/80">{kit.subDepartment}</p>}
                      </div>
                      {kit.logoSrc && <img src={kit.logoSrc} alt="" className="max-h-8 max-w-[64px] object-contain" />}
                    </div>
                    <span className="h-1" style={{ background: kit.accentColor }} />
                    <div className="flex flex-1 flex-col items-center justify-center px-5 text-center">
                      <p className="text-[9px] tracking-widest" style={{ color: kit.secondaryColor }}>تقرير رسمي</p>
                      <h3 className="mt-2 text-[17px] font-extrabold leading-tight">عنوان التقرير</h3>
                      <span className="mt-3 block h-0.5 w-20" style={{ background: kit.accentColor }} />
                      <p className="mt-4 text-[9px] tabular-nums" style={{ color: kit.textColor || "#1f2937", opacity: 0.75 }}>{kitDate}</p>
                      {kit.logoSrc && <img src={kit.logoSrc} alt="" className="mt-5 max-h-10 object-contain" />}
                    </div>
                    <div className="px-4 pb-3 text-center">
                      <p className="text-[7.5px] text-muted">{kit.contactLine || "بيانات التواصل تظهر هنا"}</p>
                      {kit.footerStyle !== "none" && <span className="mt-2 block h-1 w-full rounded" style={{ background: kit.primaryColor, opacity: 0.85 }} />}
                    </div>
                  </div>
                )}

                {previewMode === "letter" && (
                  <div className="flex h-full flex-col px-4 py-4" style={{ fontFamily: kit.arabicFont, color: kit.textColor || "#1f2937" }}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-left text-[8px] leading-4" style={{ color: kit.secondaryColor }}>
                        <p className="tabular-nums">{kitDate}</p>
                        <p className="tabular-nums opacity-70">الرقم: 1447هـ/أ</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {kit.logoSrc && <img src={kit.logoSrc} alt="" className="max-h-9 object-contain" />}
                        <div className="text-right">
                          <p className="text-[10px] font-extrabold">{kit.organizationName || "اسم الجهة"}</p>
                          {kit.subDepartment && <p className="text-[7.5px] opacity-70">{kit.subDepartment}</p>}
                        </div>
                      </div>
                    </div>
                    <span className="mt-2 block h-[2px] w-full" style={{ background: kit.accentColor }} />
                    <p className="mt-3 text-[9px] font-extrabold">خطاب رسمي</p>
                    <div className="mt-2 space-y-1.5 opacity-70">
                      {[100, 96, 99, 92, 97, 60].map((w, i) => (
                        <span key={i} className="block h-[5px] rounded-sm" style={{ width: `${w}%`, background: kit.textColor || "#1f2937", opacity: 0.16 }} />
                      ))}
                    </div>
                    <div className="mt-auto flex items-end justify-between gap-2">
                      <div className="grid gap-1 text-center">
                        <span className="block h-[2px] w-20" style={{ background: kit.textColor || "#1f2937", opacity: 0.4 }} />
                        <span className="text-[7px] opacity-60">التوقيع</span>
                      </div>
                      {kit.stampSrc ? (
                        <img src={kit.stampSrc} alt="" className="size-14 object-contain opacity-90" />
                      ) : (
                        <span className="grid size-14 place-items-center rounded-full border-2 border-dashed text-[7px]" style={{ borderColor: kit.secondaryColor, color: kit.secondaryColor }}>
                          ختم الجهة
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {previewMode === "certificate" && (
                  <div className="flex h-full flex-col items-center justify-center p-3" style={{ fontFamily: kit.arabicFont, color: kit.textColor || "#1f2937" }}>
                    <div className="flex h-full w-full flex-col items-center justify-center border-2 px-3 py-4 text-center" style={{ borderColor: kit.primaryColor }}>
                      <div className="flex h-full w-full flex-col items-center justify-center border px-3 py-4" style={{ borderColor: kit.accentColor }}>
                        {kit.logoSrc && <img src={kit.logoSrc} alt="" className="max-h-10 object-contain" />}
                        <p className="mt-2 text-[8px] tracking-widest" style={{ color: kit.secondaryColor }}>{kit.organizationName || "اسم الجهة"}</p>
                        <h3 className="mt-2 text-[16px] font-extrabold">شهادة تقدير</h3>
                        <span className="mt-2 block h-0.5 w-16" style={{ background: kit.accentColor }} />
                        <p className="mt-3 text-[9px] opacity-70">تُمنح هذه الشهادة إلى</p>
                        <p className="mt-1 border-b border-dashed pb-0.5 text-[11px] font-extrabold" style={{ borderColor: kit.secondaryColor }}>اسم المستلم</p>
                        <p className="mt-2 text-[8px] leading-4 opacity-75">تقديرًا لجهوده المتميّزة ومساهمته المعنوية</p>
                        <div className="mt-auto flex w-full items-end justify-between gap-2 pt-3">
                          <div className="grid gap-1 text-center">
                            <span className="block h-[2px] w-16" style={{ background: kit.textColor || "#1f2937", opacity: 0.4 }} />
                            <span className="text-[6.5px] opacity-60">التوقيع</span>
                          </div>
                          <p className="text-[7px] tabular-nums opacity-70">{kitDate}</p>
                          {kit.stampSrc ? (
                            <img src={kit.stampSrc} alt="" className="size-11 object-contain" />
                          ) : (
                            <span className="grid size-11 place-items-center rounded-full border-2 border-dashed text-[6px]" style={{ borderColor: kit.secondaryColor, color: kit.secondaryColor }}>الختم</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="mt-3 flex items-center gap-2">
                {[kit.primaryColor, kit.secondaryColor, kit.accentColor, kit.paperColor || "#fbfaf6", kit.textColor || "#1f2937"].map((c, i) => (
                  <span key={i} className="size-6 rounded-full border border-line shadow-sm dark:border-white/10" style={{ background: c }} title={c} />
                ))}
                <span className="mr-auto text-[10px] text-muted">{PREVIEW_MODES.find((m) => m.id === previewMode)?.label}</span>
              </div>
            </aside>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}

function LogoZone({ label, hint, src, onPick, onClear }: { label: string; hint: string; src?: string; onPick: () => void; onClear: () => void }) {
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onPick}
        className="grid h-24 w-full place-items-center overflow-hidden rounded-[8px] border-2 border-dashed border-line bg-line-2/40 p-2 transition hover:border-navy-2 dark:border-white/15 dark:bg-white/5"
        title={hint}
      >
        {src ? (
          <img src={src} alt={label} className="max-h-16 max-w-full object-contain" />
        ) : (
          <span className="grid place-items-center gap-1 text-center text-[10px] leading-4 text-muted">
            <Plus className="size-4" />
            {label}
          </span>
        )}
      </button>
      <span className="mt-1 block text-center text-[10px] font-extrabold text-muted">{label}</span>
      {src && (
        <button
          type="button"
          onClick={onClear}
          aria-label={`إزالة ${label}`}
          className="absolute top-1 left-1 grid size-5 place-items-center rounded-full border border-line bg-white/90 text-red-600 dark:border-white/20 dark:bg-[#161c26]/90"
        >
          <Trash2 className="size-3" />
        </button>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="grid gap-1 text-[11px] font-extrabold text-muted">{label}{children}</label>; }
function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) { return <Field label={label}><div className="flex h-10 items-center gap-2 rounded-[8px] border border-line px-2 dark:border-white/10"><input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="size-6 border-0 bg-transparent p-0" /><input value={value} onChange={(e) => onChange(e.target.value)} className="min-w-0 flex-1 border-0 bg-transparent text-[12px] uppercase outline-none" dir="ltr" /></div></Field>; }
function Service({ icon: Icon, title, body }: { icon: typeof FilePenLine; title: string; body: string }) { return <div className="border border-line bg-white p-4 dark:border-white/10 dark:bg-white/5"><Icon className="size-5 text-navy-2 dark:text-gold-2" /><h3 className="mt-3 text-[14px] font-extrabold">{title}</h3><p className="mt-1 text-[12px] leading-6 text-muted">{body}</p></div>; }
function Fact({ label, value }: { label: string; value: string }) { return <div className="border border-line bg-white p-4 dark:border-white/10 dark:bg-white/5"><dt className="text-[11px] font-extrabold text-muted">{label}</dt><dd className="mt-2 text-[14px] font-extrabold">{value}</dd></div>; }
