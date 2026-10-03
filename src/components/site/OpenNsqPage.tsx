import { useCallback, useRef, useState } from "react";
import {
  FileArchive,
  FolderOpen,
  Layers,
  Loader2,
  PenLine,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { BRAND } from "@/lib/brand";
import {
  NSQ_ACCEPT,
  NSQ_ERROR_MESSAGES,
  isProjectFileName,
  nsqErrorMessage,
} from "@/lib/nsq/format";
import { putPending } from "@/lib/nsq/inbox";
import {
  NSQ_RESUME_URL,
  summaryOf,
  validateProjectFile,
} from "@/lib/nsq/intake";
import { SiteFooter, SiteHeader } from "./SiteChrome";
import { cn } from "@/lib/utils";

/**
 * «افتح ملف نَسَق» — recognise, validate and preserve a received `.nsq`, then
 * continue straight into the editor, where the project opens (after sign-in
 * for a visitor). Handles files launched by the OS through the installed
 * app's file handler as well as picked or dropped ones.
 */
export function OpenNsqPage() {
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "checking"; name: string }
    | { kind: "error"; message: string; name?: string }
  >({ kind: "idle" });
  const [over, setOver] = useState(false);

  const busyRef = useRef(false);
  const handle = useCallback(async (file: File) => {
    if (busyRef.current) return;
    if (!isProjectFileName(file.name)) {
      setState({
        kind: "error",
        message: NSQ_ERROR_MESSAGES["not-nsq"],
        name: file.name,
      });
      return;
    }
    busyRef.current = true;
    setState({ kind: "checking", name: file.name });
    try {
      const result = await validateProjectFile(file, true);
      await putPending({
        fileName: file.name,
        size: file.size,
        receivedAt: Date.now(),
        summary: summaryOf(result, file.name),
        blob: file,
      });
      window.location.assign(NSQ_RESUME_URL);
    } catch (err) {
      setState({
        kind: "error",
        message: nsqErrorMessage(err),
        name: file.name,
      });
    } finally {
      busyRef.current = false;
    }
  }, []);

  const checking = state.kind === "checking";

  return (
    <div className="min-h-screen bg-paper">
      <SiteHeader current="/open" />
      <main className="mx-auto w-full max-w-2xl px-4 py-12 sm:py-16" dir="rtl">
        <div className="text-center">
          <span className="inline-grid size-12 place-items-center rounded-[14px] bg-navy/10 text-brand">
            <FileArchive className="size-6" aria-hidden />
          </span>
          <h1 className="mt-4 text-2xl font-extrabold">
            افتح ملف {BRAND.platform}
          </h1>
          <p className="mx-auto mt-2 max-w-md text-[13.5px] leading-7 text-muted">
            استلمت مشروعًا بصيغة ‎.nsq؟ افتحه هنا ليظهر في محرر {BRAND.platform}{" "}
            قابلًا للتعديل بالكامل — النصوص والصور والطبقات كما صُمّمت.
          </p>
        </div>

        <div
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes("Files")) return;
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            const file = e.dataTransfer.files?.[0];
            if (file && !checking) void handle(file);
          }}
          className={cn(
            "mt-8 grid place-items-center rounded-[16px] border-2 border-dashed px-6 py-12 text-center transition",
            over
              ? "border-gold bg-gold/10"
              : "border-line bg-surface",
          )}
        >
          {checking ? (
            <p className="inline-flex items-center gap-2 text-[13px] font-bold text-brand-hover">
              <Loader2 className="size-4 animate-spin" />
              جارٍ التحقق من «{state.name}»…
            </p>
          ) : (
            <>
              <Layers
                className="size-8 text-brand-hover"
                aria-hidden
              />
              <p className="mt-3 text-[13px] font-bold">
                اسحب ملف ‎.nsq وأفلته هنا
              </p>
              <p className="mt-1 text-[12px] text-muted">أو</p>
              <button
                type="button"
                onClick={() => input.current?.click()}
                className="mt-3 inline-flex h-11 items-center gap-2 rounded-[10px] bg-navy px-5 text-[13px] font-extrabold text-on-brand transition hover:bg-navy-2"
              >
                <FolderOpen className="size-4" />
                اختيار ملف من الجهاز
              </button>
            </>
          )}
        </div>

        {state.kind === "error" && (
          <p
            role="alert"
            className="mt-4 flex items-start gap-2 rounded-[10px] border border-danger/30 bg-danger/5 p-3 text-[12.5px] leading-6 text-error"
          >
            <TriangleAlert className="mt-1 size-4 shrink-0" aria-hidden />
            <span>
              {state.message}
              <a className="mt-2 block underline" href={NSQ_RESUME_URL}>
                متابعة الملف المحفوظ في المحرر
              </a>
              {state.name ? (
                <span className="block text-[11px] opacity-80">
                  {state.name}
                </span>
              ) : null}
            </span>
          </p>
        )}

        <input
          ref={input}
          type="file"
          accept={NSQ_ACCEPT}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void handle(file);
          }}
        />

        <ul className="mt-8 grid gap-3 text-[12.5px] text-muted sm:grid-cols-2">
          <li className="flex items-start gap-2 rounded-[12px] border border-line bg-surface p-4">
            <ShieldCheck
              className="mt-0.5 size-4 shrink-0 text-brand-hover"
              aria-hidden
            />
            يُفحص الملف ويُحفظ في متصفحك أولًا — لا يُنفَّذ أي محتوى منه، ولا
            يضيع أثناء تسجيل الدخول.
          </li>
          <li className="flex items-start gap-2 rounded-[12px] border border-line bg-surface p-4">
            <PenLine
              className="mt-0.5 size-4 shrink-0 text-brand-hover"
              aria-hidden
            />
            يُفتح كمشروع جديد في مكتبتك، فتعدّل عليه وتصدّره كأي مشروع في{" "}
            {BRAND.platform}.
          </li>
        </ul>
      </main>
      <SiteFooter />
    </div>
  );
}
