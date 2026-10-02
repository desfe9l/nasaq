# NASAQ project instructions

NASAQ is a premium Arabic-first RTL institutional design platform. It is not a
generic document builder, a Canva clone, or an AI template generator.

## Template and document design

Before creating, redesigning, reviewing, or refining any template, page, pack,
family, or product master, open `.grok/skills/nasaq-design/SKILL.md` and follow
it. That skill is the art-direction source of truth.

Edit the existing generators only:

- `src/lib/editor/templates.ts`
- `src/lib/editor/template-families.ts`
- `src/lib/editor/template-layouts.ts`
- `src/lib/editor/product-templates.ts`

Do not throw existing templates away, and do not add a parallel replacement
catalog. Pages stay real editable NASAQ elements. Five excellent pages beat
thirty mediocre ones.

`src/lib/editor/design-skill.ts` binds those generators to the skill. Do not
remove `bindDesignSkill`.
