import { cn } from "@/lib/utils";

/**
 * Neutral, brand-consistent loading placeholders.
 *
 * Replaces full-colour splash screens (and any personal signature that used to
 * sit on them): the visitor sees the shape of the surface that is coming, in
 * the platform's own surface/line colours, light and dark. Nothing here adds
 * delay — these render in the same frame the route paints, and disappear the
 * moment real content exists.
 */

export function Skeleton({ className, rounded = "rounded-[8px]" }: { className?: string; rounded?: string }) {
  return (
    <span
      aria-hidden
      className={cn("block animate-pulse bg-line-2 dark:bg-white/10", rounded, className)}
    />
  );
}

/** The editor shell: top bar, two side panels and a page surface. */
export function EditorWorkspaceSkeleton() {
  return (
    <div
      className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] bg-paper dark:bg-[#111722]"
      role="status"
      aria-live="polite"
      aria-label="جارٍ تحضير مساحة العمل"
    >
      <div className="flex h-14 items-center justify-between gap-3 border-b border-line px-4 dark:border-white/10">
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-8" rounded="rounded-[8px]" />
          <Skeleton className="h-4 w-28" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-16" rounded="rounded-[8px]" />
          <Skeleton className="h-8 w-16" rounded="rounded-[8px]" />
          <Skeleton className="h-8 w-24" rounded="rounded-[8px]" />
        </div>
      </div>
      <div className="grid min-h-0 grid-cols-[220px_minmax(0,1fr)_260px] gap-3 p-3 max-lg2:grid-cols-[minmax(0,1fr)]">
        <div className="hidden gap-3 max-lg2:hidden lg2:grid lg2:content-start">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-10 w-full" rounded="rounded-[10px]" />
          ))}
          <Skeleton className="h-28 w-full" rounded="rounded-[10px]" />
        </div>
        <div className="grid place-items-center">
          <div className="aspect-[210/297] w-full max-w-[420px] rounded-[4px] border border-line bg-white p-6 shadow-sm dark:border-white/10 dark:bg-white/[0.04]">
            <div className="grid gap-3">
              <Skeleton className="h-6 w-2/3" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-5/6" />
              <Skeleton className="h-24 w-full" rounded="rounded-[6px]" />
              <Skeleton className="h-3 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
        </div>
        <div className="hidden gap-3 lg2:grid lg2:content-start">
          <Skeleton className="h-9 w-full" rounded="rounded-[8px]" />
          <Skeleton className="h-24 w-full" rounded="rounded-[10px]" />
          <Skeleton className="h-24 w-full" rounded="rounded-[10px]" />
        </div>
      </div>
      <p className="pb-3 text-center text-[11px] text-muted">جارٍ تحضير مساحة العمل…</p>
    </div>
  );
}

/** Marketing / dashboard page placeholder used while a route resolves. */
export function PageSkeleton({ label = "جارٍ التحميل…" }: { label?: string }) {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6" role="status" aria-live="polite">
      <Skeleton className="h-7 w-56" />
      <Skeleton className="mt-3 h-4 w-full max-w-xl" />
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-32 w-full" rounded="rounded-[12px]" />
        ))}
      </div>
      <span className="sr-only">{label}</span>
    </div>
  );
}
