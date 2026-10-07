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

import { normalizeShortCode } from "@/lib/templates/short-code";
import { backfillShortCodes, ensureShortCode } from "@/lib/templates/short-code.server";
import { createServerFn } from "@tanstack/react-start";
import { svgDangerFindings } from "@/lib/editor/svg-scrub";
import { publicTemplateContent } from "@/lib/templates/document-template";
import { applyTemplateNameToContent, resolveTemplateName } from "@/lib/templates/naming";
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
/*
 * Payload ceilings, measured the way the wire measures them.
 *
 * 4 MB of UTF-16 CHARACTERS used to refuse ordinary work: a report template
 * with three embedded photographs is routinely 6–10 MB of base64, and the
 * author got "حجم الملف يتجاوز 4 ميغابايت" for a document that saved perfectly
 * well in the editor. The ceiling is now a real storage budget in UTF-8 bytes,
 * high enough for embedded artwork and low enough to stay a sanity check.
 */
const MAX_TEMPLATE_BYTES = 24 * 1024 * 1024;
/*
 * Ceiling on a stored preview image.
 *
 * It is a payload budget, not a dimension test: the browser re-encodes an
 * upload to a bounded longest edge before it gets here (see
 * `templates/thumbnail.ts`), so any reasonable SOURCE dimension is accepted
 * and only a genuinely oversized payload — a vector that inlines another
 * document, a pathological PNG — is refused.
 */
const MAX_THUMB_BYTES = 4 * 1024 * 1024;

/** Length in UTF-8 bytes — what actually travels and what Postgres stores. */
function utf8Bytes(value: string): number {
  return typeof TextEncoder === "function"
    ? new TextEncoder().encode(value).length
    : value.length;
}

/** A human-readable size for the error the author sees. */
function mbLabel(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} ميغابايت`;
}

/**
 * One honest answer for every storage failure.
 *
 * A template save that throws used to reach the browser as a rejected promise:
 * the panel kept spinning, the author saw nothing (or a generic "تعثر الحفظ"),
 * and the real reason — a missing `DATABASE_URL`, a refused connection, a
 * constraint — stayed in a server log nobody was reading. Every privileged
 * write now returns its own failure with the reason, so the UI can show it and
 * the owner can act on it. Nothing here invents success.
 */
function storageFailure(action: string, err: unknown): { ok: false; error: string } {
  const raw = err instanceof Error ? err.message : String(err ?? "خطأ غير معروف");
  const safe = raw
    .replace(/(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/\S+/gi, "<اتصال قاعدة البيانات>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 400);
  console.error(`[admin] ${action} failed:`, err);
  return { ok: false as const, error: `تعذّر ${action}: ${safe}` };
}

type VerifiedContext = {
  userId: string;
  userEmail: string | null;
  userEmailVerified: boolean;
};

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
    emailVerified: context.userEmailVerified,
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
  /*
   * Every catalogue row also owns a short public address (`/t/<code>`), so a
   * template seeded before codes existed still gets one the first time the
   * catalogue is read. Idempotent: afterwards nothing matches the `IS NULL`.
   */
  await backfillShortCodes(db, "admin_templates");
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
       WHERE t.id = v.id
         -- An owner edit always outranks the generated artwork: this refresh
         -- exists to ship a catalog redesign, never to roll back a save.
         AND t.owner_edited = false`,
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
    shortCode: normalizeShortCode(row.short_code),
    previews: validPreviews(row.previews) ?? [],
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

function publicJsonContent(content: string): string {
  const parsed = parseJson(content) as { format?: string; pages?: unknown } | null;
  if (parsed?.format === "nasaq.template") {
    const safe = publicTemplateContent(content);
    if (safe) return safe;
  }
  return JSON.stringify({ pages: parsed?.pages });
}
/*
 * Only a BASE64 data URL is accepted, in the image types the panels produce.
 *
 * Every preview path (the admin file picker, the editor's own page capture)
 * emits `data:image/…;base64,…`, so a looser rule buys nothing — while a
 * percent-encoded variant (`;utf8,<svg …>`) would let raw markup reach a
 * stored row in a shape no scrubber here has inspected.
 */
/**
 * The additional preview images, validated the same way as the card image.
 *
 * `null` clears the list, `undefined` keeps whatever is stored (the same
 * keep/replace/clear contract the thumbnail uses, so editing a title can never
 * wipe an owner's uploaded previews).
 */
function validPreviews(value: unknown): string[] | null {
  if (value === null) return null;
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  for (const entry of value.slice(0, 12)) {
    const valid = validThumbnail(entry);
    if (valid) out.push(valid);
  }
  return out;
}

