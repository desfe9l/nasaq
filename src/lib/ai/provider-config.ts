export const AI_PROVIDER_IDS = ["google", "grok", "mistral", "openrouter"] as const;
export type AiProviderId = (typeof AI_PROVIDER_IDS)[number];
export type AiTask = "default" | "report" | "design" | "selection" | "image";
export type AiProviderSettings = {
  providers: Record<AiProviderId, { enabled: boolean; priority: number; models: Record<AiTask, string> }>;
};

export const DEFAULT_AI_PROVIDER_SETTINGS: AiProviderSettings = {
  providers: {
    google: { enabled: true, priority: 1, models: { default: "gemini-2.5-flash", report: "gemini-2.5-flash", design: "gemini-2.5-flash", selection: "gemini-2.5-flash", image: "gemini-2.5-flash" } },
    grok: { enabled: true, priority: 2, models: { default: "grok-3-mini", report: "grok-3-mini", design: "grok-3-mini", selection: "grok-3-mini", image: "grok-3-mini" } },
    mistral: { enabled: true, priority: 3, models: { default: "mistral-small-latest", report: "mistral-small-latest", design: "mistral-small-latest", selection: "mistral-small-latest", image: "mistral-small-latest" } },
    openrouter: { enabled: true, priority: 4, models: { default: "openrouter/free", report: "openrouter/free", design: "openrouter/free", selection: "openrouter/free", image: "openrouter/free" } },
  },
};
