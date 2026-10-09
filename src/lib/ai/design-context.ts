import { categoryFromBrief } from "@/lib/intelligence/design-constitution";
import {
  memoryAppliesToCategory,
  resolveMemory,
  type DesignMemoryView,
} from "./design-memory";

export function designContextNotes(
  prompt: string,
  memory: readonly DesignMemoryView[],
  references: readonly Record<string, unknown>[],
): string {
  const category = categoryFromBrief(prompt);
  const resolved = resolveMemory(
    memory.filter((row) => memoryAppliesToCategory(row, category)),
  );
  const visual = references
    .filter((row) => row.scope === "global")
    .slice(0, 6)
    .map((row) => {
      const analysis =
        row.analysis && typeof row.analysis === "object"
          ? (row.analysis as Record<string, unknown>)
          : {};
      return {
        description: String(analysis.description ?? "").slice(0, 1200),
        likes: String(row.likes ?? "").slice(0, 500),
        dislikes: String(row.dislikes ?? "").slice(0, 500),
      };
    });
  return JSON.stringify({ preferences: resolved, references: visual });
}