function validThumbnail(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  if (!/^data:image\/(png|jpe?g|webp|svg\+xml);base64,/i.test(value)) return null;
  return utf8Bytes(value) <= MAX_THUMB_BYTES ? value : null;
}

/**
 * Why a submitted preview image could not be stored.
 *
 * Silently keeping the OLD image made "I replaced the picture and the save did
 * nothing" indistinguishable from a working save. The author now gets the
 * reason, and the row is only written when the image really is storable.
 */
function thumbnailRejection(value: string): string {
  const bytes = utf8Bytes(value);
  if (bytes > MAX_THUMB_BYTES)
    return `صورة المعاينة بحجم ${mbLabel(bytes)} وتتجاوز الحد الأقصى ${mbLabel(MAX_THUMB_BYTES)} — أعد رفعها بصيغة أصغر`;
  return "صورة المعاينة غير صالحة — تُقبل PNG أو JPG أو WebP أو SVG كـ data URL";
}

/** Server-side content validation: JSON must be a project with pages; SVG must be an <svg> root without scripts. */
function validateContent(kind: TemplateKind, content: string): string | null {
  if (typeof content !== "string" || !content.trim()) return "المحتوى فارغ";
  const bytes = utf8Bytes(content);
  if (bytes > MAX_TEMPLATE_BYTES)
    return `حجم الملف ${mbLabel(bytes)} ويتجاوز الحد الأقصى ${mbLabel(MAX_TEMPLATE_BYTES)} — قلّل الصور المضمّنة ثم أعد الحفظ`;
  if (kind === "json") {
    const parsed = parseJson(content) as { pages?: unknown } | null;
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.pages) || parsed.pages.length === 0) {
      return "ملف JSON لا يحتوي على صفحات مشروع نَسَق صالحة";
    }
    return null;
  }
  if (!/^\s*(<\?xml[\s\S]*?\?>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(content)) return "ملف SVG غير صالح";
  /*
   * Hostile-construct check, shared with the editor's own SVG allow-list.
   *
   * The previous regex looked for `\son\w+\s*=`, i.e. an event handler
   * preceded by WHITESPACE — so `<svg/onload=alert(1)>` (a slash instead of a
   * space, which HTML parsers accept) walked straight through, and so did
   * `<foreignObject>`, `<style>@import …`, `<use href="https://evil/x.svg">`
   * and SMIL/`href` variants. Published template SVG is rendered on public
   * pages, so the tokenizer that already guards the canvas is the check here:
   * it refuses an executable element, a handler in ANY position, an external
   * reference and a `javascript:`/`data:text/html` URI, while still accepting
   * the unlisted-but-harmless attributes a Figma or Illustrator export carries.
   */
  if (svgDangerFindings(content).length > 0) {
    return "ملف SVG يحتوي على شيفرة غير مسموحة";
  }
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
    const identity = {
      id: context.userId,
      email: context.userEmail,
      emailVerified: context.userEmailVerified,
    };
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
    const identity = {
      id: context.userId,
      email: context.userEmail,
      emailVerified: context.userEmailVerified,
    };
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
      `SELECT id, slug, title, description, category, tier, status, kind, thumbnail, previews, sort_order, created_at, updated_at, short_code
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
        `SELECT id, slug, title, description, category, tier, status, kind, thumbnail, previews, sort_order, created_at, updated_at, short_code
         FROM admin_templates WHERE (slug = $1 OR id = $1 OR short_code = $1) AND status = 'published' LIMIT 1`,
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
    const rows = await db.query(`SELECT * FROM admin_templates WHERE (slug = $1 OR id = $1 OR short_code = $1) AND status = 'published' LIMIT 1`, [key]);
    if (!rows.length) return { ok: false as const, error: "القالب غير موجود" };
    const row = rows[0];
    if (row.tier === "licensed") {
      let allowed = false;
      if (context.userId) {
        const { getAuthorizationContext } = await import("@/lib/auth/authorization.server");
        const access = await getAuthorizationContext({ id: context.userId, email: context.userEmail, emailVerified: context.userEmailVerified });
        allowed = access.isAdmin || access.entitlements.premium_templates === true;
      }
      if (!allowed) return { ok: false as const, error: "هذا القالب متاح في النسخة الكاملة", locked: true };
    }
    const content = String(row.content);
    const publicContent = row.kind === "json" ? publicJsonContent(content) : content;
    return { ok: true as const, template: { ...rowToSummary(row), content: publicContent } as AdminTemplate };
  });

export const adminListTemplatesFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const gate = await verifyTemplateManagerContext(context);
    if (!gate.ok) return { ok: false as const, error: gate.error, templates: [] };
    try {
      const db = await sql();
      await ensureProductTemplates(db);
      const rows = await db.query(
        `SELECT id, slug, title, description, category, tier, status, kind, thumbnail, sort_order, created_at, updated_at, short_code
         FROM admin_templates ORDER BY sort_order ASC, updated_at DESC LIMIT 500`,
      );
      return { ok: true as const, templates: rows.map(rowToSummary) };
    } catch (err) {
      return { ...storageFailure("قراءة القوالب", err), templates: [] };
    }
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
    try {
      const db = await sql();
      await ensureProductTemplates(db);
      const rows = await db.query(`SELECT * FROM admin_templates WHERE id = $1 LIMIT 1`, [id]);
      if (!rows.length) return { ok: false as const, error: "القالب غير موجود" };
      return {
        ok: true as const,
        template: { ...rowToSummary(rows[0]), content: String(rows[0].content) } as AdminTemplate,
      };
    } catch (err) {
      return storageFailure("قراءة القالب", err);
    }
  });

export const adminUpsertTemplateFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { template: AdminTemplateInput }) => data)
  .handler(async ({ data, context }): Promise<
    | { ok: false; error: string }
    | { ok: true; id: string; slug: string | null; shortCode: string | null; title: string }
  > => {
    /*
     * Every failure path returns its reason. A throw here used to surface in
     * the console as a rejected server-function call while the panel stayed in
     * its "saving" state — the recurring "تعثر الحفظ" with nothing to act on.
     */
    try {
      return await upsertTemplate(data, context);
    } catch (err) {
      return storageFailure("حفظ القالب", err);
    }
  });

async function upsertTemplate(
  data: { template: AdminTemplateInput },
  context: VerifiedContext,
): Promise<
  | { ok: false; error: string }
  | { ok: true; id: string; slug: string | null; shortCode: string | null; title: string }
> {
    const gate = await verifyTemplateManagerContext(context);
    if (!gate.ok) return { ok: false as const, error: gate.error };
    const t = data.template;
    const kind: TemplateKind = t.kind === "svg" ? "svg" : "json";
    const tier: TemplateTier = t.tier === "licensed" ? "licensed" : "free";
    const status: TemplateStatus = t.status === "published" || t.status === "archived" ? t.status : "draft";
    const title = resolveTemplateName({
      title: t.title,
      titleIsManual: t.titleIsManual,
      sourceName: t.sourceName,
      description: t.description,
      category: t.category,
      kind,
      format: t.format,
      content: t.content,
    });
    const category = String(t.category ?? "general").slice(0, 60) || "general";
    const description = String(t.description ?? "").slice(0, 500);
    const origin = String(t.originProjectId ?? "").trim().slice(0, 120);
    const db = await sql();
    /*
     * Saving the open document again updates the official template that came
     * from it. A second click must not create a second catalogue row.
     * «نسخة جديدة» opts out by leaving the origin empty.
     */
    if (!t.id && origin && t.createNew !== true && t.content) {
      const rawContent = String(t.content);
      const content = kind === "json" ? applyTemplateNameToContent(rawContent, title) : rawContent;
      const contentError = validateContent(kind, content);
      if (contentError) return { ok: false as const, error: contentError };
      const { randomUUID } = await import("node:crypto");
      const newId = `tpl_${randomUUID()}`;
      const baseInput = t.slug ? sanitizeSlug(String(t.slug)) : slugifyTitle(title);
      const slug = await ensureUniqueSlug(db, baseInput || newId);
      const thumbnail = validThumbnail(t.thumbnail);
      const previews = validPreviews(t.previews) ?? [];
      const rows = await db.query<{ id: string; slug: string | null }>(
        `INSERT INTO admin_templates
          (id, slug, title, description, category, tier, status, kind, content, thumbnail, previews, sort_order, origin_project_id, owner_edited, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13, true, now(), now())
         ON CONFLICT (origin_project_id) WHERE origin_project_id IS NOT NULL
         DO UPDATE SET title = EXCLUDED.title, description = EXCLUDED.description,
           category = EXCLUDED.category, tier = EXCLUDED.tier, status = EXCLUDED.status,
           kind = EXCLUDED.kind, content = EXCLUDED.content,
           thumbnail = COALESCE(EXCLUDED.thumbnail, admin_templates.thumbnail),
           previews = EXCLUDED.previews,
           owner_edited = true,
           updated_at = now()
         RETURNING id, slug`,
        [
          newId,
          slug,
          title,
          description,
          category,
          tier,
          status,
          kind,
          content,
          thumbnail,
          JSON.stringify(previews),
          Number.isFinite(Number(t.sortOrder)) ? Math.trunc(Number(t.sortOrder)) : 0,
          origin,
        ],
      );
      const saved = rows[0];
      if (!saved) return { ok: false as const, error: "تعذر حفظ القالب" };
      if (status !== "published" || tier !== "free") {
        await clearFeaturedTemplateReference(db, saved.id);
      }
      /*
       * The short public address (`/t/<code>`) is minted the first time a row
       * is saved and then kept for the life of the template, so a link that
       * was already sent out never changes.
       */
      const shortCode = await ensureShortCode(db, "admin_templates", saved.id);
      return { ok: true as const, id: saved.id, slug: saved.slug, title, shortCode };
    }
    const existing = t.id
      ? await db.query<{ content: string; kind: string; slug: string | null; thumbnail: string | null; previews: unknown }>(
          `SELECT content, kind, slug, thumbnail, previews FROM admin_templates WHERE id = $1`,
          [t.id],
        )
      : [];
    const replacingContent = Boolean(t.content);
    const rawContent = replacingContent ? String(t.content) : existing[0]?.content ?? "";
    const content = kind === "json" ? applyTemplateNameToContent(rawContent, title) : rawContent;
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
    else if (t.thumbnail === undefined || t.thumbnail === "")
      thumbnail = existing[0]?.thumbnail ?? null;
    else if (validThumbnail(t.thumbnail)) thumbnail = t.thumbnail;
    else return { ok: false as const, error: thumbnailRejection(String(t.thumbnail)) };
    /*
     * PREVIEW SET — the same three cases as the card image, applied to the
     * ordered list: an explicit array replaces it (an empty array clears it),
     * `null` clears it, and undefined keeps what is stored.
     */
    const submittedPreviews = validPreviews(t.previews);
    const previews: string[] =
      t.previews === null
        ? []
        : t.previews === undefined
          ? (validPreviews(existing[0]?.previews) ?? [])
          : (submittedPreviews ?? (validPreviews(existing[0]?.previews) ?? []));
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
      `INSERT INTO admin_templates (id, slug, title, description, category, tier, status, kind, content, thumbnail, previews, sort_order, owner_edited, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12, true, now(), now())
       ON CONFLICT (id) DO UPDATE SET slug = EXCLUDED.slug, title = EXCLUDED.title, description = EXCLUDED.description,
         category = EXCLUDED.category, tier = EXCLUDED.tier, status = EXCLUDED.status, kind = EXCLUDED.kind,
         content = EXCLUDED.content, thumbnail = EXCLUDED.thumbnail, previews = EXCLUDED.previews,
         sort_order = EXCLUDED.sort_order,
         owner_edited = true, updated_at = now()`,
      [
        id,
        slug,
        title,
        description,
        category,
        tier,
        status,
        kind,
        content,
        thumbnail,
        JSON.stringify(previews),
        Number.isFinite(Number(t.sortOrder)) ? Math.trunc(Number(t.sortOrder)) : 0,
      ],
    );
    if (status !== "published" || tier !== "free") {
      await clearFeaturedTemplateReference(db, id);
    }
    /*
     * The short public address (`/t/<code>`) is minted the first time a row is
     * saved and then kept for the life of the template, so a link that was
     * already sent out never changes.
     */
    const shortCode = await ensureShortCode(db, "admin_templates", id);
    return { ok: true as const, id, slug, title, shortCode };
}

export const adminSetTemplateStatusFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { id: string; status?: TemplateStatus; tier?: TemplateTier }) => data)
  .handler(async ({ data, context }) => {
    const gate = await verifyTemplateManagerContext(context);
    if (!gate.ok) return { ok: false as const, error: gate.error };
    let db: Awaited<ReturnType<typeof sql>>;
    try {
      db = await sql();
    } catch (err) {
      return storageFailure("تحديث حالة القالب", err);
    }
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
    let db: Awaited<ReturnType<typeof sql>>;
    try {
      db = await sql();
    } catch (err) {
      return storageFailure("حذف القالب", err);
    }
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
    let db: Awaited<ReturnType<typeof sql>>;
    try {
      db = await sql();
    } catch (err) {
      return storageFailure("توليد رابط القالب", err);
    }
    const rows = await db.query<{ title: string }>(`SELECT title FROM admin_templates WHERE id = $1 LIMIT 1`, [data.id]);
    if (!rows.length) return { ok: false as const, error: "القالب غير موجود" };
    const base = data.slug ? sanitizeSlug(data.slug) : slugifyTitle(rows[0].title);
    if (!base) return { ok: false as const, error: "تعذر توليد الرابط" };
    const slug = await ensureUniqueSlug(db, base, data.id);
    await db.query(`UPDATE admin_templates SET slug = $2, updated_at = now() WHERE id = $1`, [data.id, slug]);
    return { ok: true as const, slug };
  });
