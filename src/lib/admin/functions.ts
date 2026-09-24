/**
 * NASAQ admin — server functions for /admin.
 *
 * Security model:
 *   • Every privileged call requires the verified Better Auth session.
 *   • Owner access is resolved server-side from NASAQ_OWNER_ID or
 *     NASAQ_OWNER_EMAIL; neither value is sent to the browser.
 *
 * Persistence uses the project's shared SQL client (`getSql`: Neon in
 * production, PGLite in preview) and the tables in migrations/0002.
 */

import { createServerFn } from "@tanstack/react-start";
import { authMiddleware, optionalAuthMiddleware } from "@/lib/auth/middleware";
import {
  DEFAULT_SITE_SETTINGS,
  normalizeSection,
  type AdminTemplate,
  type AdminTemplateInput,
  type AdminTemplateSummary,
  type PublicSiteSettings,
  type SettingsSection,
  type TemplateKind,
  type TemplateStatus,
  type TemplateTier,
} from "./types";

const SECTIONS: SettingsSection[] = ["commercial", "announcement", "texts", "brandPresets"];
const MAX_TEMPLATE_BYTES = 4 * 1024 * 1024;
const MAX_THUMB_BYTES = 600 * 1024;

type VerifiedContext = { userId: string; userEmail: string | null };

async function verifyAdmin(context: VerifiedContext): Promise<boolean> {
  const [{ getSql }, { isAdminIdentity }] = await Promise.all([
    import("@/lib/db"),
    import("@/lib/auth/admin-identity.server"),
  ]);
  return isAdminIdentity(await getSql(), {
    id: context.userId,
    email: context.userEmail,
  });
}

async function sql() {
  const { getSql } = await import("@/lib/db");
  return getSql();
}

function parseJson(value: unknown): unknown {
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return value;
}

async function readSettings(): Promise<PublicSiteSettings> {
  const db = await sql();
  const rows = await db.query<{ key: string; value: unknown }>(
    `SELECT key, value FROM site_settings WHERE key = ANY($1)`,
    [SECTIONS],
  );
  const out: PublicSiteSettings = structuredClone(DEFAULT_SITE_SETTINGS);
  for (const row of rows) {
    const key = row.key as SettingsSection;
    if (!SECTIONS.includes(key)) continue;
    (out as unknown as Record<string, unknown>)[key] = normalizeSection(key, parseJson(row.value));
  }
  return out;
}

function rowToSummary(row: Record<string, unknown>): AdminTemplateSummary {
  return {
    id: String(row.id),
    title: String(row.title),
    description: String(row.description ?? ""),
    category: String(row.category ?? "general"),
    tier: String(row.tier) as TemplateTier,
    status: String(row.status) as TemplateStatus,
    kind: String(row.kind) as TemplateKind,
    thumbnail: (row.thumbnail as string) ?? null,
    sortOrder: Number(row.sort_order ?? 0),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function validThumbnail(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  if (!/^data:image\/(png|jpe?g|webp|svg\+xml);base64,/i.test(value)) return null;
  return value.length <= MAX_THUMB_BYTES ? value : null;
}

/** Server-side content validation: JSON must be a project with pages; SVG must be an <svg> root without scripts. */
function validateContent(kind: TemplateKind, content: string): string | null {
  if (typeof content !== "string" || !content.trim()) return "المحتوى فارغ";
  if (content.length > MAX_TEMPLATE_BYTES) return "حجم الملف يتجاوز 4 ميغابايت";
  if (kind === "json") {
    const parsed = parseJson(content) as { pages?: unknown } | null;
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.pages) || parsed.pages.length === 0) {
      return "ملف JSON لا يحتوي على صفحات مشروع نَسَق صالحة";
    }
    return null;
  }
  if (!/^\s*(<\?xml[\s\S]*?\?>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(content)) return "ملف SVG غير صالح";
  if (/<script|\son\w+\s*=|javascript:/i.test(content)) return "ملف SVG يحتوي على شيفرة غير مسموحة";
  return null;
}

// ── Auth probe ─────────────────────────────────────────────────────────────

export const adminVerifyFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const [{ adminIdentityConfigPresent }] = await Promise.all([
      import("@/lib/auth/admin-identity.server"),
    ]);
    const ok = await verifyAdmin(context);
    return { ok, configured: ok || adminIdentityConfigPresent() };
  });

// ── Site settings ──────────────────────────────────────────────────────────

/** Public read — commercial links, announcement, texts, Brand Kit presets. */
export const getSiteSettingsFn = createServerFn({ method: "GET" }).handler(async (): Promise<PublicSiteSettings> => {
  try {
    return await readSettings();
  } catch {
    return DEFAULT_SITE_SETTINGS;
  }
});

