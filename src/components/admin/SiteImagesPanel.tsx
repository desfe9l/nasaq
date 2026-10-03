/**
 * «صور الموقع» — the owner's image manager for the marketing surfaces.
 *
 * Why this exists: the home page's walkthrough used to paint four hard-coded
 * files out of `public/editor-previews/`. Changing one meant a Git commit and a
 * redeploy, and the owner — the person whose product it is — could not do it
 * from the product.
 *
 * The image set is therefore settings data like any other:
 *
 *   · persisted server-side in `site_settings` under the `images` key, through
 *     the SAME owner-gated `adminSaveSettingsFn` every other section uses — no
 *     parallel storage, no new permission model;
 *   · validated server-side by `normalizeSection("images", …)`, which accepts
 *     only `https:` URLs and raster `data:image/…;base64,` payloads, so an
 *     uploaded SVG (a document, not a picture) can never reach an `<img>`;
 *   · dimension-free — an upload is re-encoded to a longest edge of
 *     `SITE_IMAGE_MAX_EDGE` and every surface then renders it with
 *     `object-contain`, so a 4:3 capture, a 16:9 capture and a portrait phone
 *     screenshot all fit the same card without the owner cropping anything;
 *   · optional — an empty slot falls back to the bundled artwork, which is why
 *     the owner can replace a single card instead of the whole set.
 */

import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Eye,
  EyeOff,
  ImageUp,
  Loader2,
  Plus,
  Save,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { adminSaveSettingsFn, getSiteSettingsFn } from "@/lib/admin/functions";
import { invalidateSiteSettings } from "@/lib/admin/use-site-settings";
import {
  DEFAULT_SITE_IMAGES,
  MAX_SITE_IMAGE_BYTES,
  SITE_IMAGE_MAX_EDGE,
  SITE_IMAGE_SLOTS,
  type SiteImages,
} from "@/lib/admin/types";
import { cn } from "@/lib/utils";

const primaryBtn =
  "inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-navy px-4 text-[13px] font-extrabold text-on-brand transition hover:bg-ok disabled:opacity-50";
const ghostBtn =
  "inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-line px-3 text-[12px] font-bold transition hover:border-brand disabled:opacity-50";

/**
 * Re-encode a picked file to a bounded, dimension-independent data URL.
 *
 * Two jobs only: cap the longest edge (a 6000px phone photo is 12 MB of JSON
 * in a settings row for no visible gain) and normalise the container (a
 * `.heic` or `.tiff` browser-side decode failure must not become a broken
 * image in production). The aspect ratio is preserved exactly — the whole
 * point is that the owner supplies whatever shape they have.
 */
async function encodeImage(file: File): Promise<string> {
  const raw = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("تعذّر قراءة الملف"));
    reader.readAsDataURL(file);
  });
  // Nothing to re-encode without a decoder (SSR, a locked-down browser): the
  // original payload is already the right format, so hand it straight back.
  if (typeof document === "undefined") return raw;
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("تعذّر قراءة الصورة"));
    el.src = raw;
  });
  const w = img.naturalWidth || 0;
  const h = img.naturalHeight || 0;
  if (!w || !h) throw new Error("تعذّر تحديد مقاس الصورة");
  const scale = Math.min(1, SITE_IMAGE_MAX_EDGE / Math.max(w, h));
  if (scale === 1 && raw.length <= MAX_SITE_IMAGE_BYTES) return raw;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return raw;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.86);
}

