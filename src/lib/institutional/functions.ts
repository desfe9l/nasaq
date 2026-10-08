import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { cached, invalidateCache } from "@/lib/cache/public-cache";
import { publicCacheTtlMs } from "@/lib/policy/limits";
import {
  emptyInstitutionalCatalog,
  normalizeInstitutionalCatalog,
  visibleInstitutionalBackgrounds,
  type InstitutionalBackground,
  type InstitutionalCatalog,
} from "@/lib/editor/institutional-backgrounds";

const KEY = "institutional_backgrounds";

async function sql() {
  const { getSql } = await import("@/lib/db");
  return getSql();
}

async function canManage(context: { userId: string | null; userEmail?: string | null; userEmailVerified?: boolean }): Promise<boolean> {
  const { isAdminIdentity } = await import("@/lib/auth/admin-identity.server");
  return isAdminIdentity(await sql(), { id: context.userId || "", email: context.userEmail ?? null, emailVerified: context.userEmailVerified === true });
}

async function readCatalog(): Promise<InstitutionalCatalog> {
  // The RAW catalog is one small row that changes only through the admin panel,
  // and the editor polls it — cache it at the application level so a poll (or
  // several mounted panels polling) costs one read per TTL window, not one per
  // call. The per-user visibility filter still runs on every request, so a
  // cached raw catalog can never leak an unpublished item to a non-admin.
  return cached(`institutional:${KEY}`, publicCacheTtlMs(), async () => {
    const db = await sql();
    const rows = await db.query<{ value: unknown }>(
      `SELECT value FROM site_settings WHERE key = $1 LIMIT 1`,
      [KEY],
    );
    return rows.length ? normalizeInstitutionalCatalog(rows[0].value) : emptyInstitutionalCatalog();
  });
}

async function writeCatalog(catalog: InstitutionalCatalog): Promise<void> {
  const db = await sql();
  await db.query(
    `INSERT INTO site_settings (key, value, updated_at)
     VALUES ($1, $2::jsonb, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [KEY, JSON.stringify(catalog)],
  );
  // The stored catalog changed: the next read must not serve the previous one.
  invalidateCache(`institutional:${KEY}`);
}

export const listInstitutionalBackgroundsFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    if (!context.userId) {
      return { ok: false as const, error: "يلزم تسجيل الدخول", items: [], canManage: false, updatedAt: 0 };
    }
    const manage = await canManage(context);
    const catalog = await readCatalog();
    return {
      ok: true as const,
      canManage: manage,
      updatedAt: catalog.updatedAt,
      items: visibleInstitutionalBackgrounds(catalog, manage),
    };
  });

type Mutation =
  | { op: "create"; name: string; src: string; w: number; h: number; published?: boolean }
  | { op: "replace"; id: string; src: string; w: number; h: number }
  | { op: "rename"; id: string; name: string }
  | { op: "delete"; id: string }
  | { op: "reorder"; ids: string[] }
  | { op: "publish"; id: string; published: boolean };

export const mutateInstitutionalBackgroundFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: Mutation) => data)
  .handler(async ({ data, context }) => {
    if (!(await canManage(context))) return { ok: false as const, error: "غير مصرح" };
    const catalog = await readCatalog();
    const now = Date.now();
    const items = catalog.items.slice();
    const index = "id" in data ? items.findIndex((item) => item.id === data.id) : -1;
    if (data.op === "create") {
      const draft = normalizeInstitutionalCatalog({
        items: [...items, {
          id: `ibg-${now.toString(36)}`,
          name: data.name,
          src: data.src,
          w: data.w,
          h: data.h,
          sortOrder: items.length,
          published: data.published !== false,
          updatedAt: now,
        }],
      });
      if (draft.items.length !== items.length + 1) return { ok: false as const, error: "الصورة غير مقبولة أو أكبر من الحد." };
      await writeCatalog({ updatedAt: now, items: draft.items });
      return { ok: true as const, items: draft.items };
    }
    if (index < 0 && data.op !== "reorder") return { ok: false as const, error: "الخلفية غير موجودة" };
    if (data.op === "replace") {
      const next = normalizeInstitutionalCatalog({
        items: items.map((item) => item.id === data.id ? { ...item, src: data.src, w: data.w, h: data.h, updatedAt: now } : item),
      });
      if (!next.items.some((item) => item.id === data.id)) return { ok: false as const, error: "تعذر استبدال الصورة" };
      await writeCatalog({ updatedAt: now, items: next.items });
      return { ok: true as const, items: next.items };
    }
    if (data.op === "rename") {
      items[index] = { ...items[index], name: String(data.name || "").trim().slice(0, 80) || items[index].name, updatedAt: now };
    } else if (data.op === "delete") {
      items.splice(index, 1);
    } else if (data.op === "publish") {
      items[index] = { ...items[index], published: Boolean(data.published), updatedAt: now };
    } else if (data.op === "reorder") {
      const byId = new Map(items.map((item) => [item.id, item]));
      const ordered: InstitutionalBackground[] = [];
      for (const id of data.ids) {
        const item = byId.get(id);
        if (item) ordered.push(item);
        byId.delete(id);
      }
      ordered.push(...byId.values());
      ordered.forEach((item, order) => {
        item.sortOrder = order;
      });
      await writeCatalog({ updatedAt: now, items: ordered });
      return { ok: true as const, items: ordered };
    }
    const next = normalizeInstitutionalCatalog({ items });
    await writeCatalog({ updatedAt: now, items: next.items });
    return { ok: true as const, items: next.items };
  });
