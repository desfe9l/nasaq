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

const SECTIONS: SettingsSection[] = [
  "commercial",
  "announcement",
  "texts",
  "brandPresets",
  "images",
];
const MAX_TEMPLATE_BYTES = 4 * 1024 * 1024;
/*
 * Ceiling on a stored preview image.
 *
 * It is a payload budget, not a dimension test: the browser re-encodes an
 * upload to a bounded longest edge before it gets here (see
 * `templates/thumbnail.ts`), so any reasonable SOURCE dimension is accepted
 * and only a genuinely oversized payload — a vector that inlines another
 * document, a pathological PNG — is refused.
 */
const MAX_THUMB_BYTES = 2 * 1024 * 1024;

type VerifiedContext = { userId: string; userEmail: string | null };

/**
 * Authorize a caller for the template catalogue — the platform's PAID content.
 *
 * Templates (and especially their `licensed` tier) are commercial inventory, so
 * they go through `verifyTemplateManager`: a real session, then the owner /
 * super-admin / admin lookup, never the shared dev user. Site-wide settings
 * (texts, announcement, brand presets, images) stay on the ordinary
 * administrator check — they are presentation, not inventory.
 */
async function verifyTemplateManagerContext(
  context: VerifiedContext,
): Promise<{ ok: boolean; error: string }> {
  const { verifyTemplateManager } = await import("./owner-gate.server");
  const result = await verifyTemplateManager(context, sql());
  return result.ok
    ? { ok: true, error: "" }
    : { ok: false, error: result.error };
}

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

const PRODUCT_TEMPLATE_SEED_KEY = "product-template-seeds.v1";
const LEGACY_TEMPLATE_SEED_KEY = "legacy-template-seeds.v1";
/** Rewrites bundled documents after a catalog redesign. Deletes and status stay. */
const BUNDLED_ARTWORK_KEY = "bundled-template-artwork.v4";

/** Insert bundled native masters once; subsequent owner edits and deletes persist. */
async function insertTemplateSeedsOnce(
  db: Awaited<ReturnType<typeof sql>>,
  seedKey: string,
  build: () => ReturnType<typeof import("@/lib/editor/product-templates")["buildProductTemplateSeeds"]>,
) {
  const seeded = await db.query(
    `SELECT key FROM site_settings WHERE key = $1 LIMIT 1`,
    [seedKey],
  );
  if (seeded.length) return;

  const templates = build();
  const values: unknown[] = [];
  const rows = templates.map((template) => {
    const fields = [
      template.id,
      template.slug,
      template.title,
      template.description,
      template.category,
      template.tier,
      template.status,
      template.kind,
      template.content,
      template.thumbnail,
      template.sortOrder,
    ];
    const placeholders = fields.map((_, index) => `$${values.length + index + 1}`);
    values.push(...fields);
    return `(${placeholders.join(", ")})`;
  });

  await db.query(
    `INSERT INTO admin_templates
       (id, slug, title, description, category, tier, status, kind, content, thumbnail, sort_order)
     VALUES ${rows.join(", ")}
     ON CONFLICT DO NOTHING`,
    values,
  );
  await db.query(
    `INSERT INTO site_settings (key, value, updated_at)
     VALUES ($1, $2::jsonb, now())
     ON CONFLICT (key) DO NOTHING`,
    [seedKey, JSON.stringify({ version: 1 })],
  );
}

async function ensureProductTemplates(db: Awaited<ReturnType<typeof sql>>) {
  const { buildProductTemplateSeeds, buildLegacyTemplateSeeds } = await import("@/lib/editor/product-templates");
  await insertTemplateSeedsOnce(db, PRODUCT_TEMPLATE_SEED_KEY, buildProductTemplateSeeds);
  await insertTemplateSeedsOnce(db, LEGACY_TEMPLATE_SEED_KEY, buildLegacyTemplateSeeds);
  await refreshBundledTemplateArtwork(db, () => [
    ...buildProductTemplateSeeds(),
    ...buildLegacyTemplateSeeds(),
  ]);
}