export function SiteImagesPanel() {
  const [images, setImages] = useState<SiteImages>(DEFAULT_SITE_IMAGES);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busySlot, setBusySlot] = useState<string | null>(null);
  const inputs = useRef<Partial<Record<keyof SiteImages, HTMLInputElement | null>>>({});
  const galleryInputs = useRef<Record<string, HTMLInputElement | null>>({});
  const [galleryUrl, setGalleryUrl] = useState("");

  useEffect(() => {
    void getSiteSettingsFn()
      .then((s) => setImages(s.images ?? DEFAULT_SITE_IMAGES))
      .catch(() => toast.error("تعذّر تحميل صور الموقع"))
      .finally(() => setLoading(false));
  }, []);

  const save = async (next: SiteImages) => {
    setSaving(true);
    const res = await adminSaveSettingsFn({ data: { section: "images", value: next } });
    setSaving(false);
    if (!res.ok) {
      toast.error(res.error);
      return false;
    }
    setImages(res.value as SiteImages);
    invalidateSiteSettings();
    toast.success("تم حفظ صور الموقع");
    return true;
  };

  const upload = async (slot: (typeof SITE_IMAGE_SLOTS)[number], file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("الملف المختار ليس صورة");
      return;
    }
    if (file.type === "image/svg+xml") {
      toast.error("صيغة SVG غير مقبولة — استخدم PNG أو JPG أو WebP");
      return;
    }
    setBusySlot(slot.id);
    try {
      const dataUrl = await encodeImage(file);
      if (dataUrl.length > MAX_SITE_IMAGE_BYTES) {
        toast.error("الصورة كبيرة جدًا بعد المعالجة — استخدم صورة أصغر");
        return;
      }
      const next = { ...images, [slot.id]: dataUrl };
      setImages(next);
      await save(next);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "تعذّرت معالجة الصورة");
    } finally {
      setBusySlot(null);
    }
  };

  const reset = async (slot: (typeof SITE_IMAGE_SLOTS)[number]) => {
    const next = { ...images, [slot.id]: "" };
    setImages(next);
    await save(next);
  };

  const galleryItemId = () =>
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `preview-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const uploadGalleryImage = async (file: File, replaceId?: string) => {
    if (!file.type.startsWith("image/") || file.type === "image/svg+xml") {
      toast.error("استخدم صورة PNG أو JPG أو WebP أو صيغة صورة مدعومة");
      return;
    }
    const busyId = replaceId ?? "gallery";
    setBusySlot(busyId);
    try {
      const src = await encodeImage(file);
      const gallery = [...(images.gallery ?? [])];
      if (replaceId) {
        const index = gallery.findIndex((item) => item.id === replaceId);
        if (index < 0) return;
        gallery[index] = { ...gallery[index], src };
      } else {
        gallery.push({
          id: galleryItemId(),
          src,
          alt: file.name.replace(/\.[^.]+$/, "").slice(0, 180),
          enabled: true,
        });
      }
      await save({ ...images, gallery });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "تعذّرت معالجة الصورة");
    } finally {
      setBusySlot(null);
    }
  };

  const updateGallery = async (
    gallery: SiteImages["gallery"],
    persist = false,
  ) => {
    const next = { ...images, gallery };
    setImages(next);
    if (persist) await save(next);
  };

  const addGalleryUrl = async () => {
    const src = galleryUrl.trim();
    try {
      if (new URL(src).protocol !== "https:") throw new Error();
    } catch {
      toast.error("أدخل رابط صورة يبدأ بـ https://");
      return;
    }
    const gallery = [
      ...(images.gallery ?? []),
      { id: galleryItemId(), src, alt: "", enabled: true },
    ];
    if (await save({ ...images, gallery })) setGalleryUrl("");
  };

  const moveGalleryItem = (index: number, delta: -1 | 1) => {
    const nextIndex = index + delta;
    if (nextIndex < 0 || nextIndex >= (images.gallery ?? []).length) return;
    const gallery = [...(images.gallery ?? [])];
    [gallery[index], gallery[nextIndex]] = [gallery[nextIndex], gallery[index]];
    void updateGallery(gallery, true);
  };

  if (loading) {
    return (
      <p className="flex items-center gap-2 text-[13px] text-muted">
        <Loader2 className="size-4 animate-spin" /> جارٍ التحميل…
      </p>
    );
  }

  return (
    <div className="grid gap-5">
      <section className="grid gap-2 rounded-xl border border-line bg-surface p-5">
        <h2 className="text-[16px] font-black">صور الموقع</h2>
        <p className="text-[11px] leading-6 text-muted">
          استبدل صور الصفحة الرئيسية وشعار الهوية دون تعديل الكود. أي مقاس مقبول —
          تُعاد معالجة الصورة إلى حد أقصى {SITE_IMAGE_MAX_EDGE} بكسل على أطول ضلع مع
          الحفاظ على النسبة. الصورة المحفوظة تبقى بعد التحديث، والحذف لا يعيد
          الصور الافتراضية القديمة.
        </p>
      </section>

      {SITE_IMAGE_SLOTS.map((slot) => {
        const current = images[slot.id];
        const custom = Boolean(current);
        const src = current || (slot.id === "mark" ? "/nasaq-mark.svg" : "");
        return (
          <section key={slot.id} className="grid gap-3 rounded-xl border border-line bg-surface p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-[14px] font-extrabold">{slot.label}</h3>
                <p className="mt-0.5 text-[11px] text-muted">{slot.hint}</p>
                <p className="mt-1 text-[10px] text-muted">
                  {custom
                    ? "صورة محفوظة من المالك"
                    : slot.id === "mark"
                      ? "شعار نَسَق الحالي"
                      : "لا توجد صورة — لن تظهر الصورة القديمة"}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={(node) => {
                    inputs.current[slot.id] = node;
                  }}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file) void upload(slot, file);
                  }}
                />
                <button
                  type="button"
                  className={ghostBtn}
                  disabled={busySlot === slot.id || saving}
                  onClick={() => inputs.current[slot.id]?.click()}
                >
                  {busySlot === slot.id ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : custom ? (
                    <Upload className="size-3.5" />
                  ) : (
                    <ImageUp className="size-3.5" />
                  )}
                  {custom ? "استبدال الصورة" : "رفع صورة"}
                </button>
                {custom && (
                  <button
                    type="button"
                    className={cn(ghostBtn, "text-error")}
                    disabled={busySlot === slot.id || saving}
                    onClick={() => void reset(slot)}
                  >
                    <Trash2 className="size-3.5" /> حذف الصورة
                  </button>
                )}
              </div>
            </div>
            <div className="grid h-44 place-items-center overflow-hidden rounded-lg border border-line bg-surface-2 p-2">
              {src ? (
                <img
                  src={src}
                  alt=""
                  className="max-h-full max-w-full object-contain"
                  loading="lazy"
                />
              ) : (
                <span className="text-[12px] font-bold text-muted">لا توجد صورة</span>
              )}
            </div>
          </section>
        );
      })}

      <section className="grid gap-4 rounded-xl border border-line bg-surface p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-[14px] font-extrabold">معرض صور المحرر</h2>
            <p className="mt-1 text-[11px] leading-5 text-muted">
              أضف أي عدد من لقطات المحرر، رتّبها، واختر الصور المنشورة في الصفحة الرئيسية.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <input
              ref={(node) => {
                galleryInputs.current.new = node;
              }}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void uploadGalleryImage(file);
              }}
            />
            <button
              type="button"
              className={ghostBtn}
              disabled={saving || busySlot !== null}
              onClick={() => galleryInputs.current.new?.click()}
            >
              {busySlot === "gallery" ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Plus className="size-3.5" />
              )}
              إضافة صورة
            </button>
            <button
              type="button"
              className={primaryBtn}
              disabled={saving || busySlot !== null}
              onClick={() => void save(images)}
            >
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              حفظ المعرض
            </button>
          </div>
        </div>

        {images.gallery?.length ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {images.gallery.map((item, index) => (
              <article
                key={item.id}
                className="overflow-hidden rounded-lg border border-line bg-surface-2"
              >
                <div className="grid h-40 place-items-center overflow-hidden p-2">
                  <img
                    src={item.src}
                    alt={item.alt}
                    loading="lazy"
                    decoding="async"
                    className="max-h-full max-w-full object-contain"
                  />
                </div>
                <div className="grid gap-2 border-t border-line bg-surface p-3">
                  <label className="grid gap-1 text-[11px] font-bold text-muted">
                    وصف الصورة
                    <input
                      className="h-9 rounded-md border border-line bg-surface px-2 text-[12px] font-normal text-ink outline-none focus:border-brand"
                      value={item.alt}
                      onChange={(event) => {
                        const gallery = [...images.gallery];
                        gallery[index] = { ...item, alt: event.target.value };
                        void updateGallery(gallery);
                      }}
                    />
                  </label>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <input
                      ref={(node) => {
                        galleryInputs.current[item.id] = node;
                      }}
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
                      className="hidden"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.target.value = "";
                        if (file) void uploadGalleryImage(file, item.id);
                      }}
                    />
                    <button
                      type="button"
                      className={ghostBtn}
                      disabled={busySlot === item.id || saving}
                      onClick={() => galleryInputs.current[item.id]?.click()}
                    >
                      {busySlot === item.id ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
                      استبدال
                    </button>
                    <button
                      type="button"
                      className={ghostBtn}
                      aria-label={item.enabled ? "إخفاء الصورة من المعرض" : "إظهار الصورة في المعرض"}
                      onClick={() => {
                        const gallery = [...images.gallery];
                        gallery[index] = { ...item, enabled: !item.enabled };
                        void updateGallery(gallery, true);
                      }}
                    >
                      {item.enabled ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
                      {item.enabled ? "منشورة" : "مخفية"}
                    </button>
                    <button
                      type="button"
                      className={ghostBtn}
                      aria-label="تحريك الصورة للأعلى"
                      disabled={index === 0 || saving}
                      onClick={() => moveGalleryItem(index, -1)}
                    >
                      <ArrowUp className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      className={ghostBtn}
                      aria-label="تحريك الصورة للأسفل"
                      disabled={index === images.gallery.length - 1 || saving}
                      onClick={() => moveGalleryItem(index, 1)}
                    >
                      <ArrowDown className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      className={cn(ghostBtn, "text-error")}
                      disabled={saving}
                      onClick={() => {
                        const gallery = images.gallery.filter((entry) => entry.id !== item.id);
                        void updateGallery(gallery, true);
                      }}
                    >
                      <Trash2 className="size-3.5" />
                      حذف
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="rounded-lg border border-dashed border-line px-4 py-7 text-center text-[12px] font-semibold text-muted">
            لا توجد صور في المعرض بعد.
          </p>
        )}

        <div className="flex flex-wrap items-end gap-2 border-t border-line pt-3">
          <label className="grid min-w-0 flex-1 gap-1 text-[11px] font-bold text-muted">
            أو أضف رابط صورة
            <input
              dir="ltr"
              type="url"
              value={galleryUrl}
              onChange={(event) => setGalleryUrl(event.target.value)}
              placeholder="https://example.com/preview.webp"
              className="h-9 rounded-md border border-line bg-surface px-2 text-[12px] font-normal text-ink outline-none focus:border-brand"
            />
          </label>
          <button
            type="button"
            className={ghostBtn}
            disabled={!galleryUrl.trim() || saving}
            onClick={() => void addGalleryUrl()}
          >
            <Plus className="size-3.5" />
            إضافة الرابط
          </button>
        </div>
      </section>

      <section className="grid gap-2 rounded-xl border border-line bg-surface p-5">
        <h3 className="text-[13px] font-extrabold">رابط صورة خارجي (اختياري)</h3>
        <p className="text-[11px] leading-6 text-muted">
          بدل الرفع يمكنك لصق رابط <span dir="ltr">https://</span> لأي خانة — يُستخدم
          كما هو عند الحفظ.
        </p>
        {SITE_IMAGE_SLOTS.map((slot) => (
          <label key={slot.id} className="grid gap-1.5 text-[12px] font-extrabold text-muted">
            {slot.label}
            <input
              dir="ltr"
              className="h-10 w-full rounded-lg border border-line bg-surface px-3 text-[12px] font-normal outline-none focus:border-brand"
              placeholder={slot.fallback}
              value={images[slot.id]}
              onChange={(e) => setImages((s) => ({ ...s, [slot.id]: e.target.value }))}
            />
          </label>
        ))}
        <div className="mt-1">
          <button
            type="button"
            className={primaryBtn}
            disabled={saving || busySlot !== null}
            onClick={() => void save(images)}
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}{" "}
            حفظ الروابط
          </button>
        </div>
      </section>
    </div>
  );
}

export default SiteImagesPanel;
