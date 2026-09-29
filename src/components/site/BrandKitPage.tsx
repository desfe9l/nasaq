import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, FilePenLine, FolderKanban, LayoutTemplate, LockKeyhole, Palette, Plus, RotateCcw, Save, ShieldCheck, Sparkles, Type, Download, Upload, Pencil, Trash2 } from "lucide-react";
import { BrandLogo, SiteFooter, SiteHeader } from "@/components/site/SiteChrome";
import { DEFAULT_BRAND_KIT, type BrandKit } from "@/lib/product/product";
import {
  contrastRatio,
  readableOn,
  createBrandProfile,
  deleteBrandProfile,
  exportBrandProfiles,
  importBrandProfiles,
  listBrandProfiles,
  readBrandKit,
  renameBrandProfile,
  saveBrandKit,
  switchBrandProfile,
} from "@/lib/product/brand-kit";
import { BRAND } from "@/lib/brand";
import { cn } from "@/lib/utils";
import { TemplatePreview } from "./TemplatePreview";
import { buildIdentityDocument } from "@/lib/editor/identity-document";
import { useEditor } from "@/lib/editor/store";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { toast } from "sonner";
import { useSiteSettings } from "@/lib/admin/use-site-settings";

/** Saved swatches (localStorage) — colours the author wants to keep at hand. */
const SAVED_COLORS_KEY = "nasaq.brand.saved-colors.v1";
function readSavedColors(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = JSON.parse(localStorage.getItem(SAVED_COLORS_KEY) || "[]");
    return Array.isArray(raw) ? raw.filter((c): c is string => typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c)).slice(0, 24) : [];
  } catch {
    return [];
  }
}
function writeSavedColors(colors: string[]) {
  try {
    localStorage.setItem(SAVED_COLORS_KEY, JSON.stringify(colors));
  } catch {
    /* storage unavailable */
  }
}

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
  const { user, isPending } = useCurrentUserState();
  const [identityReady, setIdentityReady] = useState(false);
  const [kit, setKit] = useState<BrandKit>(DEFAULT_BRAND_KIT);
  const [saved, setSaved] = useState(false);
  const [profiles, setProfiles] = useState<Array<{ id: string; name: string }>>([]);
  const [activeId, setActiveId] = useState("");
  const [profileNameDraft, setProfileNameDraft] = useState("");
  const [renamingProfile, setRenamingProfile] = useState(false);
  const [recipient, setRecipient] = useState("اسم المستلم");
  const [headerHeight, setHeaderHeight] = useState(64);
  const [creating, setCreating] = useState(false);
  const [previewMode, setPreviewMode] = useState<PreviewMode>("cover");
  const logoInput = useRef<HTMLInputElement>(null);
  const darkLogoInput = useRef<HTMLInputElement>(null);
  const stampInput = useRef<HTMLInputElement>(null);
  const importInput = useRef<HTMLInputElement>(null);

  const refreshProfiles = async () => {
    const { profiles: list, activeId: active } = await listBrandProfiles();
    setProfiles(list);
    setActiveId(active);
  };

  useEffect(() => {
    let cancelled = false;
    setKit(DEFAULT_BRAND_KIT); setIdentityReady(false);
    if (!isPending) void (async () => {
      await useEditor.getState().hydrate();
      const nextKit = await readBrandKit();
      const nextProfiles = await listBrandProfiles();
      if (cancelled) return;
      setKit(nextKit); setProfiles(nextProfiles.profiles); setActiveId(nextProfiles.activeId); setIdentityReady(true);
    })().catch(() => { if (!cancelled) toast.error("تعذر تحميل الهوية من تخزين المتصفح"); });
    const header = document.querySelector("header");
    const observer = new ResizeObserver(() => setHeaderHeight(header?.getBoundingClientRect().height ?? 64));
    if (header) observer.observe(header);
    return () => { cancelled = true; observer.disconnect(); };
  }, [user?.id, isPending]);

  const update = <K extends keyof BrandKit>(key: K, value: BrandKit[K]) =>
    setKit((current) => ({ ...current, [key]: value }));

  /**
   * Readability audit of the ACTIVE identity — the three pairings that decide
   * whether a generated document is legible: body text on paper, the header
   * band's text on the primary colour, and the accent on paper (rules, marks).
   */
  const audit = [
    {
      id: "body",
      label: "نص المستند على الورق",
      ratio: contrastRatio(kit.textColor || DEFAULT_BRAND_KIT.textColor!, kit.paperColor || DEFAULT_BRAND_KIT.paperColor!),
      fix: () =>
        update("textColor", readableOn(kit.textColor || "#1f2937", kit.paperColor || "#fbfaf6")),
    },
    {
      id: "header",
      label: "نص الترويسة على اللون الأساسي",
      ratio: contrastRatio("#ffffff", kit.primaryColor),
      fix: () => update("primaryColor", readableOn(kit.primaryColor, "#ffffff")),
    },
    {
      id: "accent",
      label: "اللون المميز على الورق",
      ratio: contrastRatio(kit.accentColor, kit.paperColor || "#fbfaf6"),
      fix: () => update("accentColor", readableOn(kit.accentColor, kit.paperColor || "#fbfaf6")),
    },
  ];

  /** Restore the active profile to the shipped defaults (one undo-free action). */
  const restoreDefaults = () => {
    setKit({ ...DEFAULT_BRAND_KIT, organizationName: kit.organizationName });
    toast.success("أُعيدت الهوية إلى الإعدادات الافتراضية — اضغط حفظ لتثبيتها");
  };

  const save = async () => {
    await saveBrandKit(kit);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1800);
  };

  /** Shared image apply: used by the file pickers AND the drag-&-drop zones. */
  const applyImage = async (
    key: "logoSrc" | "secondaryLogoSrc" | "stampSrc",
    file: File | undefined | null,
  ) => {
    if (!file) return;
    const url = await readFileDataUrl(file);
    if (!url) {
      toast.error("تعذر قراءة الصورة — اختر ملفًا بصيغة صورة");
      return;
    }
    update(key, url);
    toast.success("تم رفع الصورة في الهوية");
  };

  const onLogoFile =
    (key: "logoSrc" | "secondaryLogoSrc" | "stampSrc") =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      void applyImage(key, file);
    };

  const { brandPresets } = useSiteSettings();
  /** Built-in presets plus the defaults published from /admin. */
  const allPresets = [...PALETTE_PRESETS, ...brandPresets.map(({ id: _id, ...p }) => p)];
  const [savedColors, setSavedColors] = useState<string[]>([]);
  useEffect(() => setSavedColors(readSavedColors()), []);
  const saveColor = (color: string) => {
    const c = color.toLowerCase();
    if (!/^#[0-9a-f]{6}$/.test(c)) return;
    const next = [c, ...savedColors.filter((x) => x !== c)].slice(0, 24);
    setSavedColors(next);
    writeSavedColors(next);
  };
  const removeColor = (color: string) => {
    const next = savedColors.filter((x) => x !== color);
    setSavedColors(next);
    writeSavedColors(next);
  };

  const applyPreset = (preset: (typeof PALETTE_PRESETS)[number]) => {
    const { name: _name, ...colors } = preset;
    void _name;
    setKit((current) => ({ ...current, ...colors }));
    toast.success(`طُبّق لوحة «${preset.name}»`);
  };

  const createProfile = async () => {
    const name = window.prompt("اسم الهوية الجديدة؟", `هوية ${profiles.length + 1}`);
    if (name === null) return;
    const id = await createBrandProfile(name);
    setActiveId(id);
    setKit(await readBrandKit());
    await refreshProfiles();
    toast.success("أُنشئت هوية جديدة");
  };

  const switchTo = async (id: string) => {
    await saveBrandKit(kit); // keep unsaved edits of the outgoing profile
    setKit(await switchBrandProfile(id));
    setActiveId(id);
  };

  const commitRenameProfile = async () => {
    if (activeId && profileNameDraft.trim()) {
      await renameBrandProfile(activeId, profileNameDraft);
      await refreshProfiles();
      toast.success("تم تحديث اسم الهوية");
    }
    setRenamingProfile(false);
  };

  const removeProfile = async () => {
    if (profiles.length <= 1) {
      toast.error("يجب الإبقاء على هوية واحدة على الأقل");
      return;
    }
    const current = profiles.find((p) => p.id === activeId);
    if (!window.confirm(`حذف هوية «${current?.name}» نهائيًا؟`)) return;
    if (await deleteBrandProfile(activeId)) {
      const next = await listBrandProfiles();
      setActiveId(next.activeId);
      setKit(await readBrandKit());
      await refreshProfiles();
      toast.success("حُذفت الهوية");
    }
  };

  const doExport = async () => {
    await saveBrandKit(kit);
    const name = await exportBrandProfiles();
    toast.success(`تم تنزيل الهوية — ${name}`);
  };

  const doImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const added = await importBrandProfiles(JSON.parse(await file.text()));
      await refreshProfiles();
      toast.success(added ? `أُضيف ${added} هوية من الملف` : "لا هويات جديدة في الملف");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "تعذر قراءة ملف الهوية");
    }
  };

  const runIdentityAction = (action: () => Promise<unknown>) => { void action().catch(error => toast.error(error instanceof Error ? error.message : "تعذر حفظ الهوية")); };

  const kitDate = formatKitDate(kit);
  const identityDocument = useMemo(() => buildIdentityDocument(kit, previewMode, kitDate, recipient), [kit, previewMode, kitDate, recipient]);
  const createDocument = async () => {
    setCreating(true);
    try {
      await useEditor.getState().hydrate();
      if (await useEditor.getState().createDocument(identityDocument)) window.location.assign("/editor");
    } catch { toast.error("تعذر إنشاء المستند — تحقق من مساحة تخزين المتصفح"); }
    finally { setCreating(false); }
  };

  return (
    <div className="min-h-full bg-paper">
      <SiteHeader current="/الهوية" />
      <main className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6 md:py-16">
        <section className="border-b border-line pb-10"><div className="flex items-center gap-4"><span className="scale-125 origin-right"><BrandLogo /></span><div><p className="text-[11px] font-bold tracking-[0.18em] text-ink">هوية المنتج</p><p className="mt-3 max-w-2xl text-[14px] leading-7 text-muted">منصة عربية تساعدك على إنشاء التقارير والمستندات والعروض وتنظيمها في مساحة عمل واحدة.</p></div></div></section>

        <section className="grid gap-6 border-b border-line py-12 lg:grid-cols-[1.15fr_.85fr]"><div><h2 className="text-[20px] font-extrabold">صُممت وطُوّرت بعناية مؤسسية</h2><p className="mt-3 text-[14px] leading-7 text-muted">{BRAND.team} يقف خلف {BRAND.name}. يركز العمل على أدوات عملية وواضحة تساعد الفرق والأفراد على تجهيز مخرجاتهم الرسمية بطريقة منظمة.</p></div><div className="flex items-center gap-4 border-r-2 border-gold pr-4"><img src="/nasaq-mark.svg" alt="" aria-hidden className="size-12" /><div><strong className="block text-[16px] font-extrabold">{BRAND.team}</strong><span className="mt-1 block text-[12px] text-muted">فريق التطوير والتشغيل</span></div></div></section>

        <section className="py-12"><h2 className="text-[20px] font-extrabold">ماذا تقدم {BRAND.name}؟</h2><div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3"><Service icon={FilePenLine} title="تحرير التصاميم والمستندات" body="نصوص وصور وأشكال وجداول وعناصر قابلة للتحريك والتعديل." /><Service icon={LayoutTemplate} title="قوالب وصفحات جاهزة" body="ابدأ بتكوين منظم ثم عدّل المحتوى والهوية بما يناسب عملك." /><Service icon={FolderKanban} title="إدارة المشاريع" body="احفظ مشاريعك محلياً، وافتحها ونظم صفحاتها قبل التصدير." /><Service icon={Type} title="تجربة عربية" body="دعم RTL، النص العربي، المحاذاة، الخطوط، والأرقام في مساحة عمل واحدة." /><Service icon={Palette} title="هوية مرنة" body="اضبط ألوان الجهة وخطوطها ورؤوس الصفحات وتذييلها للمستند." /><Service icon={CheckCircle2} title="معاينة وتصدير" body="راجع التصميم ثم صدّره بالصيغة المتاحة وفق نوع الترخيص." /></div></section>

        <section className="grid gap-5 border-y border-line py-12 lg:grid-cols-2"><div><div className="flex items-center gap-2"><ShieldCheck className="size-5 text-brand-hover" /><h2 className="text-[20px] font-extrabold">لماذا {BRAND.name}؟</h2></div><p className="mt-3 text-[14px] leading-7 text-muted">تجمع المنصة القوالب والمشاريع والصفحات والعناصر وأدوات التحرير في واجهة عربية واحدة، لتصل إلى أدوات العمل بسرعة وتحافظ على تنظيم الملف من البداية إلى التصدير.</p></div><div><div className="flex items-center gap-2"><LockKeyhole className="size-5 text-brand-hover" /><h2 className="text-[20px] font-extrabold">الأمان والخصوصية</h2></div><p className="mt-3 text-[14px] leading-7 text-muted">يحفظ الإصدار الحالي المشاريع داخل متصفحك ولا يرفعها تلقائياً إلى خادم. لا تُضمَّن مفاتيح API أو بيانات اعتماد في الواجهة أو المستودع. أما التراخيص المدفوعة فتحتاج تحققاً خادمياً عند نشر النسخة التجارية، ولا يمكن اعتبار كود الواجهة المتاح للمتصفح محمياً من النسخ.</p></div></section>

        <section className="py-12"><h2 className="text-[20px] font-extrabold">معلومات المنتج</h2><dl className="mt-5 grid gap-3 sm:grid-cols-3"><Fact label="اسم المنتج" value="نَسَق | NASAQ" /><Fact label="المطوّر" value={BRAND.team} /><Fact label="نوع المنتج" value="منصة تصميم وتحرير عربية" /></dl></section>

        <section aria-busy={!identityReady} inert={!identityReady} className="border-t border-line pt-6">
          <div className="max-w-2xl">
            <h2 className="text-[20px] font-extrabold">هوية مستندك</h2>
            <p className="mt-2 text-[14px] leading-7 text-muted">
              ارفع الشعار والختم، اضبط لوحة الألوان الرسمية والبيانات الوصفية، ثم راجع المعاينة
              الحية لغلاف التقرير أو الخطاب الرسمي أو شهادة التقدير — ويُحفظ كل شيء محليًا.
            </p>
          </div>

          <div className="sticky z-10 mt-4 flex flex-wrap items-center gap-2 border-y border-line bg-page py-2" style={{ top: headerHeight }}>
              <div role="tablist" aria-label="نوع المعاينة" className="flex min-w-0 flex-1 basis-full items-center gap-1 overflow-x-auto sm:basis-auto">
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
                        ? "bg-surface text-brand shadow-sm"
                        : "text-muted",
                    )}
                  >
                    {mode.label}
                  </button>
                ))}
              </div>
            <label className="flex items-center gap-2 text-[11px] font-bold">الاتجاه
              <select aria-label="اتجاه المستند" className="h-8 rounded-md border border-line bg-surface px-2" value={kit.pageSize === "a4-landscape" ? "a4-landscape" : "a4-portrait"} onChange={e => update("pageSize", e.target.value as BrandKit["pageSize"])}>
                <option value="a4-portrait">A4 رأسي · 210 × 297</option><option value="a4-landscape">A4 أفقي · 297 × 210</option>
              </select>
            </label>
          </div>
          {previewMode === "certificate" && <div className="mt-3 max-w-sm"><Field label="اسم المستلم"><input value={recipient} onChange={e => setRecipient(e.target.value)} /></Field></div>}

          {/*
           * Document Identity audit — three real pairings, measured, with the
           * smallest fix offered inline. Colours are a design choice; being
           * able to read the document is not.
           */}
          <div className="mt-4 grid gap-2 rounded-xl border border-line bg-surface p-3 sm:grid-cols-3">
            {audit.map((row) => {
              const pass = row.ratio >= 4.5;
              const strong = row.ratio >= 7;
              return (
                <div key={row.id} className="flex flex-col gap-2 rounded-xl border border-line/70 bg-surface-2 p-3">
                  <span className="text-[12px] font-extrabold text-ink">{row.label}</span>
                  <span className="flex items-center gap-2 text-[12px] font-bold">
                    {pass ? (
                      <CheckCircle2 className={cn("size-4", strong ? "text-brand-hover" : "text-gold")} aria-hidden />
                    ) : (
                      <AlertTriangle className="size-4 text-error" aria-hidden />
                    )}
                    <span className={cn(pass ? "text-muted" : "text-error")} dir="ltr">
                      {row.ratio.toFixed(2)}:1
                    </span>
                    <span className="text-[11px] text-muted">
                      {strong ? "AAA" : pass ? "AA" : "أقل من AA"}
                    </span>
                  </span>
                  {!pass && (
                    <button
                      type="button"
                      onClick={() => {
                        row.fix();
                        toast.success("تم تصحيح هذا التباين");
                      }}
                      className="inline-flex h-8 items-center justify-center gap-1.5 self-start rounded-lg border border-line px-3 text-[11px] font-extrabold text-ink transition hover:border-brand/40"
                    >
                      <Sparkles className="size-3.5" aria-hidden />
                      تصحيح تلقائي
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {/* Multi-profile bar: create / switch / rename / export / import. */}
          <div className="mt-6 flex flex-wrap items-center gap-2 rounded-[10px] border border-line bg-surface p-2">
            {renamingProfile ? (
              <>
                <input
                  autoFocus
                  value={profileNameDraft}
                  onChange={(e) => setProfileNameDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") runIdentityAction(commitRenameProfile);
                    if (e.key === "Escape") setRenamingProfile(false);
                  }}
                  aria-label="اسم الهوية"
                  className="h-9 w-44 rounded-[7px] border border-line px-2 text-[12px] font-bold bg-surface-2"
                />
                <button type="button" onClick={() => runIdentityAction(commitRenameProfile)} className="inline-flex h-9 items-center gap-1 rounded-[7px] bg-navy px-3 text-[11px] font-extrabold text-on-brand">
                  <CheckCircle2 className="size-3.5" /> حفظ الاسم
                </button>
              </>
            ) : (
              <select
                value={activeId}
                onChange={(e) => runIdentityAction(() => switchTo(e.target.value))}
                aria-label="الهوية النشطة"
                className="h-9 min-w-[170px] rounded-[7px] border border-line bg-transparent px-2 text-[12px] font-extrabold"
              >
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            )}
            <button type="button" onClick={() => runIdentityAction(createProfile)} className="inline-flex h-9 items-center gap-1.5 rounded-[7px] border border-line px-3 text-[11px] font-bold" title="هوية جديدة">
              <Plus className="size-3.5" /> جديدة
            </button>
            <button type="button" onClick={() => { const cur = profiles.find((p) => p.id === activeId); setProfileNameDraft(cur?.name || ""); setRenamingProfile(true); }} className="inline-flex h-9 items-center gap-1.5 rounded-[7px] border border-line px-3 text-[11px] font-bold" title="إعادة تسمية الهوية">
              <Pencil className="size-3.5" /> تسمية
            </button>
            <button type="button" onClick={() => runIdentityAction(doExport)} className="inline-flex h-9 items-center gap-1.5 rounded-[7px] border border-line px-3 text-[11px] font-bold" title="تصدير كل الهويات كملف .json">
              <Download className="size-3.5" /> تصدير .json
            </button>
            <button type="button" onClick={() => importInput.current?.click()} className="inline-flex h-9 items-center gap-1.5 rounded-[7px] border border-line px-3 text-[11px] font-bold" title="استيراد هويات من ملف .json">
              <Upload className="size-3.5" /> استيراد
            </button>
            <button type="button" onClick={() => runIdentityAction(removeProfile)} className="inline-flex h-9 items-center gap-1.5 rounded-[7px] border border-danger/30 px-3 text-[11px] font-bold text-error" title="حذف الهوية الحالية">
              <Trash2 className="size-3.5" /> حذف
            </button>
            <input ref={importInput} type="file" accept="application/json,.json" className="hidden" onChange={(e) => void doImport(e)} />
            <span className="mr-auto text-[10px] text-muted">تُحفظ محليًا في متصفحك</span>
          </div>

          <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_340px]">
            <section className="grid gap-5 shadow-card rounded-xl border border-line bg-surface p-5">
              {/* 3 logo/stamp drop zones. */}
              <div>
                <p className="text-[11px] font-extrabold text-muted">الصور الرسمية</p>
                <div className="mt-2 grid gap-3 sm:grid-cols-3">
                  <LogoZone label="الشعار الأساسي" hint="اسحب وأفلت صورة هنا أو انقر للاختيار" src={kit.logoSrc} onPick={() => logoInput.current?.click()} onClear={() => update("logoSrc", undefined)} onFile={(f) => void applyImage("logoSrc", f)} />
                  <LogoZone label="شعار للوضع الداكن" hint="اسحب وأفلت صورة بشفافية أو خلفية داكنة" src={kit.secondaryLogoSrc} onPick={() => darkLogoInput.current?.click()} onClear={() => update("secondaryLogoSrc", undefined)} onFile={(f) => void applyImage("secondaryLogoSrc", f)} />
                  <LogoZone label="الختم أو التوقيع" hint="اسحب وأفلت الختم أو التوقيع الممسوح" src={kit.stampSrc} onPick={() => stampInput.current?.click()} onClear={() => update("stampSrc", undefined)} onFile={(f) => void applyImage("stampSrc", f)} />
                </div>
                <input ref={logoInput} type="file" accept="image/*" className="hidden" onChange={(e) => void onLogoFile("logoSrc")(e)} />
                <input ref={darkLogoInput} type="file" accept="image/*" className="hidden" onChange={(e) => void onLogoFile("secondaryLogoSrc")(e)} />
                <input ref={stampInput} type="file" accept="image/*" className="hidden" onChange={(e) => void onLogoFile("stampSrc")(e)} />
              </div>

              {/* Saudi palette presets. */}
              <div>
                <p className="text-[11px] font-extrabold text-muted">لوائح جاهزة سعودية</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {allPresets.map((preset, index) => (
                    <button
                      key={`${preset.name}-${index}`}
                      type="button"
                      onClick={() => applyPreset(preset)}
                      className="inline-flex items-center gap-2 rounded-full border border-line px-3 py-1.5 text-[11px] font-bold transition hover:border-brand"
                    >
                      <span className="flex -space-x-1 rtl:space-x-reverse">
                        {[preset.primaryColor, preset.secondaryColor, preset.accentColor, preset.paperColor, preset.textColor].map((c, i) => (
                          <span key={`${c}-${i}`} className="size-3.5 rounded-full border border-white shadow-sm" style={{ background: c }} />
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

              {/* Saved colours: keep swatches at hand, click to apply as the accent. */}
              <div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[11px] font-extrabold text-muted">الألوان المحفوظة</p>
                  <div className="flex gap-1">
                    {(["primaryColor", "secondaryColor", "accentColor"] as const).map((key) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => saveColor(kit[key])}
                        className="inline-flex items-center gap-1 rounded-full border border-line px-2 py-1 text-[10px] font-bold hover:border-brand"
                        title="حفظ هذا اللون"
                      >
                        <span className="size-3 rounded-full border border-white shadow-sm" style={{ background: kit[key] }} />
                        حفظ
                      </button>
                    ))}
                  </div>
                </div>
                {savedColors.length === 0 ? (
                  <p className="mt-2 text-[11px] text-muted">لا توجد ألوان محفوظة بعد.</p>
                ) : (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {savedColors.map((c) => (
                      <span key={c} className="group relative">
                        <button
                          type="button"
                          onClick={() => update("accentColor", c)}
                          title={`تطبيق ${c} كلون لمسة`}
                          className="block size-7 rounded-full border-2 border-white shadow ring-1 ring-line"
                          style={{ background: c }}
                        />
                        <button
                          type="button"
                          onClick={() => removeColor(c)}
                          aria-label={`إزالة ${c}`}
                          className="absolute -top-1 -left-1 hidden size-4 place-items-center rounded-full bg-surface text-[10px] font-black text-error shadow group-hover:grid"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}
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
              <div className="flex flex-wrap gap-2 border-t border-line pt-4">
                <button type="button" onClick={() => runIdentityAction(save)} className="inline-flex h-10 items-center gap-2 rounded-[8px] bg-navy px-4 text-[12px] font-extrabold text-on-brand"><Save className="size-4" />{saved ? "تم الحفظ" : "حفظ الهوية محليًا"}</button>
                <button type="button" onClick={restoreDefaults} className="inline-flex h-10 items-center gap-2 rounded-[8px] border border-line px-4 text-[12px] font-extrabold text-ink" title="إعادة ألوان وخطوط الهوية إلى الافتراضي"><RotateCcw className="size-4" />استعادة الافتراضي</button>
              </div>
            </section>

            {/* Reactive A4 live preview with mode toggles. */}
            <aside className="shadow-card h-fit rounded-xl border border-line bg-surface p-4">
              <div className="flex items-start gap-2">
                <ShieldCheck className="size-5 shrink-0 text-ink" />
                <div>
                  <h2 className="text-[14px] font-extrabold">معاينة حية A4</h2>
                  <p className="mt-1 text-[12px] leading-5 text-muted">تتحدّث فور تعديل أي لون أو حقل.</p>
                </div>
              </div>

              <div data-brand-a4-preview className="mt-3">
                <TemplatePreview page={identityDocument.pages[0]} className="rounded-md border border-line" />
              </div>
              <button type="button" disabled={creating} onClick={() => void createDocument()} className="mt-3 inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-navy px-3 text-[12px] font-bold text-on-brand disabled:opacity-50">
                <FilePenLine className="size-4" />{creating ? "جارٍ الإنشاء…" : "إنشاء مستند بهذه الهوية"}
              </button>

              <div className="mt-3 flex items-center gap-2">
                {[kit.primaryColor, kit.secondaryColor, kit.accentColor, kit.paperColor || "#fbfaf6", kit.textColor || "#1f2937"].map((c, i) => (
                  <span key={i} className="size-6 rounded-full border border-line shadow-sm" style={{ background: c }} title={c} />
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

function LogoZone({
  label,
  hint,
  src,
  onPick,
  onClear,
  onFile,
}: {
  label: string;
  hint: string;
  src?: string;
  onPick: () => void;
  onClear: () => void;
  onFile: (file: File) => void;
}) {
  const [over, setOver] = useState(false);
  return (
    <div
      className="relative"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setOver(true);
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const file = e.dataTransfer.files?.[0];
        if (file) onFile(file);
      }}
    >
      <button
        type="button"
        onClick={onPick}
        className={cn(
          "grid h-24 w-full place-items-center overflow-hidden rounded-[8px] border-2 border-dashed p-2 transition",
          over
            ? "border-brand bg-navy/10"
            : "border-line bg-line-2/40 hover:border-brand",
        )}
        title={hint}
      >
        {src ? (
          <img src={src} alt={label} className="max-h-16 max-w-full object-contain" />
        ) : (
          <span className="grid place-items-center gap-1 text-center text-[10px] leading-4 text-muted">
            <Plus className="size-4" />
            {label}
            <span className="text-[8.5px] opacity-75">اسحب وأفلت أو انقر</span>
          </span>
        )}
      </button>
      <span className="mt-1 block text-center text-[10px] font-extrabold text-muted">{label}</span>
      {src && (
        <button
          type="button"
          onClick={onClear}
          aria-label={`إزالة ${label}`}
          className="absolute top-1 left-1 grid size-5 place-items-center rounded-full border border-line bg-surface-2 text-error"
        >
          <Trash2 className="size-3" />
        </button>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="grid gap-1 text-[11px] font-extrabold text-muted">{label}{children}</label>; }
function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) { return <Field label={label}><div className="flex h-10 w-full min-w-0 items-center gap-2 overflow-hidden rounded-[8px] border border-line px-2"><input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="size-6 shrink-0 border-0 bg-transparent p-0" /><input value={value} onChange={(e) => onChange(e.target.value)} size={9} className="min-w-0 w-0 flex-1 border-0 bg-transparent text-[12px] uppercase outline-none" dir="ltr" /></div></Field>; }
function Service({ icon: Icon, title, body }: { icon: typeof FilePenLine; title: string; body: string }) { return <div className="border border-line bg-surface p-4"><Icon className="size-5 text-brand-hover" /><h3 className="mt-3 text-[14px] font-extrabold">{title}</h3><p className="mt-1 text-[12px] leading-6 text-muted">{body}</p></div>; }
function Fact({ label, value }: { label: string; value: string }) { return <div className="border border-line bg-surface p-4"><dt className="text-[11px] font-extrabold text-muted">{label}</dt><dd className="mt-2 text-[14px] font-extrabold">{value}</dd></div>; }