export const adminSaveSettingsFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { section: SettingsSection; value: unknown }) => data)
  .handler(async ({ data, context }) => {
    if (!(await verifyAdmin(context))) return { ok: false as const, error: "غير مصرح" };
    if (!SECTIONS.includes(data.section)) return { ok: false as const, error: "قسم غير معروف" };
    const value = normalizeSection(data.section, data.value);
    const db = await sql();
    await db.query(
      `INSERT INTO site_settings (key, value, updated_at) VALUES ($1, $2::jsonb, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [data.section, JSON.stringify(value)],
    );
    return { ok: true as const, value };
  });

// ── Templates ──────────────────────────────────────────────────────────────

/** Public list: published templates only, without payloads. */
export const listPublishedTemplatesFn = createServerFn({ method: "GET" }).handler(async (): Promise<AdminTemplateSummary[]> => {
  try {
    const db = await sql();
    const rows = await db.query(
      `SELECT id, title, description, category, tier, status, kind, thumbnail, sort_order, created_at, updated_at
       FROM admin_templates WHERE status = 'published' ORDER BY sort_order ASC, updated_at DESC LIMIT 200`,
    );
    return rows.map(rowToSummary);
  } catch {
    return [];
  }
});

/**
 * Public payload fetch for a published template. Licensed templates require a
 * licence key whose server-side entitlements include premium templates.
 */
export const getPublishedTemplateFn = createServerFn({ method: "POST" })
  .middleware([optionalAuthMiddleware])
  .validator((data: { id: string; licenseKey?: string }) => data)
  .handler(async ({ data, context }) => {
    const db = await sql();
    const rows = await db.query(`SELECT * FROM admin_templates WHERE id = $1 AND status = 'published' LIMIT 1`, [String(data.id)]);
    if (!rows.length) return { ok: false as const, error: "القالب غير موجود" };
    const row = rows[0];
    if (row.tier === "licensed") {
      const key = String(data.licenseKey ?? "").trim();
      let allowed = false;
      if (context.userId) {
        const { getAuthorizationContext } = await import("@/lib/auth/authorization.server");
        const access = await getAuthorizationContext({
          id: context.userId,
          email: context.userEmail,
        });
        allowed = access.isAdmin || access.entitlements.premium_templates === true;
      }
      if (key) {
        const { hashLicenseKey } = await import("@/lib/license/key");
        const { validateLicense } = await import("@/lib/license/server");
        const { entitlementsForPlan } = await import("@/lib/license/types");
        const result = await validateLicense(hashLicenseKey(key));
        if (result.valid && result.license) {
          const ent = entitlementsForPlan(
            result.license.metadata?.plan as import("@/lib/license/types").LicensePlan | undefined,
            result.license.type,
          );
          allowed = ent.premium_templates === true;
        }
      }
      if (!allowed) return { ok: false as const, error: "هذا القالب متاح في النسخة الكاملة", locked: true };
    }
    return { ok: true as const, template: { ...rowToSummary(row), content: String(row.content) } as AdminTemplate };
  });

export const adminListTemplatesFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    if (!(await verifyAdmin(context))) return { ok: false as const, error: "غير مصرح", templates: [] };
    const db = await sql();
    const rows = await db.query(
      `SELECT id, title, description, category, tier, status, kind, thumbnail, sort_order, created_at, updated_at
       FROM admin_templates ORDER BY sort_order ASC, updated_at DESC LIMIT 500`,
    );
    return { ok: true as const, templates: rows.map(rowToSummary) };
  });

export const adminUpsertTemplateFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { template: AdminTemplateInput }) => data)
  .handler(async ({ data, context }) => {
    if (!(await verifyAdmin(context))) return { ok: false as const, error: "غير مصرح" };
    const t = data.template;
    const kind: TemplateKind = t.kind === "svg" ? "svg" : "json";
    const tier: TemplateTier = t.tier === "licensed" ? "licensed" : "free";
    const status: TemplateStatus = t.status === "published" || t.status === "archived" ? t.status : "draft";
    const title = String(t.title ?? "").trim().slice(0, 120);
    if (!title) return { ok: false as const, error: "العنوان مطلوب" };
    const db = await sql();
    const existing = t.id
      ? await db.query<{ content: string; kind: string }>(`SELECT content, kind FROM admin_templates WHERE id = $1`, [t.id])
      : [];
    // Editing metadata only keeps the stored payload.
    const content = t.content ? String(t.content) : existing[0]?.content ?? "";
    const contentError = validateContent(kind, content);
    if (contentError) return { ok: false as const, error: contentError };
    const { randomUUID } = await import("node:crypto");
    const id = existing.length ? String(t.id) : `tpl_${randomUUID()}`;
    await db.query(
      `INSERT INTO admin_templates (id, title, description, category, tier, status, kind, content, thumbnail, sort_order, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now(), now())
       ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, description = EXCLUDED.description,
         category = EXCLUDED.category, tier = EXCLUDED.tier, status = EXCLUDED.status, kind = EXCLUDED.kind,
         content = EXCLUDED.content, thumbnail = EXCLUDED.thumbnail, sort_order = EXCLUDED.sort_order, updated_at = now()`,
      [
        id,
        title,
        String(t.description ?? "").slice(0, 500),
        String(t.category ?? "general").slice(0, 60) || "general",
        tier,
        status,
        kind,
        content,
        validThumbnail(t.thumbnail),
        Number.isFinite(Number(t.sortOrder)) ? Math.trunc(Number(t.sortOrder)) : 0,
      ],
    );
    return { ok: true as const, id };
  });

export const adminSetTemplateStatusFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { id: string; status?: TemplateStatus; tier?: TemplateTier }) => data)
  .handler(async ({ data, context }) => {
    if (!(await verifyAdmin(context))) return { ok: false as const, error: "غير مصرح" };
    const db = await sql();
    if (data.status && ["draft", "published", "archived"].includes(data.status)) {
      await db.query(`UPDATE admin_templates SET status = $2, updated_at = now() WHERE id = $1`, [data.id, data.status]);
    }
    if (data.tier && ["free", "licensed"].includes(data.tier)) {
      await db.query(`UPDATE admin_templates SET tier = $2, updated_at = now() WHERE id = $1`, [data.id, data.tier]);
    }
    return { ok: true as const };
  });

export const adminDeleteTemplateFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { id: string }) => data)
  .handler(async ({ data, context }) => {
    if (!(await verifyAdmin(context))) return { ok: false as const, error: "غير مصرح" };
    const db = await sql();
    await db.query(`DELETE FROM admin_templates WHERE id = $1`, [data.id]);
    return { ok: true as const };
  });
