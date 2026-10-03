export interface ImageAnalysisInput {
  imageData: string;
  language: "ar" | "en";
}

export interface ImageAnalysis {
  description: string;
  recognizedText: string;
  objects: string[];
}

export type ImageAnalysisResult =
  | { ok: true; analysis: ImageAnalysis }
  | {
      ok: false;
      code:
        | "invalid"
        | "license_required"
        | "not_configured"
        | "rate_limited"
        | "provider_error";
      message: string;
    };

const MAX_IMAGE_BYTES = 1_500_000;

export function normalizeImageAnalysisInput(
  input: Partial<ImageAnalysisInput>,
): ImageAnalysisInput | null {
  if (typeof input.imageData !== "string") return null;
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(
    input.imageData,
  );
  if (!match || match[2].length % 4 !== 0) return null;
  const estimatedBytes = (match[2].length / 4) * 3 - (match[2].endsWith("==") ? 2 : match[2].endsWith("=") ? 1 : 0);
  if (estimatedBytes <= 0 || estimatedBytes > MAX_IMAGE_BYTES) return null;
  return {
    imageData: input.imageData,
    language: input.language === "en" ? "en" : "ar",
  };
}

export function normalizeImageAnalysis(value: unknown): ImageAnalysis {
  const raw =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  return {
    description:
      typeof raw.description === "string" ? raw.description.trim().slice(0, 1200) : "",
    recognizedText:
      typeof raw.recognizedText === "string"
        ? raw.recognizedText.trim().slice(0, 8000)
        : "",
    objects: Array.isArray(raw.objects)
      ? raw.objects
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.trim().slice(0, 120))
          .filter(Boolean)
          .slice(0, 20)
      : [],
  };
}
