import { useRef, useState } from "react";
import { FolderOpen } from "lucide-react";
import { receiveAndContinueInEditor } from "@/lib/nsq/intake";
import { cn } from "@/lib/utils";

/**
 * Entry-point file picker shared by public and licensed workspace surfaces.
 * The NSQ intake validates and preserves the file before continuing to the
 * editor, so an auth redirect or storage failure cannot silently discard work.
 */
export function ProjectFileButton({ className }: { className?: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const choose = async (file: File | undefined) => {
    if (!file || busy) return;
    setBusy(true);
    try {
      await receiveAndContinueInEditor(file);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <>
      <button
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        className={cn(
          "inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-line bg-surface px-4 text-[12px] font-extrabold text-ink transition hover:bg-line-2 disabled:cursor-wait disabled:opacity-60",
          className,
        )}
      >
        <FolderOpen className="size-4" aria-hidden />
        {busy ? "جارٍ التحقق من الملف…" : "فتح ملف مشروع"}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".nsq,application/octet-stream,.json,application/json"
        className="hidden"
        aria-label="اختيار ملف مشروع نَسَق"
        onChange={(event) => void choose(event.target.files?.[0])}
      />
    </>
  );
}
