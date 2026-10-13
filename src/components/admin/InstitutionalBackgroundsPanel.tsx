import { useRef, useState } from "react";
import { toast } from "sonner";
import { Check, Eye, Layers, Trash2, Upload } from "lucide-react";
import { mutateInstitutionalBackgroundFn } from "@/lib/institutional/functions";
import {
  useInstitutionalBackgrounds,
  notifyInstitutionalBackgrounds,
  readBackgroundFile,
} from "@/lib/editor/use-institutional-backgrounds";
import type { InstitutionalBackground } from "@/lib/editor/institutional-backgrounds";
import { cn } from "@/lib/utils";

const btn =
  "inline-flex h-8 items-center justify-center gap-1 rounded-lg border border-line px-2 text-[11px] font-extrabold disabled:opacity-50";

type UploadRow = {
  id: string;
  name: string;
  progress: number;
  status: "reading" | "uploading" | "done" | "error";
  error?: string;
};

/**
 * «خلفيات مؤسسية» — the persistent, reusable background LIBRARY.
 *
 * Upload is one operation for any number of files (multi-select → one batch
 * write), with live per-file progress; every row is a library asset with
 * preview, rename, replace, reorder, publish and delete — plus multi-select
 * for bulk deletion. Editor sessions consume the same published catalog.
 */
