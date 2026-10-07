/**
 * قوالبي — private templates for an active licence.
 *
 * Every row is scoped to the verified session. A share URL is minted only when
 * the owner sets visibility to shared, and the public read never returns
 * account, licence or payment fields.
 */

import { createServerFn } from "@tanstack/react-start";
import { authMiddleware, optionalAuthMiddleware } from "@/lib/auth/middleware";
import { canUsePersonalTemplates } from "@/lib/templates/personal";
import {
  publicTemplateContent,
  templateDocumentSummary,
  validateTemplateDocument,
} from "@/lib/templates/document-template";
import { freshPages } from "@/lib/templates/custom-templates";
import { applyTemplateNameToContent, resolveTemplateName } from "@/lib/templates/naming";
import { backfillShortCodes, ensureShortCode } from "@/lib/templates/short-code.server";

const MAX_ITEMS = 80;
/** Legacy opaque tokens are 16–80 chars; a short code is 7. Both resolve. */
const TOKEN_RE = /^[a-zA-Z0-9_-]{6,80}$/;

type Gate =
  | { ok: true; userId: string; premium: boolean; staff: boolean }
  | { ok: false; error: string; code: "auth" | "forbidden" | "suspended" };

async function gatePersonal(context: { userId: string; userEmail: string | null; userEmailVerified: boolean }): Promise<Gate> {
  const { getAuthorizationContext } = await import("@/lib/auth/authorization.server");
  const access = await getAuthorizationContext({ id: context.userId, email: context.userEmail, emailVerified: context.userEmailVerified });
  if (access.isSuspended) {
    return { ok: false, code: "suspended", error: "الحساب موقوف — قوالبي غير متاحة." };
  }
  const allowed = canUsePersonalTemplates({
    isOwner: access.isOwner,
    isAdmin: access.isAdmin,
    isSuspended: access.isSuspended,
    premiumTemplates: access.entitlements.premium_templates === true,
  });
  if (!allowed) {
    return { ok: false, code: "forbidden", error: "قوالبي متاحة للحسابات المرخّصة فقط." };
  }
  return {
    ok: true,
    userId: context.userId,
    premium: access.entitlements.premium_templates === true || access.isAdmin || access.isOwner,
    staff: access.isAdmin || access.isOwner,
  };
}

async function db() {
  const { getSql } = await import("@/lib/db");
  return getSql();
}

function cleanTitle(value: unknown): string {
  return String(value ?? "").trim().slice(0, 120);
}

function cleanText(value: unknown, max: number): string {
  return String(value ?? "").trim().slice(0, max);
}

function validThumbnail(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  if (!/^data:image\/(png|jpe?g|webp);base64,/i.test(value)) return null;
  return value.length <= 1_500_000 ? value : null;
}

function summaryRow(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    title: String(row.title),
    description: String(row.description ?? ""),
    category: String(row.category ?? "general"),
    visibility: row.visibility === "shared" ? "shared" as const : "private" as const,
    shareToken: typeof row.share_token === "string" ? row.share_token : null,
    shortCode: typeof row.short_code === "string" ? row.short_code : null,
    thumbnail: typeof row.thumbnail === "string" ? row.thumbnail : null,
    pageCount: Number(row.page_count) || 1,
    pageW: Number(row.page_w) || 210,
    pageH: Number(row.page_h) || 297,
    updatedAt: String(row.updated_at ?? ""),
  };
}

async function token(): Promise<string> {
  const { randomUUID } = await import("node:crypto");
  return randomUUID().replace(/-/g, "");
}

export const listPersonalTemplatesFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const gate = await gatePersonal(context);
    if (!gate.ok) return { ok: false as const, error: gate.error, templates: [] };
    const sql = await db();
    /* Rows saved before short codes existed get one on first listing. */
    await backfillShortCodes(sql, "user_templates");
    const rows = await sql.query(
      `SELECT id, title, description, category, visibility, share_token, short_code, thumbnail,
              page_count, page_w, page_h, updated_at
       FROM user_templates WHERE user_id = $1
       ORDER BY updated_at DESC LIMIT $2`,
      [gate.userId, MAX_ITEMS],
    );
    return { ok: true as const, templates: rows.map(summaryRow) };
  });

