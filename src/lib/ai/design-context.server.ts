import { getSql } from "@/lib/db";
import { listDesignMemory } from "./design-memory.server";
import { designContextNotes } from "./design-context";

/** Both generation entrypoints read the same account-owned persistent inputs.
 * Project/task references lack a binding in the existing schema: do not leak
 * them into unrelated briefs by treating them as global preferences.
 */
export async function loadDesignContext(userId: string, prompt: string) {
  const sql = await getSql();
  const memory = await listDesignMemory(userId);
  const references =
    await sql`select analysis, likes, dislikes, scope from design_training_references
    where user_id = ${userId} and scope = 'global' order by created_at desc limit 6`;
  return {
    memory,
    memoryNotes: designContextNotes(prompt, memory, references),
  };
}
