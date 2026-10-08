import type { Project } from "@/lib/editor/model";
import type { DesignStyle, PaletteRoles } from "./schema";
import { type PromptAnalysis } from "./prompt-analyzer";
import { generateFromIntent } from "./design-generator";
import { critiqueProject } from "./critic";
import { checkLayoutVariety, type LayoutVarietyReport } from "./layout-variety";
import { STYLE_PRESETS, type StylePreset, type StylePresetId } from "./style-presets";

export interface DesignVariation {
  id: StylePresetId;
  name: string;
  description: string;
  style: DesignStyle;
  badge: string;
  project: Project;
  score: number;
  palette: PaletteRoles;
  /** The full style preset behind this variation (type scale, spacing,
   * radius, shadow elevation, 60-30-10 palette rules, layout bias). */
  preset: StylePreset;
  /** Result of the Layout Variety Check over the generated pages. */
  layoutVariety: LayoutVarietyReport;
}

/**
 * The four architectural styles, one per preset:
 *
 *   · sovereign — «النمط المؤسسي السيادي»
 *   · executive — «النمط التنفيذي الحديث»
 *   · editorial — «النمط التحريري المعاصر»
 *   · digital   — «النمط التقني والتبسيطي»
 *
 * By default each variation carries its own palette AND its own layout bias,
 * which is how the studio offers four complete looks. When the author has an
 * institutional identity (`PaletteRoles` override), every variation is
 * generated in THAT palette: the four variations then differ in composition
 * and style values, not in colour — which is the whole point of an identity.
 */
export function generateVariations(
  baseIntent: PromptAnalysis,
  paletteOverride?: PaletteRoles,
): DesignVariation[] {
  const palette = (fallback: PaletteRoles) => paletteOverride ?? fallback;

  const build = (preset: StylePreset, style: DesignStyle): DesignVariation => {
    const variationIntent: PromptAnalysis = {
      ...baseIntent,
      style,
      palette: palette(preset.palette),
    };
    const project = generateFromIntent(variationIntent);
    const critique = critiqueProject(project);
    return {
      id: preset.id,
      name: preset.name,
      description: preset.description,
      style,
      badge: preset.badge,
      project,
      score: Math.max(preset.minScore, critique.score),
      palette: palette(preset.palette),
      preset,
      layoutVariety: checkLayoutVariety(project),
    };
  };

  return [
    build(STYLE_PRESETS.sovereign, "institutional"),
    build(STYLE_PRESETS.executive, "executive"),
    build(STYLE_PRESETS.editorial, "editorial"),
    build(STYLE_PRESETS.digital, "corporate"),
  ];
}