export const savePersonalTemplateFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: {
    title: string;
    titleIsManual?: boolean;
    description?: string;
    category?: string;
    content: string;
    thumbnail?: string | null;
    originProjectId?: string;
    createNew?: boolean;
    share?: boolean;
  }) => data)
  .handler(async ({ data, context }) => {
    const gate = await gatePersonal(context);
    if (!gate.ok) return { ok: false as const, error: gate.error };
    const description = cleanText(data.description, 500);
    const category = cleanText(data.category, 60) || "general";
    const title = resolveTemplateName({
      title: data.title,
      titleIsManual: data.titleIsManual,
      description,
      category,
      kind: "json",
      content: data.content,
    });
    const namedContent = applyTemplateNameToContent(data.content, title);
    const contentError = validateTemplateDocument(namedContent);
    if (contentError) return { ok: false as const, error: contentError };
    const safe = publicTemplateContent(namedContent);
    if (!safe) return { ok: false as const, error: "تعذر حفظ القالب" };
    const summary = templateDocumentSummary(safe);
    if (!summary) return { ok: false as const, error: "صفحات القالب غير صالحة" };
    const origin = cleanText(data.originProjectId, 120);
    const enabling = data.share === true;
    const sql = await db();
    const count = await sql.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM user_templates WHERE user_id = $1`,
      [gate.userId],
    );
    const existing = !data.createNew && origin
      ? await sql.query<{ id: string; share_token: string | null; visibility: string }>(
          `SELECT id, share_token, visibility FROM user_templates
           WHERE user_id = $1 AND origin_project_id = $2 LIMIT 1`,
          [gate.userId, origin],
        )
      : [];
    if (!existing.length && Number(count[0]?.n ?? 0) >= MAX_ITEMS) {
      return { ok: false as const, error: "بلغت الحد الأقصى لقوالبك. احذف قالبًا ثم أعد المحاولة." };
    }
    const prior = existing[0];
    let nextVisibility: "private" | "shared" = prior?.visibility === "shared" ? "shared" : "private";
    let nextToken: string | null =
      nextVisibility === "shared" && prior?.share_token && TOKEN_RE.test(prior.share_token)
        ? prior.share_token
        : null;
    if (!prior) nextVisibility = "private";
    if (enabling) {
      nextVisibility = "shared";
      if (!nextToken) nextToken = await token();
    }
    const thumb = validThumbnail(data.thumbnail);
    const { randomUUID } = await import("node:crypto");
    const id = prior?.id ?? `mine_${randomUUID()}`;
    if (prior) {
      await sql.query(
        `UPDATE user_templates SET title = $2, description = $3, category = $4, content = $5,
           thumbnail = COALESCE($6, thumbnail), visibility = $7, share_token = $8,
           page_count = $9, page_w = $10, page_h = $11, updated_at = now()
         WHERE id = $1 AND user_id = $12`,
        [
          id, title, description, category,
          safe, thumb, nextVisibility, nextVisibility === "shared" ? nextToken : null,
          summary.pageCount, summary.w, summary.h, gate.userId,
        ],
      );
    } else {
      await sql.query(
        `INSERT INTO user_templates
          (id, user_id, origin_project_id, title, description, category, content, thumbnail,
           visibility, share_token, page_count, page_w, page_h, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, now(), now())`,
        [
          id, gate.userId, data.createNew ? null : origin || null, title, description,
          category, safe, thumb, nextVisibility,
          nextVisibility === "shared" ? nextToken : null, summary.pageCount, summary.w, summary.h,
        ],
      );
    }
    /* Mint the short public address once, then reuse it forever. */
    const shortCode = await ensureShortCode(sql, "user_templates", id);
    const row = await sql.query(
      `SELECT id, title, description, category, visibility, share_token, short_code, thumbnail,
              page_count, page_w, page_h, updated_at
       FROM user_templates WHERE id = $1 AND user_id = $2 LIMIT 1`,
      [id, gate.userId],
    );
    const saved = summaryRow(row[0] || { id, title });
    return { ok: true as const, template: { ...saved, shortCode: saved.shortCode || shortCode } };
  });

export const renamePersonalTemplateFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { id: string; title: string }) => data)
  .handler(async ({ data, context }) => {
    const gate = await gatePersonal(context);
    if (!gate.ok) return { ok: false as const, error: gate.error };
    const title = cleanTitle(data.title);
    if (!title) return { ok: false as const, error: "اسم القالب مطلوب" };
    const sql = await db();
    const rows = await sql.query(
      `UPDATE user_templates SET title = $3, updated_at = now()
       WHERE id = $1 AND user_id = $2 RETURNING id`,
      [cleanText(data.id, 120), gate.userId, title],
    );
    if (!rows.length) return { ok: false as const, error: "القالب غير موجود" };
    return { ok: true as const };
  });

export const duplicatePersonalTemplateFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { id: string }) => data)
  .handler(async ({ data, context }) => {
    const gate = await gatePersonal(context);
    if (!gate.ok) return { ok: false as const, error: gate.error };
    const sql = await db();
    const rows = await sql.query<Record<string, unknown>>(
      `SELECT * FROM user_templates WHERE id = $1 AND user_id = $2 LIMIT 1`,
      [cleanText(data.id, 120), gate.userId],
    );
    if (!rows.length) return { ok: false as const, error: "القالب غير موجود" };
    const source = rows[0];
    const parsed = JSON.parse(String(source.content)) as { pages: Parameters<typeof freshPages>[0] };
    parsed.pages = freshPages(parsed.pages);
    const content = JSON.stringify(parsed);
    const { randomUUID } = await import("node:crypto");
    const id = `mine_${randomUUID()}`;
    await sql.query(
      `INSERT INTO user_templates
        (id, user_id, origin_project_id, title, description, category, content, thumbnail,
         visibility, share_token, page_count, page_w, page_h, created_at, updated_at)
       VALUES ($1,$2,null,$3,$4,$5,$6,$7,'private',null,$8,$9,$10, now(), now())`,
      [
        id, gate.userId, `${String(source.title)} نسخة`.slice(0, 120),
        String(source.description ?? ""), String(source.category ?? "general"), content,
        source.thumbnail ?? null, source.page_count ?? 1, source.page_w ?? 210, source.page_h ?? 297,
      ],
    );
    return { ok: true as const, id };
  });

export const deletePersonalTemplateFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { id: string }) => data)
  .handler(async ({ data, context }) => {
    const gate = await gatePersonal(context);
    if (!gate.ok) return { ok: false as const, error: gate.error };
    const sql = await db();
    await sql.query(`DELETE FROM user_templates WHERE id = $1 AND user_id = $2`, [
      cleanText(data.id, 120), gate.userId,
    ]);
    return { ok: true as const };
  });

export const setPersonalSharingFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { id: string; shared: boolean }) => data)
  .handler(async ({ data, context }) => {
    const gate = await gatePersonal(context);
    if (!gate.ok) return { ok: false as const, error: gate.error };
    const sql = await db();
    const id = cleanText(data.id, 120);
    if (data.shared) {
      const current = await sql.query<{ share_token: string | null }>(
        `SELECT share_token FROM user_templates WHERE id = $1 AND user_id = $2 LIMIT 1`,
        [id, gate.userId],
      );
      if (!current.length) return { ok: false as const, error: "القالب غير موجود" };
      const shareToken = current[0].share_token && TOKEN_RE.test(current[0].share_token)
        ? current[0].share_token
        : await token();
      await sql.query(
        `UPDATE user_templates SET visibility = 'shared', share_token = $3, updated_at = now()
         WHERE id = $1 AND user_id = $2`,
        [id, gate.userId, shareToken],
      );
      const shortCode = await ensureShortCode(sql, "user_templates", id);
      return { ok: true as const, shareToken, shortCode };
    }
    await sql.query(
      `UPDATE user_templates SET visibility = 'private', share_token = null, updated_at = now()
       WHERE id = $1 AND user_id = $2`,
      [id, gate.userId],
    );
    return { ok: true as const, shareToken: null };
  });

export const getPersonalTemplateFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { id: string }) => data)
  .handler(async ({ data, context }) => {
    const gate = await gatePersonal(context);
    if (!gate.ok) return { ok: false as const, error: gate.error };
    const sql = await db();
    const rows = await sql.query<Record<string, unknown>>(
      `SELECT id, title, content, visibility, share_token FROM user_templates
       WHERE id = $1 AND user_id = $2 LIMIT 1`,
      [cleanText(data.id, 120), gate.userId],
    );
    if (!rows.length) return { ok: false as const, error: "القالب غير موجود" };
    const content = publicTemplateContent(String(rows[0].content));
    if (!content) return { ok: false as const, error: "القالب تالف" };
    return {
      ok: true as const,
      template: { id: String(rows[0].id), title: String(rows[0].title), content },
    };
  });

export const getSharedPersonalTemplateFn = createServerFn({ method: "POST" })
  .middleware([optionalAuthMiddleware])
  .validator((data: { token: string; includeContent?: boolean }) => data)
  .handler(async ({ data, context }) => {
    const shareToken = cleanText(data.token, 80).toLowerCase();
    if (!TOKEN_RE.test(shareToken)) return { ok: false as const, error: "القالب غير متاح" };
    const sql = await db();
    /*
     * `/s/<code>` and the legacy `/templates/share/<token>` are the same public
     * surface: one lookup answers both, and only a row the owner explicitly
     * shared is ever returned.
     */
    const rows = await sql.query<Record<string, unknown>>(
      `SELECT id, title, description, category, thumbnail, content, page_count, page_w, page_h
       FROM user_templates
       WHERE (share_token = $1 OR short_code = $1) AND visibility = 'shared' LIMIT 1`,
      [shareToken],
    );
    if (!rows.length) return { ok: false as const, error: "القالب غير متاح" };
    const row = rows[0];
    const summary = templateDocumentSummary(String(row.content));
    const licensedId = summary?.licensedTemplateId;
    if (licensedId) {
      let allowed = false;
      if (context.userId) {
        const { getAuthorizationContext } = await import("@/lib/auth/authorization.server");
        const access = await getAuthorizationContext({ id: context.userId, email: context.userEmail, emailVerified: context.userEmailVerified });
        allowed = access.isAdmin || access.isOwner || access.entitlements.premium_templates === true;
      }
      if (!allowed && data.includeContent) {
        return {
          ok: false as const,
          error: "هذا القالب متاح في النسخة الكاملة",
          locked: true,
          template: publicCard(row),
        };
      }
    }
    const template = publicCard(row);
    if (!data.includeContent) return { ok: true as const, template };
    const content = publicTemplateContent(String(row.content));
    if (!content) return { ok: false as const, error: "القالب غير متاح" };
    return { ok: true as const, template: { ...template, content } };
  });

function publicCard(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    title: String(row.title),
    description: String(row.description ?? ""),
    category: String(row.category ?? "general"),
    thumbnail: typeof row.thumbnail === "string" ? row.thumbnail : null,
    pageCount: Number(row.page_count) || 1,
    pageW: Number(row.page_w) || 210,
    pageH: Number(row.page_h) || 297,
  };
}
