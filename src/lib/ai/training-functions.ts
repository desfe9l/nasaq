import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql } from "@/lib/db";
import type { DesignMemoryInput, DesignMemoryView } from "./design-memory";
import { recordDesignMemory, deleteDesignMemory, listDesignMemory } from "./design-memory.server";

export interface TrainingReferenceView {
  id: string;
  fileName: string;
  contentType: string;
  assetId: string | null;
  analysis: { description: string; recognizedText: string; objects: string[] };
  likes: string;
  dislikes: string;
  scope: "global" | "project" | "task";
  createdAt: string;
}

function normalizeAnalysis(value: unknown): TrainingReferenceView["analysis"] {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    description: String(raw.description ?? "").slice(0, 1200),
    recognizedText: String(raw.recognizedText ?? "").slice(0, 8000),
    objects: Array.isArray(raw.objects) ? raw.objects.filter((x): x is string => typeof x === "string").slice(0, 20) : [],
  };
}
function view(row: Record<string, unknown>): TrainingReferenceView {
  return {
    id: String(row.id), fileName: String(row.file_name), contentType: String(row.content_type),
    assetId: row.asset_id ? String(row.asset_id) : null, analysis: normalizeAnalysis(row.analysis),
    likes: String(row.likes ?? ""), dislikes: String(row.dislikes ?? ""),
    scope: row.scope === "project" || row.scope === "task" ? row.scope : "global",
    createdAt: new Date(String(row.created_at)).toISOString(),
  };
}

export const listTrainingCenterFn = createServerFn({ method: "GET" }).middleware([authMiddleware]).handler(async ({ context }): Promise<{ ok: true; references: TrainingReferenceView[]; memory: DesignMemoryView[] } | { ok: false; message: string }> => {
  try {
    const sql = await getSql();
    const rows = await sql`select id, file_name, content_type, asset_id, analysis, likes, dislikes, scope, created_at from design_training_references where user_id = ${context.userId} order by created_at desc limit 40`;
    return { ok: true, references: rows.map((row) => view(row as Record<string, unknown>)), memory: await listDesignMemory(context.userId) };
  } catch {
    return { ok: false, message: "تعذر تحميل مركز التدريب لهذا الحساب." };
  }
});

export const saveTrainingReferenceFn = createServerFn({ method: "POST" }).middleware([authMiddleware]).validator((data: Record<string, unknown>) => data).handler(async ({ data, context }): Promise<{ ok: true; reference: TrainingReferenceView } | { ok: false; message: string }> => {
  const fileName = String(data.fileName ?? "مرجع").trim().slice(0, 160);
  const contentType = String(data.contentType ?? "image/png").trim().toLowerCase();
  if (!fileName || !/^image\/(png|jpeg|webp)$/.test(contentType)) return { ok: false, message: "يدعم التدريب صور PNG أو JPEG أو WebP فقط." };
  const scope = data.scope === "project" || data.scope === "task" ? data.scope : "global";
  const analysis = normalizeAnalysis(data.analysis);
  const id = crypto.randomUUID();
  try {
    const sql = await getSql();
    await sql`insert into design_training_references (id, user_id, file_name, content_type, asset_id, analysis, likes, dislikes, scope) values (${id}, ${context.userId}, ${fileName}, ${contentType}, ${data.assetId ? String(data.assetId).slice(0, 120) : null}, ${JSON.stringify(analysis)}::jsonb, ${String(data.likes ?? "").slice(0, 1000)}, ${String(data.dislikes ?? "").slice(0, 1000)}, ${scope})`;
    return { ok: true, reference: view({ id, file_name: fileName, content_type: contentType, asset_id: data.assetId ?? null, analysis, likes: data.likes ?? "", dislikes: data.dislikes ?? "", scope, created_at: new Date().toISOString() }) };
  } catch {
    return { ok: false, message: "تعذر حفظ المرجع في حسابك." };
  }
});

export const deleteTrainingReferenceFn = createServerFn({ method: "POST" }).middleware([authMiddleware]).validator((data: { id?: string }) => data).handler(async ({ data, context }) => {
  const id = String(data.id ?? "").trim();
  if (!id) return { ok: false as const, message: "المرجع غير معروف." };
  const sql = await getSql();
  const rows = await sql`delete from design_training_references where id = ${id} and user_id = ${context.userId} returning id`;
  return rows.length ? { ok: true as const } : { ok: false as const, message: "المرجع غير موجود في هذا الحساب." };
});

export const updateTrainingMemoryFn = createServerFn({ method: "POST" }).middleware([authMiddleware]).validator((data: Partial<DesignMemoryInput>) => data).handler(async ({ data, context }) => {
  const entry = await recordDesignMemory(context.userId, data);
  return entry ? { ok: true as const, entry } : { ok: false as const, message: "احفظ قاعدة مكتملة؛ الرفض والتصحيح يحتاجان سببًا." };
});

export const deleteTrainingMemoryFn = createServerFn({ method: "POST" }).middleware([authMiddleware]).validator((data: { id?: string }) => data).handler(async ({ data, context }) => {
  return (await deleteDesignMemory(context.userId, String(data.id ?? ""))) ? { ok: true as const } : { ok: false as const, message: "تعذر حذف القاعدة." };
});

export const resetTrainingCenterFn = createServerFn({ method: "POST" }).middleware([authMiddleware]).handler(async ({ context }) => {
  const sql = await getSql();
  await sql`delete from design_training_references where user_id = ${context.userId}`;
  for (const row of await listDesignMemory(context.userId)) await deleteDesignMemory(context.userId, row.id);
  return { ok: true as const };
});
