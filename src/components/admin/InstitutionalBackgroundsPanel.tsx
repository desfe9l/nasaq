import { useRef, useState } from "react";
import { toast } from "sonner";
import { mutateInstitutionalBackgroundFn } from "@/lib/institutional/functions";
import { useInstitutionalBackgrounds, notifyInstitutionalBackgrounds, readBackgroundFile } from "@/lib/editor/use-institutional-backgrounds";

const btn = "inline-flex h-8 items-center justify-center rounded-lg border border-line px-2 text-[11px] font-extrabold disabled:opacity-50";

export function InstitutionalBackgroundsPanel() {
  const { items, refresh } = useInstitutionalBackgrounds();
  const inputRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);
  const [replaceId, setReplaceId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

  return (
    <section className="grid gap-3 rounded-xl border border-line bg-surface p-4">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-black">خلفيات مؤسسية</h3>
          <p className="text-[12px] font-semibold text-muted">مجلد المكتبة الحقيقي. النشر يظهر في خيارات الصفحة دون تحديث يدوي.</p>
        </div>
        <button type="button" className={btn} disabled={busy} onClick={() => inputRef.current?.click()}>إضافة خلفية</button>
        <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="sr-only" onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          void run(async () => {
            const image = await readBackgroundFile(file);
            return mutateInstitutionalBackgroundFn({ data: { op: "create", name: file.name.replace(/\.[^.]+$/, ""), ...image, published: true } });
          });
        }} />
        <input ref={replaceRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="sr-only" onChange={(event) => {
          const file = event.target.files?.[0];
          const id = replaceId;
          event.target.value = "";
          if (!file || !id) return;
          void run(async () => {
            const image = await readBackgroundFile(file);
            return mutateInstitutionalBackgroundFn({ data: { op: "replace", id, ...image } });
          });
        }} />
      </header>
      {items.length === 0 ? <p className="text-[12px] font-semibold text-muted">لا خلفيات بعد.</p> : (
        <ul className="grid gap-2">
          {items.map((item, index) => (
            <li key={item.id} className="flex items-center gap-2 rounded-lg border border-line p-2">
              <img src={item.src} alt="" className="h-12 w-16 rounded object-cover" />
              <input
                defaultValue={item.name}
                aria-label={`اسم ${item.name}`}
                className="h-8 min-w-0 flex-1 rounded border border-line bg-transparent px-2 text-[12px] font-bold"
                onBlur={(event) => {
                  const name = event.target.value.trim();
                  if (name && name !== item.name) void run(() => mutateInstitutionalBackgroundFn({ data: { op: "rename", id: item.id, name } }));
                }}
              />
              <button type="button" className={btn} disabled={index === 0 || busy} onClick={() => void run(() => mutateInstitutionalBackgroundFn({ data: { op: "reorder", ids: (() => { const ids = items.map((row) => row.id).filter((id) => id !== item.id); ids.splice(index - 1, 0, item.id); return ids; })() } }))}>أعلى</button>
              <button type="button" className={btn} disabled={busy} onClick={() => { setReplaceId(item.id); replaceRef.current?.click(); }}>استبدال</button>
              <button type="button" className={btn} disabled={busy} onClick={() => void run(() => mutateInstitutionalBackgroundFn({ data: { op: "publish", id: item.id, published: !item.published } }))}>{item.published ? "إلغاء النشر" : "نشر"}</button>
              <button type="button" className={btn} disabled={busy} onClick={() => void run(() => mutateInstitutionalBackgroundFn({ data: { op: "delete", id: item.id } }))}>حذف</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
