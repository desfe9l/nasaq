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

import { clone, type CanvasEl, type Project } from "@/lib/editor/model";

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
  return blob.arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer);
    const mime = blob.type || "application/octet-stream";
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return `data:${mime};base64,${btoa(binary)}`;
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

type AssetNode = {
  src?: string;
  style?: { bgImage?: string };
  children?: AssetNode[];
};

async function inlineRemoteUrl(
  src: string,
  memo: Map<string, string>,
): Promise<{ src: string; cached: boolean; failed: boolean }> {
  if (!src || src.startsWith("data:") || src.startsWith("blob:")) {
    return { src, cached: false, failed: false };
  }
  if (!/^https?:\/\//i.test(src)) return { src, cached: false, failed: false };
  const hit = memo.get(src);
  if (hit) return { src: hit, cached: true, failed: false };
  try {
    if (typeof fetch === "undefined") return { src, cached: false, failed: true };
    const res = await fetch(src, { cache: "force-cache" });
    if (!res.ok) return { src, cached: false, failed: true };
    const blob = await res.blob();
    const dataUrl = await blobToDataUrl(blob);
    memo.set(src, dataUrl);
    try {
      const { saveAsset, listAssets } = await import("@/lib/editor/storage");
      const existing = await listAssets();
      if (!existing.some((asset) => asset.src === dataUrl)) {
        await saveAsset({ name: `offline-${Date.now()}`, src: dataUrl, w: 800, h: 600 });
      }
    } catch {
      /* The data URL inside the project is the offline copy. The library row is extra. */
    }
    return { src: dataUrl, cached: true, failed: false };
  } catch {
    return { src, cached: false, failed: true };
  }
}

async function inlineNode(
  node: AssetNode,
  memo: Map<string, string>,
  tally: { cached: number; failed: number },
): Promise<void> {
  if (typeof node.src === "string" && node.src) {
    const next = await inlineRemoteUrl(node.src, memo);
    if (next.cached) tally.cached += 1;
    if (next.failed) tally.failed += 1;
    node.src = next.src;
  }
  const bg = node.style?.bgImage;
  if (typeof bg === "string" && bg) {
    const next = await inlineRemoteUrl(bg, memo);
    if (next.cached) tally.cached += 1;
    if (next.failed) tally.failed += 1;
    if (node.style) node.style.bgImage = next.src;
  }
  for (const child of node.children ?? []) {
    await inlineNode(child, memo, tally);
  }
}

/**
 * Copy every remote image the project paints into the document itself
 * (data URLs) and the local asset library. Pages that already embed data
 * URLs are left untouched. A failed fetch is counted — the caller must not
 * mark the project offline-ready while a required asset is still remote.
 */
export async function materializeProjectForOffline(
  project: Project,
): Promise<{ project: Project; cached: number; failed: number }> {
  const next = clone(project);
  const memo = new Map<string, string>();
  const tally = { cached: 0, failed: 0 };
  for (const page of next.pages ?? []) {
    if (typeof page.bgImage === "string" && page.bgImage) {
      const inlined = await inlineRemoteUrl(page.bgImage, memo);
      if (inlined.cached) tally.cached += 1;
      if (inlined.failed) tally.failed += 1;
      page.bgImage = inlined.src;
    }
    for (const el of page.elements ?? []) {
      await inlineNode(el as CanvasEl & AssetNode, memo, tally);
    }
  }
  return { project: next, cached: tally.cached, failed: tally.failed };
}
