import { getSql } from "@/lib/db";
import {
  DESIGN_MEMORY_CAP,
  idsBeyondCap,
  memoryRow,
  normalizeMemoryInput,
  type DesignMemoryInput,
  type DesignMemoryView,
} from "./design-memory";

interface MemoryRow {
  id: string;
  kind: string;
  category: string;
  brief: string;
  reason: string;
  constitution_version: string;
  recurring: boolean;
  rule_key: string;
  rule_value: string;
  created_at: string | Date;
}

function view(row: MemoryRow): DesignMemoryView {
  const created = row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at);
  return {
    id: String(row.id),
    kind: row.kind as DesignMemoryView["kind"],
    category: String(row.category ?? ""),
    brief: String(row.brief ?? ""),
    reason: String(row.reason ?? ""),
    constitutionVersion: String(row.constitution_version ?? ""),
    recurring: Boolean(row.recurring),
    ruleKey: String(row.rule_key ?? ""),
    ruleValue: String(row.rule_value ?? ""),
    createdAt: created,
  };
}

export async function listDesignMemory(userId: string): Promise<DesignMemoryView[]> {
  const sql = await getSql();
  const rows = await sql<MemoryRow>`
    select id, kind, category, brief, reason, constitution_version, recurring, rule_key, rule_value, created_at
    from design_memory
    where user_id = ${userId}
    order by created_at desc
    limit ${DESIGN_MEMORY_CAP}
  `;
  return rows.map(view);
}

export async function recordDesignMemory(userId: string, raw: Partial<DesignMemoryInput>): Promise<DesignMemoryView | null> {
  const input = normalizeMemoryInput(raw);
  if (!input || !userId) return null;
  const id = crypto.randomUUID();
  const row = memoryRow(input, id);
  const sql = await getSql();
  await sql`
    insert into design_memory (
      id, user_id, kind, category, brief, reason, constitution_version, recurring, rule_key, rule_value
    ) values (
      ${row.id},
      ${userId},
      ${row.kind},
      ${row.category},
      ${row.brief},
      ${row.reason},
      ${row.constitutionVersion},
      ${row.recurring},
      ${row.ruleKey},
      ${row.ruleValue}
    )
  `;
  const existing = await sql<{ id: string }>`
    select id from design_memory
    where user_id = ${userId}
    order by created_at desc
  `;
  for (const extra of idsBeyondCap(existing.map((item) => item.id))) {
    await sql`delete from design_memory where id = ${extra} and user_id = ${userId}`;
  }
  return row;
}

export async function deleteDesignMemory(userId: string, id: string): Promise<boolean> {
  if (!userId || !id) return false;
  const sql = await getSql();
  const rows = await sql<{ id: string }>`
    delete from design_memory
    where id = ${id} and user_id = ${userId}
    returning id
  `;
  return rows.length > 0;
}