/**
 * Public cards and «استخدام القالب» read `admin_templates`, which is filled once.
 * A generator change never reaches that table until this refresh rewrites the
 * bundled rows. Missing rows stay missing, and status/tier are left alone.
 */
async function refreshBundledTemplateArtwork(
  db: Awaited<ReturnType<typeof sql>>,
  build: () => ReturnType<typeof import("@/lib/editor/product-templates")["buildProductTemplateSeeds"]>,
) {
  const seeded = await db.query(
    `SELECT key FROM site_settings WHERE key = $1 LIMIT 1`,
    [BUNDLED_ARTWORK_KEY],
  );
  if (seeded.length) return;

  const templates = build();
  for (let i = 0; i < templates.length; i += 8) {
    const payload = templates.slice(i, i + 8).map((template) => ({
      id: template.id,
      title: template.title,
      description: template.description,
      content: template.content,
      thumbnail: template.thumbnail,
    }));
    await db.query(
      `UPDATE admin_templates AS t
       SET title = v.title,
           description = v.description,
           content = v.content,
           thumbnail = v.thumbnail,
           updated_at = now()
       FROM jsonb_to_recordset($1::jsonb) AS v(
         id text,
         title text,
         description text,
         content text,
         thumbnail text
       )
       WHERE t.id = v.id`,
      [JSON.stringify(payload)],
    );
  }
  await db.query(
    `INSERT INTO site_settings (key, value, updated_at)
     VALUES ($1, $2::jsonb, now())
     ON CONFLICT (key) DO NOTHING`,
    [BUNDLED_ARTWORK_KEY, JSON.stringify({ version: 4, count: templates.length })],
  );
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

/** Remove a homepage reference when its catalog record stops being public. */
async function clearFeaturedTemplateReference(
  db: Awaited<ReturnType<typeof sql>>,
  id: string,
) {
  const rows = await db.query<{ value: unknown }>(
    `SELECT value FROM site_settings WHERE key = 'texts' LIMIT 1`,
  );
  // Defaults already select a real Admin record. Persist an explicit empty
  // selection when that default is withdrawn; otherwise republishing it later
  // would unexpectedly restore a feature the Admin had removed.
  const texts = rows.length
    ? normalizeSection("texts", parseJson(rows[0].value))
    : DEFAULT_SITE_SETTINGS.texts;
  if (texts.featuredTemplateId !== id) return;
  await db.query(
    `INSERT INTO site_settings (key, value, updated_at)
     VALUES ('texts', $1::jsonb, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [JSON.stringify({ ...texts, featuredTemplateId: "" })],
  );
}

function rowToSummary(row: Record<string, unknown>): AdminTemplateSummary {
  return {
    id: String(row.id),
    slug: (row.slug as string) ?? null,
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

function slugifyTitle(title: string): string {
  const raw = String(title || "").trim();
  if (!raw) return "";
  let s = raw.toLowerCase();
  s = s.replace(/[^0-9a-z\u0600-\u06FF]+/g, "-");
  s = s.replace(/-+/g, "-");
  s = s.replace(/^-+|-+$/g, "");
  if (s.length > 80) s = s.slice(0, 80).replace(/-+$/g, "");
  return s;
}

function sanitizeSlug(input: string): string {
  let s = String(input || "").trim().toLowerCase();
  s = s.replace(/[^0-9a-z\u0600-\u06FF-]+/g, "-");
  s = s.replace(/-+/g, "-");
  s = s.replace(/^-+|-+$/g, "");
  if (s.length > 80) s = s.slice(0, 80).replace(/-+$/g, "");
  if (!s) return "";
  if (/^\d+$/.test(s)) return `tpl-${s}`;
  const reserved = new Set(["new", "edit", "admin", "api", "auth", "login", "templates"]);
  if (reserved.has(s)) return `${s}-tpl`;
  return s;
}

async function ensureUniqueSlug(
  db: Awaited<ReturnType<typeof sql>>,
  base: string,
  excludeId?: string,
): Promise<string> {
  let slug = base;
  if (!slug) {
    const { randomUUID } = await import("node:crypto");
    slug = `tpl-${randomUUID().slice(0, 8)}`;
  }
  for (let attempt = 0; attempt < 20; attempt++) {
    const candidate = attempt === 0 ? slug : `${slug}-${attempt + 1}`;
    const rows = await db.query<{ id: string }>(
      `SELECT id FROM admin_templates WHERE slug = $1 LIMIT 1`,
      [candidate],
    );
    if (!rows.length) return candidate;
    if (excludeId && rows[0].id === excludeId) return candidate;
  }
  const { randomUUID } = await import("node:crypto");
  return `${slug}-${randomUUID().slice(0, 6)}`;
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

/**
 * Access probe for «إدارة القوالب» (paid-template management).
 *
 * Called by the `/admin-dashboard` route guard BEFORE the panel mounts, which
 * is what makes a direct URL safe: a visitor who types the address is sent to
 * sign-in by the router, not by a component that briefly rendered anyway. The
 * server re-checks the same thing on every template call below, so this probe
 * is convenience (a correct redirect), never the security boundary.
 */
export const adminTemplatesAccessFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const result = await verifyTemplateManagerContext(context);
    if (result.ok) return { ok: true as const };
    return {
      ok: false as const,
      reason: result.error.includes("تسجيل") ? ("signin" as const) : ("forbidden" as const),
      error: result.error,
    };
  });

/**
 * Licence-administration probe for the owner.
 */
export const adminLicenseAccessFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const [db, { superAdminDiagnostics, isConfiguredSuperAdminIdentity }] = await Promise.all([
      sql(),
      import("@/lib/auth/super-admin.server"),
    ]);
    const identity = { id: context.userId, email: context.userEmail };
    const diagnostics = await superAdminDiagnostics(db, identity);
    return {
      ...diagnostics,
      canBootstrap: isConfiguredSuperAdminIdentity(identity),
    };
  });

/**
 * Owner self-heal: promote the configured owner to SUPER_ADMIN.
 */
export const adminBootstrapOwnerFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const [db, { ensureOwnerSuperAdmin, superAdminDiagnostics }] = await Promise.all([
      sql(),
      import("@/lib/auth/super-admin.server"),
    ]);
    const identity = { id: context.userId, email: context.userEmail };
    const result = await ensureOwnerSuperAdmin(db, identity);
    const diagnostics = await superAdminDiagnostics(db, identity);
    return { ...result, ...diagnostics };
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
    if (data.section === "texts") {
      const featuredId = (value as PublicSiteSettings["texts"]).featuredTemplateId;
      if (featuredId) {
        await ensureProductTemplates(db);
        const records = await db.query<{ id: string }>(
          `SELECT id FROM admin_templates
           WHERE id = $1 AND status = 'published' AND tier = 'free' LIMIT 1`,
          [featuredId],
        );
        if (!records.length) {
          return {
            ok: false as const,
            error: "اختر سجلًا منشورًا مجانيًا من كتالوج القوالب أو أزل التحديد",
          };
        }
      }
    }
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
    await ensureProductTemplates(db);
    const rows = await db.query(
      `SELECT id, slug, title, description, category, tier, status, kind, thumbnail, sort_order, created_at, updated_at
       FROM admin_templates WHERE status = 'published' ORDER BY sort_order ASC, updated_at DESC LIMIT 500`,
    );
    return rows.map(rowToSummary);
  } catch {
    return [];
  }
});

/** Public IDs/statuses only: keeps the code-bundled catalog in sync with Admin visibility. */
export const listBuiltinTemplateStatesFn = createServerFn({ method: "GET" })
  .handler(async (): Promise<{ id: string; status: TemplateStatus }[]> => {
    try {
      const db = await sql();
      await ensureProductTemplates(db);
      const rows = await db.query<{ id: string; status: string }>(
        `SELECT id, status FROM admin_templates
         WHERE id LIKE 'builtin_pack_%' OR id LIKE 'builtin_page_%'`,
      );
      return rows.map((row) => ({
        id: String(row.id),
        status: row.status as TemplateStatus,
      }));
    } catch {
      return [];
    }
  });

/** Public metadata for a single published template by slug or id. No license check - preview is public. */
export const getPublishedTemplateMetaFn = createServerFn({ method: "GET" })
  .validator((data: { idOrSlug: string }) => data)
  .handler(async ({ data }): Promise<{ ok: boolean; template?: AdminTemplateSummary; error?: string }> => {
    try {
      const db = await sql();
      await ensureProductTemplates(db);
      const key = String(data.idOrSlug || "").trim().slice(0, 200);
      if (!key) return { ok: false, error: "معرّف غير صالح" };
      const rows = await db.query(
        `SELECT id, slug, title, description, category, tier, status, kind, thumbnail, sort_order, created_at, updated_at
         FROM admin_templates WHERE (slug = $1 OR id = $1) AND status = 'published' LIMIT 1`,
        [key],
      );
      if (!rows.length) return { ok: false, error: "القالب غير موجود" };
      return { ok: true, template: rowToSummary(rows[0]) };
    } catch {
      return { ok: false, error: "تعذر تحميل القالب" };
    }
  });

/**
 * Public payload fetch for a published template. Licensed templates require a
 * licence key whose server-side entitlements include premium templates.
 * Supports lookup by slug OR id for stable share links.
 */
export const getPublishedTemplateFn = createServerFn({ method: "POST" })
  .middleware([optionalAuthMiddleware])
  .validator((data: { id: string }) => data)
  .handler(async ({ data, context }) => {
    const db = await sql();
    await ensureProductTemplates(db);
    const key = String(data.id || "").trim().slice(0, 200);
    if (!key) return { ok: false as const, error: "معرّف غير صالح" };
    const rows = await db.query(`SELECT * FROM admin_templates WHERE (slug = $1 OR id = $1) AND status = 'published' LIMIT 1`, [key]);
    if (!rows.length) return { ok: false as const, error: "القالب غير موجود" };
    const row = rows[0];
    if (row.tier === "licensed") {
      let allowed = false;
      if (context.userId) {
        const { getAuthorizationContext } = await import("@/lib/auth/authorization.server");
        const access = await getAuthorizationContext({ id: context.userId, email: context.userEmail });
        allowed = access.isAdmin || access.entitlements.premium_templates === true;
      }
      if (!allowed) return { ok: false as const, error: "هذا القالب متاح في النسخة الكاملة", locked: true };
    }
    const content = String(row.content);
    const publicContent = row.kind === "json"
      ? JSON.stringify({ pages: (parseJson(content) as { pages?: unknown } | null)?.pages })
      : content;
    return { ok: true as const, template: { ...rowToSummary(row), content: publicContent } as AdminTemplate };
  });

export const adminListTemplatesFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const gate = await verifyTemplateManagerContext(context);
    if (!gate.ok) return { ok: false as const, error: gate.error, templates: [] };
    const db = await sql();
    await ensureProductTemplates(db);
    const rows = await db.query(
      `SELECT id, slug, title, description, category, tier, status, kind, thumbnail, sort_order, created_at, updated_at
       FROM admin_templates ORDER BY sort_order ASC, updated_at DESC LIMIT 500`,
    );
    return { ok: true as const, templates: rows.map(rowToSummary) };
  });

/** Read a complete template payload for the authorized Admin Dashboard editor. */
export const adminGetTemplateFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { id: string }) => data)
  .handler(async ({ data, context }) => {
    const gate = await verifyTemplateManagerContext(context);
    if (!gate.ok) return { ok: false as const, error: gate.error };
    const id = String(data.id || "").trim().slice(0, 120);
    if (!id) return { ok: false as const, error: "معرّف القالب غير صالح" };
    const db = await sql();
    await ensureProductTemplates(db);
    const rows = await db.query(`SELECT * FROM admin_templates WHERE id = $1 LIMIT 1`, [id]);
    if (!rows.length) return { ok: false as const, error: "القالب غير موجود" };
    return {
      ok: true as const,
      template: { ...rowToSummary(rows[0]), content: String(rows[0].content) } as AdminTemplate,
    };
  });

export const adminUpsertTemplateFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { template: AdminTemplateInput }) => data)
  .handler(async ({ data, context }) => {
    const gate = await verifyTemplateManagerContext(context);
    if (!gate.ok) return { ok: false as const, error: gate.error };
    const t = data.template;
    const kind: TemplateKind = t.kind === "svg" ? "svg" : "json";
    const tier: TemplateTier = t.tier === "licensed" ? "licensed" : "free";
    const status: TemplateStatus = t.status === "published" || t.status === "archived" ? t.status : "draft";
    const title = String(t.title ?? "").trim().slice(0, 120);
    if (!title) return { ok: false as const, error: "العنوان مطلوب" };
    const db = await sql();
    const existing = t.id
      ? await db.query<{ content: string; kind: string; slug: string | null; thumbnail: string | null }>(
          `SELECT content, kind, slug, thumbnail FROM admin_templates WHERE id = $1`,
          [t.id],
        )
      : [];
    const replacingContent = Boolean(t.content);
    const content = replacingContent ? String(t.content) : existing[0]?.content ?? "";
    /* Only NEW content is validated. An EDIT that leaves the payload alone
     * keeps whatever is stored: re-validating a template that was accepted
     * before a rule changed (or that arrived from an older export) would make
     * the owner unable to rename or re-tier their own published work — the
     * licensed catalogue especially, which is exactly what must stay editable. */
    const contentError = replacingContent ? validateContent(kind, content) : content ? null : "المحتوى فارغ";
    if (contentError) return { ok: false as const, error: contentError };
    /*
     * PREVIEW IMAGE — keep, replace or clear; never silently drop.
     *
     * The old code ran `validThumbnail(t.thumbnail)` and stored the result, so
     * editing a template sent back its own (already stored) data URL, failed
     * the byte ceiling, and wiped the preview: opening a licensed template to
     * fix its title left it with no image. The three cases are now distinct —
     * an explicit `null` clears it, a valid upload replaces it, and anything
     * else (absent, or a payload the browser could not re-encode) keeps the
     * stored image untouched.
     */
    let thumbnail: string | null;
    if (t.thumbnail === null) thumbnail = null;
    else if (validThumbnail(t.thumbnail)) thumbnail = t.thumbnail!;
    else thumbnail = existing[0]?.thumbnail ?? null;
    const { randomUUID } = await import("node:crypto");
    const id = existing.length ? String(t.id) : `tpl_${randomUUID()}`;
    // Slug handling: keep existing if present, else generate from title or explicit input
    let slug: string | null = null;
    if (existing.length) {
      const existingSlug = existing[0]?.slug || null;
      if (t.slug !== undefined) {
        const cleaned = t.slug ? sanitizeSlug(String(t.slug)) : null;
        if (cleaned) {
          slug = await ensureUniqueSlug(db, cleaned, id);
        } else if (existingSlug) {
          slug = existingSlug;
        } else {
          slug = await ensureUniqueSlug(db, slugifyTitle(title) || id, id);
        }
      } else {
        // No slug input: keep existing or generate if missing
        if (existingSlug) slug = existingSlug;
        else slug = await ensureUniqueSlug(db, slugifyTitle(title) || id, id);
      }
    } else {
      const baseInput = t.slug ? sanitizeSlug(String(t.slug)) : slugifyTitle(title);
      slug = await ensureUniqueSlug(db, baseInput || id);
    }

    await db.query(
      `INSERT INTO admin_templates (id, slug, title, description, category, tier, status, kind, content, thumbnail, sort_order, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now(), now())
       ON CONFLICT (id) DO UPDATE SET slug = EXCLUDED.slug, title = EXCLUDED.title, description = EXCLUDED.description,
         category = EXCLUDED.category, tier = EXCLUDED.tier, status = EXCLUDED.status, kind = EXCLUDED.kind,
         content = EXCLUDED.content, thumbnail = EXCLUDED.thumbnail, sort_order = EXCLUDED.sort_order, updated_at = now()`,
      [
        id,
        slug,
        title,
        String(t.description ?? "").slice(0, 500),
        String(t.category ?? "general").slice(0, 60) || "general",
        tier,
        status,
        kind,
        content,
        thumbnail,
        Number.isFinite(Number(t.sortOrder)) ? Math.trunc(Number(t.sortOrder)) : 0,
      ],
    );
    if (status !== "published" || tier !== "free") {
      await clearFeaturedTemplateReference(db, id);
    }
    return { ok: true as const, id, slug };
  });

export const adminSetTemplateStatusFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { id: string; status?: TemplateStatus; tier?: TemplateTier }) => data)
  .handler(async ({ data, context }) => {
    const gate = await verifyTemplateManagerContext(context);
    if (!gate.ok) return { ok: false as const, error: gate.error };
    const db = await sql();
    if (data.status && ["draft", "published", "archived"].includes(data.status)) {
      await db.query(`UPDATE admin_templates SET status = $2, updated_at = now() WHERE id = $1`, [data.id, data.status]);
    }
    if (data.tier && ["free", "licensed"].includes(data.tier)) {
      await db.query(`UPDATE admin_templates SET tier = $2, updated_at = now() WHERE id = $1`, [data.id, data.tier]);
    }
    const rows = await db.query<{ status: string; tier: string }>(
      `SELECT status, tier FROM admin_templates WHERE id = $1 LIMIT 1`,
      [data.id],
    );
    if (
      rows.length &&
      (rows[0].status !== "published" || rows[0].tier !== "free")
    ) {
      await clearFeaturedTemplateReference(db, data.id);
    }
    return { ok: true as const };
  });

export const adminDeleteTemplateFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { id: string }) => data)
  .handler(async ({ data, context }) => {
    const gate = await verifyTemplateManagerContext(context);
    if (!gate.ok) return { ok: false as const, error: gate.error };
    const db = await sql();
    await db.query(`DELETE FROM admin_templates WHERE id = $1`, [data.id]);
    await clearFeaturedTemplateReference(db, data.id);
    return { ok: true as const };
  });

export const adminRegenerateSlugFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { id: string; slug?: string }) => data)
  .handler(async ({ data, context }) => {
    const gate = await verifyTemplateManagerContext(context);
    if (!gate.ok) return { ok: false as const, error: gate.error };
    const db = await sql();
    const rows = await db.query<{ title: string }>(`SELECT title FROM admin_templates WHERE id = $1 LIMIT 1`, [data.id]);
    if (!rows.length) return { ok: false as const, error: "القالب غير موجود" };
    const base = data.slug ? sanitizeSlug(data.slug) : slugifyTitle(rows[0].title);
    if (!base) return { ok: false as const, error: "تعذر توليد الرابط" };
    const slug = await ensureUniqueSlug(db, base, data.id);
    await db.query(`UPDATE admin_templates SET slug = $2, updated_at = now() WHERE id = $1`, [data.id, slug]);
    return { ok: true as const, slug };
  });
