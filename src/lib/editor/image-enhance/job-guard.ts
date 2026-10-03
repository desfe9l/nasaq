/**
 * Single-flight guard for enhancement jobs.
 *
 * Prevents the same element from entering two concurrent processing runs
 * (double-click, impatient re-press while the model is mid-flight). Pure and
 * dependency-free so it runs under Node tests unchanged.
 */
import type { EnhanceOp } from "./types.ts";

export interface EnhanceJobGuard {
  /** Claim the slot; false when a job for the element is already running. */
  begin(elId: string, op: EnhanceOp): boolean;
  /** Release the slot (idempotent). */
  end(elId: string): void;
  /** Op currently running for the element, if any. */
  activeOp(elId: string): EnhanceOp | undefined;
  /** True when any element has a running enhancement job. */
  anyActive(): boolean;
}

export function createEnhanceJobGuard(): EnhanceJobGuard {
  const active = new Map<string, EnhanceOp>();
  return {
    begin(elId, op) {
      if (active.has(elId)) return false;
      active.set(elId, op);
      return true;
    },
    end(elId) {
      active.delete(elId);
    },
    activeOp(elId) {
      return active.get(elId);
    },
    anyActive() {
      return active.size > 0;
    },
  };
}

/** Shared guard instance used by the editor at runtime. */
export const enhanceJobGuard = createEnhanceJobGuard();
