import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import {
  defaultCuratedReferences,
  DEFAULT_STUDIO_SETTINGS,
  type StudioGenerationSettings,
  type StudioVisualReference,
} from "./references-manager";

const REFERENCES_KEY = "studio_visual_references";
const SETTINGS_KEY = "studio_generation_settings";

async function sql() {
  const { getSql } = await import("@/lib/db");
  return getSql();
}

async function canManage(context: { userId: string | null; userEmail?: string | null }): Promise<boolean> {
  const { isAdminIdentity } = await import("@/lib/auth/admin-identity.server");
  return isAdminIdentity(await sql(), { id: context.userId || "", email: context.userEmail ?? null });
}

async function readReferences(): Promise<StudioVisualReference[]> {
  try {
    const db = await sql();
    const rows = await db.query<{ value: unknown }>(
      `SELECT value FROM site_settings WHERE key = $1 LIMIT 1`,
      [REFERENCES_KEY],
    );
    if (rows.length && Array.isArray(rows[0].value)) {
      return rows[0].value as StudioVisualReference[];
    }
  } catch (err) {
    console.error("[studio] failed to read references:", err);
  }
  return defaultCuratedReferences();
}

async function writeReferences(refs: StudioVisualReference[]): Promise<void> {
  const db = await sql();
  await db.query(
    `INSERT INTO site_settings (key, value, updated_at)
     VALUES ($1, $2::jsonb, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [REFERENCES_KEY, JSON.stringify(refs)],
  );
}

async function readSettings(): Promise<StudioGenerationSettings> {
  try {
    const db = await sql();
    const rows = await db.query<{ value: unknown }>(
      `SELECT value FROM site_settings WHERE key = $1 LIMIT 1`,
      [SETTINGS_KEY],
    );
    if (rows.length && rows[0].value && typeof rows[0].value === "object") {
      return { ...DEFAULT_STUDIO_SETTINGS, ...(rows[0].value as Partial<StudioGenerationSettings>) };
    }
  } catch (err) {
    console.error("[studio] failed to read settings:", err);
  }
  return DEFAULT_STUDIO_SETTINGS;
}

async function writeSettings(settings: StudioGenerationSettings): Promise<void> {
  const db = await sql();
  await db.query(
    `INSERT INTO site_settings (key, value, updated_at)
     VALUES ($1, $2::jsonb, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [SETTINGS_KEY, JSON.stringify(settings)],
  );
}

export const listStudioReferencesFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const manage = await canManage(context);
    const refs = await readReferences();
    return {
      ok: true as const,
      canManage: manage,
      references: refs,
    };
  });

type ReferenceMutation =
  | { op: "create"; reference: Omit<StudioVisualReference, "id" | "updatedAt"> }
  | { op: "update"; id: string; reference: Partial<StudioVisualReference> }
  | { op: "toggle_approved"; id: string; approved: boolean }
  | { op: "delete"; id: string }
  | { op: "reset_defaults" };

export const mutateStudioReferenceFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: ReferenceMutation) => data)
  .handler(async ({ data, context }) => {
    if (!(await canManage(context))) {
      return { ok: false as const, error: "غير مصرح لإدارة المراجع" };
    }

    const current = await readReferences();
    const now = Date.now();

    if (data.op === "reset_defaults") {
      const reset = defaultCuratedReferences();
      await writeReferences(reset);
      return { ok: true as const, references: reset };
    }

    if (data.op === "create") {
      const newRef: StudioVisualReference = {
        ...data.reference,
        id: `ref-custom-${now.toString(36)}`,
        updatedAt: now,
      };
      const updated = [newRef, ...current];
      await writeReferences(updated);
      return { ok: true as const, references: updated };
    }

    if (data.op === "toggle_approved") {
      const updated = current.map((item) =>
        item.id === data.id ? { ...item, approved: data.approved, updatedAt: now } : item,
      );
      await writeReferences(updated);
      return { ok: true as const, references: updated };
    }

    if (data.op === "update") {
      const updated = current.map((item) =>
        item.id === data.id ? { ...item, ...data.reference, updatedAt: now } : item,
      );
      await writeReferences(updated);
      return { ok: true as const, references: updated };
    }

    if (data.op === "delete") {
      const updated = current.filter((item) => item.id !== data.id);
      await writeReferences(updated);
      return { ok: true as const, references: updated };
    }

    return { ok: false as const, error: "عملية غير معروفة" };
  });

export const getStudioSettingsFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const manage = await canManage(context);
    const settings = await readSettings();
    return {
      ok: true as const,
      canManage: manage,
      settings,
    };
  });

export const updateStudioSettingsFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: Partial<StudioGenerationSettings>) => data)
  .handler(async ({ data, context }) => {
    if (!(await canManage(context))) {
      return { ok: false as const, error: "غير مصرح" };
    }
    const current = await readSettings();
    const next: StudioGenerationSettings = {
      ...current,
      ...data,
      updatedAt: Date.now(),
    };
    await writeSettings(next);
    return { ok: true as const, settings: next };
  });
