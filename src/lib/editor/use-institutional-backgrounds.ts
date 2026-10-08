import { useCallback, useEffect, useSyncExternalStore } from "react";
import { listInstitutionalBackgroundsFn } from "@/lib/institutional/functions";
import { enforcementPlane } from "@/lib/control-plane/snapshot";
import {
  INSTITUTIONAL_CHANGED,
  type InstitutionalBackground,
} from "./institutional-backgrounds";

/**
 * Shared catalog for every panel that shows institutional backgrounds.
 *
 * WHY THIS IS A SINGLETON
 *
 * The hook is mounted by SEVERAL components at once (the editor's asset library
 * AND its page-background panel, plus the admin panel). The naive version gave
 * each mount its own 15-second interval and its own in-flight request, so one
 * editor session produced two or three identical server calls — each hitting
 * the database — every fifteen seconds, forever. That is exactly the
 * duplicate-request storm the application must not create: repeated mounts,
 * hydration and navigation must not multiply traffic.
 *
 * Now: ONE interval, ONE in-flight request, N subscribers. The first mount
 * starts polling and kicks an initial load; the last unmount stops it. A refresh
 * already in flight is shared by every caller that arrives while it runs.
 * (The server side caches the catalog too — `@/lib/institutional/functions` —
 * so a poll is cheap even if two tabs each keep their own singleton.)
 */

type Snapshot = {
  items: InstitutionalBackground[];
  canManage: boolean;
  updatedAt: number;
  error: string | null;
};

const INITIAL: Snapshot = { items: [], canManage: false, updatedAt: 0, error: null };

let snapshot: Snapshot = INITIAL;
const listeners = new Set<() => void>();
let inflight: Promise<void> | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let mountedCount = 0;

const POLL_MS_FALLBACK = 15_000;
let pollMs = POLL_MS_FALLBACK;

function currentPollMs(): number {
  const fromPlane = enforcementPlane().pollingIntervalMs;
  return Number.isFinite(fromPlane) && fromPlane >= 5_000 ? fromPlane : POLL_MS_FALLBACK;
}

function reschedule(ms: number): void {
  if (!Number.isFinite(ms) || ms < 5_000 || ms === pollMs) return;
  pollMs = ms;
  if (timer !== null) {
    clearInterval(timer);
    timer = setInterval(() => void refreshAll(), pollMs);
  }
}

function publish(next: Snapshot): void {
  // Replace, never mutate: useSyncExternalStore compares by reference.
  snapshot = next;
  for (const listener of listeners) listener();
}

async function refreshAll(): Promise<void> {
  // Deduplicate: a refresh already running is shared, not restarted.
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const result = await listInstitutionalBackgroundsFn();
      if (!result.ok) {
        publish({ items: [], canManage: false, updatedAt: 0, error: result.error });
        return;
      }
      publish({
        items: result.items,
        canManage: result.canManage,
        updatedAt: result.updatedAt,
        error: null,
      });
      const hinted = (result as { pollAfterMs?: number }).pollAfterMs;
      reschedule(typeof hinted === "number" ? hinted : currentPollMs());
    } catch {
      publish({ items: [], canManage: false, updatedAt: 0, error: "تعذر قراءة خلفيات مؤسسية" });
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

function startPolling(): void {
  if (timer !== null) return;
  timer = setInterval(() => void refreshAll(), currentPollMs());
}

function stopPolling(): void {
  if (timer === null) return;
  clearInterval(timer);
  timer = null;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): Snapshot {
  return snapshot;
}

function getServerSnapshot(): Snapshot {
  return INITIAL;
}

export function useInstitutionalBackgrounds() {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    mountedCount += 1;
    startPolling();
    // First mount (or a remount) refreshes immediately; concurrent mounts share
    // the single in-flight request above.
    void refreshAll();
    const onChange = () => void refreshAll();
    window.addEventListener(INSTITUTIONAL_CHANGED, onChange);
    return () => {
      window.removeEventListener(INSTITUTIONAL_CHANGED, onChange);
      mountedCount = Math.max(0, mountedCount - 1);
      if (mountedCount === 0) stopPolling();
    };
  }, []);

  const refresh = useCallback(() => refreshAll(), []);

  return {
    items: state.items,
    canManage: state.canManage,
    updatedAt: state.updatedAt,
    error: state.error,
    refresh,
  };
}

export function notifyInstitutionalBackgrounds() {
  window.dispatchEvent(new Event(INSTITUTIONAL_CHANGED));
}

export async function readBackgroundFile(file: File): Promise<{ src: string; w: number; h: number }> {
  if (!/^image\/(png|jpeg|webp|svg\+xml)$/.test(file.type) && !/\.(png|jpe?g|webp|svg)$/i.test(file.name)) {
    throw new Error("المقبول صورة PNG أو JPG أو WEBP أو SVG.");
  }
  const src = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("تعذر قراءة الصورة"));
    reader.readAsDataURL(file);
  });
  if (file.type === "image/svg+xml" || file.name.toLowerCase().endsWith(".svg")) {
    const b64 = btoa(unescape(encodeURIComponent(await file.text())));
    return { src: `data:image/svg+xml;base64,${b64}`, w: 1600, h: 900 };
  }
  const sized = await new Promise<{ src: string; w: number; h: number }>((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const scale = Math.min(1, 1600 / Math.max(image.width, image.height));
      const w = Math.max(1, Math.round(image.width * scale));
      const h = Math.max(1, Math.round(image.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve({ src, w: image.width, h: image.height });
        return;
      }
      ctx.drawImage(image, 0, 0, w, h);
      resolve({ src: canvas.toDataURL("image/jpeg", 0.86), w, h });
    };
    image.onerror = () => reject(new Error("تعذر فتح الصورة"));
    image.src = src;
  });
  return sized;
}
