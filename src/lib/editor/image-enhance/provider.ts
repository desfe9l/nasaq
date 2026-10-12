/**
 * Provider registry for image enhancement.
 *
 * The editor asks `resolveProvider(op)` and never touches an engine directly,
 * so swapping or adding providers (e.g. a future server-side service reached
 * through an authenticated API route) is a registration, not a rebuild.
 * Providers registered later win when they support the op — that is the
 * intended override path for a hosted implementation.
 */
import type {
  EnhanceOp,
  EnhanceOutput,
  EnhanceProgressFn,
  EnhanceProvider,
  EnhanceInput,
} from "./types.ts";
import { EnhanceError } from "./types.ts";
import { runInWorker } from "./worker-bridge.ts";
import { checkEnhanceInput, outputMimeFor } from "./limits.ts";

/**
 * The in-browser provider: background removal and denoise both run in the
 * processing worker. Everything stays on the user's device.
 */
export const localEnhanceProvider: EnhanceProvider = {
  id: "local",
  supports(op: EnhanceOp): boolean {
    return op === "background" || op === "denoise";
  },
  async run(
    op: EnhanceOp,
    input: EnhanceInput,
    onProgress: EnhanceProgressFn,
  ): Promise<EnhanceOutput> {
    const limitError = checkEnhanceInput(op, input.width, input.height);
    if (limitError) throw limitError;

    /*
     * Both remaining ops are worker jobs: the contract is one call, and the
     * worker owns decode → process → encode. There is no in-page fallback
     * engine left to fall through to.
     */
    const result = await runInWorker(op, input, onProgress);
    return {
      blob: result.blob,
      width: result.width,
      height: result.height,
      mime: outputMimeFor(op, input.mime),
    };
  },
};

const providers: EnhanceProvider[] = [localEnhanceProvider];

/** Pure selection: first provider (by priority) that supports the op. */
export function pickProvider(
  list: readonly EnhanceProvider[],
  op: EnhanceOp,
): EnhanceProvider | undefined {
  return list.find((p) => p.supports(op));
}

/** Register an additional provider; later registrations take priority. */
export function registerEnhanceProvider(provider: EnhanceProvider): void {
  providers.unshift(provider);
}

/** Test/override hook: drop every non-local provider. */
export function resetEnhanceProviders(): void {
  providers.length = 0;
  providers.push(localEnhanceProvider);
}

export function listEnhanceProviders(): readonly EnhanceProvider[] {
  return providers;
}

/** Pick the provider that will actually run an op, if any. */
export function resolveProvider(op: EnhanceOp): EnhanceProvider | undefined {
  return pickProvider(providers, op);
}

/** Run an op through the resolved provider. */
export async function runEnhance(
  op: EnhanceOp,
  input: EnhanceInput,
  onProgress: EnhanceProgressFn,
): Promise<EnhanceOutput> {
  const provider = resolveProvider(op);
  if (!provider) {
    throw new EnhanceError(
      "provider_unavailable",
      "لا تتوفر خدمة معالجة لهذه العملية حاليًا",
    );
  }
  return provider.run(op, input, onProgress);
}
