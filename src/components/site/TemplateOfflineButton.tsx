import { useEffect, useState } from "react";
import { Download, Check, Loader2, WifiOff } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { getStorageOwner } from "@/lib/editor/storage-owner";

interface Props {
  templateId: string;
  title: string;
  tier?: string | null;
  source: "admin" | "personal" | "builtin";
  fetchContent?: () => Promise<{ content: string; thumbnail?: string | null; pagesCount?: number }>;
  onCached?: () => void;
}

/**
 * Allow licensed/authorized templates to be explicitly downloaded for offline use.
 * Shows download state and handles offline gating.
 */
export function TemplateOfflineButton({ templateId, title, tier, source, fetchContent, onCached }: Props) {
  const [state, setState] = useState<"idle" | "checking" | "cached" | "downloading" | "offline-blocked">("checking");

  useEffect(() => {
    let alive = true;
    void (async () => {
      const { isTemplateAvailableOffline } = await import("@/lib/offline/template-cache");
      const cached = await isTemplateAvailableOffline(templateId, getStorageOwner());
      if (!alive) return;
      setState(cached ? "cached" : "idle");
    })();
    return () => { alive = false; };
  }, [templateId]);

  const handleDownload = async () => {
    if (!fetchContent) return;
    setState("downloading");
    try {
      const { downloadAndCacheTemplate } = await import("@/lib/offline/template-cache");
      const res = await downloadAndCacheTemplate({
        id: templateId,
        title,
        tier: tier ?? null,
        source,
        fetchContent,
      });
      if (res.ok) {
        setState("cached");
        onCached?.();
      } else {
        setState(res.error.includes("اتصال") ? "offline-blocked" : "idle");
        toast.error(res.error);
      }
    } catch {
      setState("idle");
      toast.error("تعذر حفظ القالب للعمل دون اتصال");
    }
  };

  if (state === "checking") {
    return (
      <span className="inline-flex h-7 items-center gap-1 rounded-full border border-line px-2 text-[10px] font-bold text-muted">
        <Loader2 className="size-3 animate-spin" /> جارٍ التحقق…
      </span>
    );
  }
  if (state === "cached") {
    return (
      <span
        title="متاح دون اتصال — تم تنزيل القالب على هذا الجهاز"
        className="inline-flex h-7 items-center gap-1 rounded-full bg-ok/10 px-2 text-[10px] font-extrabold text-success border border-ok/30"
      >
        <Check className="size-3" /> متاح دون اتصال
      </span>
    );
  }
  if (state === "offline-blocked") {
    return (
      <span className="inline-flex h-7 items-center gap-1 rounded-full bg-gold/10 px-2 text-[10px] font-bold text-warning border border-gold/40">
        <WifiOff className="size-3" /> يتطلب اتصالاً
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={handleDownload}
      disabled={state === "downloading"}
      title="حفظ القالب للاستخدام دون اتصال"
      className={cn(
        "inline-flex h-7 items-center gap-1 rounded-full border px-2 text-[10px] font-bold transition",
        "border-line bg-surface hover:bg-line-2 text-ink",
        state === "downloading" && "opacity-60 cursor-wait"
      )}
    >
      {state === "downloading" ? <Loader2 className="size-3 animate-spin" /> : <Download className="size-3" />}
      حفظ للعمل دون اتصال
    </button>
  );
}
