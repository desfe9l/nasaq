/**
 * Assets — cache required images, fonts and other project assets locally.
 *
 * Project images are already data URLs inside the project JSON (durable in IDB),
 * so they are offline-available once the project has been opened/saved.
 * Fonts and remote object-storage assets are cached via the service worker
 * (static assets) and via IndexedDB asset store (remote downloads).
 *
 * This module ensures a project's required assets are fully pulled into the
 * local asset store so an offline open has everything it needs.
 */

import { getStorageOwner } from "@/lib/editor/storage-owner";
import type { Project } from "@/lib/editor/model";

function collectImageSrcs(project: Project): string[] {
  const srcs: string[] = [];
  for (const page of project.pages ?? []) {
    for (const el of page.elements ?? []) {
      const s = (el as unknown as Record<string, unknown>).src as string | undefined;
      if (typeof s === "string" && s) srcs.push(s);
      const bg = (el as unknown as { style?: { bgImage?: string } })?.style?.bgImage;
      if (typeof bg === "string" && bg.startsWith("data:")) srcs.push(bg);
      if (Array.isArray((el as { children?: unknown[] }).children)) {
        // recurse children
        for (const c of (el as { children: { src?: string; style?: { bgImage?: string } }[] }).children) {
          if (typeof c.src === "string" && c.src) srcs.push(c.src);
        }
      }
    }
    const bgImage = (page as unknown as Record<string, unknown>).bgImage as string | undefined;
    if (typeof bgImage === "string" && bgImage.startsWith("data:")) srcs.push(bgImage);
  }
  return [...new Set(srcs)];
}

/**
 * Pre-cache assets referenced by a project: ensure any https:// asset that is
 * not yet a data URL is fetched and mirrored locally (best-effort). Data URLs
 * are already inside the project and need no extra fetch.
 */
export async function cacheProjectAssets(project: Project): Promise<{ cached: number; skipped: number }> {
  const srcs = collectImageSrcs(project);
  let cached = 0;
  let skipped = 0;
  // Data URLs are already cached (inside project)
  for (const src of srcs) {
    if (src.startsWith("data:")) { skipped += 1; continue; }
    if (src.startsWith("blob:")) { skipped += 1; continue; }
    // For https assets, try to fetch and store as local asset if signed in
    try {
      if (typeof fetch === "undefined") { skipped += 1; continue; }
      const res = await fetch(src, { cache: "force-cache" }).catch(() => null);
      if (!res?.ok) { skipped += 1; continue; }
      const blob = await res.blob().catch(() => null);
      if (!blob) { skipped += 1; continue; }
      // Convert to data URL and save as asset for offline
      const dataUrl = await blobToDataUrl(blob);
      const { saveAsset } = await import("@/lib/editor/storage");
      // Deduplicate by src: don't save twice
      const { listAssets } = await import("@/lib/editor/storage");
      const existing = await listAssets();
      if (existing.some((a) => a.src === dataUrl)) { cached += 1; continue; }
      await saveAsset({ name: `cached-${Date.now()}`, src: dataUrl, w: 800, h: 600 });
      cached += 1;
    } catch {
      skipped += 1;
    }
  }
  return { cached, skipped };
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject)=>{
    const r = new FileReader();
    r.onload = ()=> resolve(String(r.result));
    r.onerror = ()=> reject(r.error);
    r.readAsDataURL(blob);
  });
}

/**
 * Ensure fonts used by project are cached. Fonts are loaded via Google Fonts
 * or embedded data URLs. Embedded fonts are already in project.embeddedFonts.
 * We trigger the service worker to cache Google Fonts css.
 */
export async function cacheProjectFonts(project: Project): Promise<void> {
  const families = new Set<string>();
  for (const page of project.pages ?? []) {
    for (const el of page.elements ?? []) {
      const ff = (el as { style?: { fontFamily?: string } })?.style?.fontFamily;
      if (ff) families.add(ff);
    }
  }
  for (const f of project.embeddedFonts ?? []) families.add(f.family);
  if (families.size === 0) return;
  // Ask service worker to cache font css if online
  if (typeof navigator !== "undefined" && "serviceWorker" in navigator && navigator.onLine !== false) {
    try {
      // Trigger fetch of font css so SW caches it
      await fetch(document.querySelector<HTMLLinkElement>('link[href*="fonts.googleapis.com"]')?.href ?? "https://fonts.googleapis.com/css2?family=Cairo", { cache: "force-cache", mode: "no-cors" }).catch(()=>null);
    } catch {}
  }
}