export function InstitutionalBackgroundsPanel() {
  const { items, refresh } = useInstitutionalBackgrounds();
  const inputRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);
  const [replaceId, setReplaceId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [uploads, setUploads] = useState<UploadRow[]>([]);
  const [preview, setPreview] = useState<InstitutionalBackground | null>(null);

  const selectedCount = selected.size;

  const run = async (work: () => Promise<{ ok: boolean; error?: string }>) => {
    setBusy(true);
    try {
      const result = await work();
      if (!result.ok) throw new Error(result.error || "تعذر الحفظ");
      notifyInstitutionalBackgrounds();
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "تعذر الحفظ");
    } finally {
      setBusy(false);
    }
  };

  /** Multi-file upload in ONE operation, with live per-file progress. */
  const uploadFiles = (files: File[]) => {
    if (!files.length) return;
    const rows: UploadRow[] = files.map((file, i) => ({
      id: `up-${Date.now()}-${i}`,
      name: file.name,
      progress: 8,
      status: "reading",
    }));
    setUploads(rows);
    const bump = (id: string, patch: Partial<UploadRow>) =>
      setUploads((prev) =>
        prev.map((row) => (row.id === id ? { ...row, ...patch } : row)),
      );
    void (async () => {
      const ready: { name: string; src: string; w: number; h: number; published: boolean }[] = [];
      for (let i = 0; i < files.length; i += 1) {
        const row = rows[i];
        try {
          bump(row.id, { progress: 35, status: "reading" });
          const image = await readBackgroundFile(files[i]);
          bump(row.id, { progress: 70, status: "uploading" });
          ready.push({
            name: files[i].name.replace(/\.[^.]+$/, "").slice(0, 80) || "خلفية",
            ...image,
            published: true,
          });
        } catch (error) {
          bump(row.id, {
            status: "error",
            progress: 100,
            error: error instanceof Error ? error.message : "تعذر قراءة الصورة",
          });
        }
      }
      if (ready.length) {
        // Chunked batches keep each request well under the body limit while
        // the whole selection still lands as ONE upload operation.
        let saved = 0;
        for (let i = 0; i < ready.length; i += 6) {
          const result = await mutateInstitutionalBackgroundFn({
            data: { op: "createMany", items: ready.slice(i, i + 6) },
          });
          if (!result.ok) {
            for (const row of rows)
              if (row.status !== "error")
                bump(row.id, { status: "error", progress: 100, error: result.error || "تعذر الرفع" });
            toast.error(result.error || "تعذر رفع الخلفيات");
            return;
          }
          saved += ready.slice(i, i + 6).length;
        }
        for (const row of rows)
          if (row.status !== "error") bump(row.id, { status: "done", progress: 100 });
        notifyInstitutionalBackgrounds();
        await refresh();
        toast.success(
          `تمت إضافة ${saved} ${saved === 1 ? "خلفية" : "خلفيات"} إلى المكتبة`,
        );
      }
      window.setTimeout(() => setUploads([]), 2500);
    })();
  };

  const toggleSelected = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const bulkDelete = () => {
    const ids = [...selected];
    if (!ids.length) return;
    void run(async () => {
      const result = await mutateInstitutionalBackgroundFn({
        data: { op: "deleteMany", ids },
      });
      if (result.ok) setSelected(new Set());
      return result;
    });
  };

  const reorderUp = (item: InstitutionalBackground, index: number) =>
    void run(() =>
      mutateInstitutionalBackgroundFn({
        data: {
          op: "reorder",
          ids: (() => {
            const ids = items.map((row) => row.id).filter((id) => id !== item.id);
            ids.splice(Math.max(0, index - 1), 0, item.id);
            return ids;
          })(),
        },
      }),
    );

  const busyRow = busy;

  return (
    <section className="grid gap-3 rounded-xl border border-line bg-surface p-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="inline-flex items-center gap-1.5 text-[15px] font-black">
            <Layers className="size-4" /> مكتبة الخلفيات المؤسسية
          </h3>
          <p className="text-[12px] font-semibold text-muted">
            مكتبة دائمة قابلة لإعادة الاستخدام. ارفع عدة خلفيات دفعة واحدة، وانشرها لتظهر في خيارات الصفحة.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {selectedCount > 0 && (
            <>
              <span className="text-[11px] font-extrabold text-muted">
                {selectedCount} محددة
              </span>
              <button
                type="button"
                className={cn(btn, "border-error/40 text-error")}
                disabled={busyRow}
                onClick={bulkDelete}
              >
                <Trash2 className="size-3.5" /> حذف المحدد
              </button>
            </>
          )}
          <button
            type="button"
            className={cn(btn, "bg-navy text-white")}
            disabled={busyRow}
            onClick={() => inputRef.current?.click()}
          >
            <Upload className="size-3.5" /> رفع خلفيات (متعدد)
          </button>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml"
          multiple
          className="sr-only"
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = "";
            uploadFiles(files);
          }}
        />
        <input
          ref={replaceRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            const id = replaceId;
            event.target.value = "";
            if (!file || !id) return;
            void run(async () => {
              const image = await readBackgroundFile(file);
              return mutateInstitutionalBackgroundFn({
                data: { op: "replace", id, ...image },
              });
            });
          }}
        />
      </header>

      {uploads.length > 0 && (
        <ul className="grid gap-1.5 rounded-lg border border-dashed border-line p-2">
          {uploads.map((row) => (
            <li key={row.id} className="grid gap-1">
              <div className="flex items-center justify-between gap-2 text-[11px] font-bold">
                <span className="truncate">{row.name}</span>
                <span
                  className={cn(
                    "shrink-0",
                    row.status === "error" ? "text-error" : "text-muted",
                  )}
                >
                  {row.status === "error"
                    ? row.error
                    : row.status === "done"
                      ? "تم"
                      : row.status === "uploading"
                        ? "جارٍ الحفظ…"
                        : "جارٍ المعالجة…"}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-line/60">
                <div
                  className={cn(
                    "h-full rounded-full transition-all",
                    row.status === "error" ? "bg-error" : "bg-brand",
                  )}
                  style={{ width: `${row.progress}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}

      {items.length === 0 ? (
        <p className="text-[12px] font-semibold text-muted">
          لا خلفيات بعد — ابدأ برفع عدة صور دفعة واحدة.
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-2 lg:grid-cols-3">
          {items.map((item, index) => {
            const isOn = selected.has(item.id);
            return (
              <li
                key={item.id}
                className={cn(
                  "grid gap-2 rounded-lg border p-2",
                  isOn ? "border-navy-2 bg-navy-2/5" : "border-line",
                )}
              >
                <div className="relative">
                  <img
                    src={item.src}
                    alt=""
                    className="h-24 w-full rounded object-cover"
                  />
                  <button
                    type="button"
                    aria-label={isOn ? "إلغاء التحديد" : "تحديد"}
                    aria-pressed={isOn}
                    className={cn(
                      "absolute right-1.5 top-1.5 grid size-6 place-items-center rounded-md border text-[10px] font-black",
                      isOn
                        ? "border-navy bg-navy text-white"
                        : "border-line bg-surface/90 text-muted",
                    )}
                    onClick={() => toggleSelected(item.id)}
                  >
                    {isOn ? <Check className="size-3.5" /> : index + 1}
                  </button>
                  <button
                    type="button"
                    aria-label={`معاينة ${item.name}`}
                    className="absolute left-1.5 top-1.5 grid size-6 place-items-center rounded-md border border-line bg-surface/90 text-muted"
                    onClick={() => setPreview(item)}
                  >
                    <Eye className="size-3.5" />
                  </button>
                </div>
                <input
                  defaultValue={item.name}
                  aria-label={`اسم ${item.name}`}
                  className="h-8 min-w-0 rounded border border-line bg-transparent px-2 text-[12px] font-bold"
                  onBlur={(event) => {
                    const name = event.target.value.trim();
                    if (name && name !== item.name)
                      void run(() =>
                        mutateInstitutionalBackgroundFn({
                          data: { op: "rename", id: item.id, name },
                        }),
                      );
                  }}
                />
                <div className="flex flex-wrap items-center gap-1">
                  <button
                    type="button"
                    className={btn}
                    disabled={index === 0 || busyRow}
                    onClick={() => reorderUp(item, index)}
                  >
                    أعلى
                  </button>
                  <button
                    type="button"
                    className={btn}
                    disabled={busyRow}
                    onClick={() => {
                      setReplaceId(item.id);
                      replaceRef.current?.click();
                    }}
                  >
                    استبدال
                  </button>
                  <button
                    type="button"
                    className={btn}
                    disabled={busyRow}
                    onClick={() =>
                      void run(() =>
                        mutateInstitutionalBackgroundFn({
                          data: {
                            op: "publish",
                            id: item.id,
                            published: !item.published,
                          },
                        }),
                      )
                    }
                  >
                    {item.published ? "إلغاء النشر" : "نشر"}
                  </button>
                  <button
                    type="button"
                    className={cn(btn, "text-error")}
                    disabled={busyRow}
                    onClick={() =>
                      void run(() =>
                        mutateInstitutionalBackgroundFn({
                          data: { op: "delete", id: item.id },
                        }),
                      )
                    }
                  >
                    <Trash2 className="size-3.5" /> حذف
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {preview && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-6"
          role="dialog"
          aria-label={`معاينة ${preview.name}`}
          onClick={() => setPreview(null)}
        >
          <figure className="grid max-h-full w-full max-w-3xl gap-2 overflow-auto rounded-xl bg-surface p-4">
            <img
              src={preview.src}
              alt={preview.name}
              className="w-full rounded-lg object-contain"
            />
            <figcaption className="text-[12px] font-extrabold text-muted">
              {preview.name} — {preview.w}×{preview.h}
            </figcaption>
          </figure>
        </div>
      )}
    </section>
  );
}
