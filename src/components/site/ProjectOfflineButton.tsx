import { useEffect, useState } from "react";
import { Check, Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/**
 * Per-project «حفظ للعمل دون اتصال». Prepares the real document, its pages
 * and remote assets through the existing offline cache — then shows
 * «متاح دون اتصال».
 */
export function ProjectOfflineButton({
  projectId,
  updatedAt,
  className,
}: {
  projectId: string;
  updatedAt?: number;
  className?: string;
}) {
  const [phase, setPhase] = useState<"checking" | "ready" | "idle" | "working">("checking");

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const { getPreparedProject, isProjectPreparedOffline } = await import("@/lib/offline/workspace-cache");
      const prepared = await isProjectPreparedOffline(projectId);
      const mark = prepared ? await getPreparedProject(projectId) : null;
      if (!alive) return;
      const stale = Boolean(mark && updatedAt && updatedAt > mark.updatedAt + 1500);
      setPhase(prepared && !stale ? "ready" : "idle");
    };
    void load();
    const onPrepared = (event: Event) => {
      const id = (event as CustomEvent<{ id?: string }>).detail?.id;
      if (!id || id === projectId) void load();
    };
    window.addEventListener("nasaq:project-prepared", onPrepared);
    return () => {
      alive = false;
      window.removeEventListener("nasaq:project-prepared", onPrepared);
    };
  }, [projectId, updatedAt]);

  const prepare = async () => {
    setPhase("working");
    try {
      const { prepareProjectForOffline } = await import("@/lib/offline/workspace-cache");
      const result = await prepareProjectForOffline(projectId);
      if (result.ok) {
        setPhase("ready");
        toast.success("المشروع جاهز للعمل دون اتصال", {
          description: `${result.pages} صفحة محفوظة على هذا الجهاز`,
        });
      } else {
        setPhase("idle");
        toast.error(result.error);
      }
    } catch {
      setPhase("idle");
      toast.error("تعذر تحضير المشروع للعمل دون اتصال");
    }
  };

  if (phase === "checking") {
    return (
      <span className={cn("inline-flex h-7 items-center gap-1 text-[11px] font-bold text-muted", className)}>
        <Loader2 className="size-3 animate-spin" />
      </span>
    );
  }

  if (phase === "ready") {
    return (
      <span
        title="صفحات المشروع وأصوله محفوظة على هذا الجهاز"
        className={cn(
          "inline-flex h-7 items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 text-[11px] font-extrabold text-emerald-800",
          className,
        )}
      >
        <Check className="size-3" />
        متاح دون اتصال
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => void prepare()}
      disabled={phase === "working"}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 text-[11px] font-extrabold text-ink transition hover:border-brand hover:bg-line-2 disabled:cursor-wait disabled:opacity-60",
        className,
      )}
    >
      {phase === "working" ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
      {phase === "working" ? "جارٍ التحضير…" : "حفظ للعمل دون اتصال"}
    </button>
  );
}
