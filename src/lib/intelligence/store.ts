/** Browser history for studio runs. Projects themselves stay in the editor store. */

const KEY = "nasaq.intelligence.v1";
const MAX_RUNS = 12;

export interface IntelligenceRun {
  id: string;
  at: number;
  path: "generate" | "improve";
  label: string;
  score: number;
  projectId?: string;
  referenceId?: string;
}

function storage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadRuns(): IntelligenceRun[] {
  const store = storage();
  if (!store) return [];
  try {
    const parsed = JSON.parse(store.getItem(KEY) || "[]") as IntelligenceRun[];
    return Array.isArray(parsed) ? parsed.slice(0, MAX_RUNS) : [];
  } catch {
    return [];
  }
}

export function rememberRun(run: IntelligenceRun): void {
  const store = storage();
  if (!store) return;
  const next = [run, ...loadRuns().filter((item) => item.id !== run.id)].slice(0, MAX_RUNS);
  try {
    store.setItem(KEY, JSON.stringify(next));
  } catch {
    /* the document is already saved in the editor store */
  }
}
