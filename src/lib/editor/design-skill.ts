/**
 * Binding between NASAQ template generation and the media-system skill.
 *
 * The doctrine lives in `.grok/skills/nasaq-media/SKILL.md`. This module
 * does not design pages and does not add a catalog. Generators call
 * `bindDesignSkill` as they load so the skill is a dependency of the
 * workflow, not an unused note.
 */

export const NASAQ_DESIGN_SKILL = {
  id: "nasaq-media",
  path: ".grok/skills/nasaq-media/SKILL.md",
} as const;

export const DESIGN_SURFACES = ["layouts", "packs", "families", "products"] as const;

export type DesignSurface = (typeof DESIGN_SURFACES)[number];

const bound = new Set<DesignSurface>();

export function bindDesignSkill(surface: DesignSurface): typeof NASAQ_DESIGN_SKILL {
  bound.add(surface);
  return NASAQ_DESIGN_SKILL;
}

export function boundDesignSurfaces(): DesignSurface[] {
  return DESIGN_SURFACES.filter((surface) => bound.has(surface));
}
