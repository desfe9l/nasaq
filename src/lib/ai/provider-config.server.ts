import { AI_PROVIDER_IDS, DEFAULT_AI_PROVIDER_SETTINGS, type AiProviderId, type AiProviderSettings, type AiTask } from "./provider-config";
export { AI_PROVIDER_IDS, DEFAULT_AI_PROVIDER_SETTINGS } from "./provider-config";
export type { AiProviderId, AiProviderSettings, AiTask } from "./provider-config";

const SETTINGS_KEY = "nasaq_ai_provider_config.v1";
const TASKS: AiTask[] = ["default", "report", "design", "selection", "image"];

async function database() {
  const { getSql } = await import("@/lib/db");
  return getSql();
}

export async function readAiProviderSettings(): Promise<AiProviderSettings> {
  try {
    const rows = await (await database()).query<{ value: unknown }>("SELECT value FROM site_settings WHERE key = $1 LIMIT 1", [SETTINGS_KEY]);
    const stored = rows[0]?.value as Partial<AiProviderSettings> | undefined;
    if (!stored?.providers) return DEFAULT_AI_PROVIDER_SETTINGS;
    const merged = structuredClone(DEFAULT_AI_PROVIDER_SETTINGS);
    for (const id of AI_PROVIDER_IDS) {
      const next = stored.providers[id];
      if (!next || typeof next !== "object") continue;
      merged.providers[id] = {
        enabled: next.enabled !== false,
        priority: Number.isFinite(Number(next.priority)) ? Math.max(1, Math.min(99, Number(next.priority))) : merged.providers[id].priority,
        models: Object.fromEntries(TASKS.map((task) => {
          const candidate = next.models?.[task];
          return [task, typeof candidate === "string" && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(candidate) ? candidate : merged.providers[id].models[task]];
        })) as Record<AiTask, string>,
      };
    }
    return merged;
  } catch {
    return DEFAULT_AI_PROVIDER_SETTINGS;
  }
}

export async function saveAiProviderSettings(value: AiProviderSettings): Promise<void> {
  const db = await database();
  await db.query(
    `INSERT INTO site_settings (key, value, updated_at) VALUES ($1, $2::jsonb, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [SETTINGS_KEY, JSON.stringify(value)],
  );
}

export function providerKey(id: AiProviderId): string {
  const names: Record<AiProviderId, string[]> = {
    google: ["GOOGLE_AI_API_KEY", "GEMINI_API_KEY"],
    grok: ["GROK_API_KEY"],
    mistral: ["MISTRAL_API_KEY"],
    openrouter: ["OPENROUTER_API_KEY"],
  };
  for (const name of names[id]) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return "";
}

export async function checkProviderConnection(id: AiProviderId): Promise<"missing" | "connected" | "error"> {
  const key = providerKey(id);
  if (!key) return "missing";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const google = id === "google";
    const url = google ? "https://generativelanguage.googleapis.com/v1beta/models" : ({
      grok: key.startsWith("gsk_") ? "https://api.groq.com/openai/v1/models" : "https://api.x.ai/v1/models",
      mistral: "https://api.mistral.ai/v1/models",
      openrouter: "https://openrouter.ai/api/v1/models",
    } as const)[id];
    const response = await fetch(url, {
      headers: google ? { "x-goog-api-key": key } : { authorization: `Bearer ${key}` },
      signal: controller.signal,
    });
    return response.ok ? "connected" : "error";
  } catch {
    return "error";
  } finally {
    clearTimeout(timeout);
  }
}
