# Share-card and Open Graph assets

Use the repository's existing identity in `src/lib/og/site.json` and the current
NASAQ art direction. Do not invent a new social URL, app name, or share-card
identity. The current NASAQ site already has a branded `public/og.jpg` and
site metadata; preserve those assets unless the task explicitly changes them.

For a custom card, generate or edit a single 1200×630 JPEG that matches the
actual product and stays below 600 KB. For canvas games, add `"type": "x:game"`
and a 1200×264 `public/x-banner.jpg`; ordinary product sites do not claim the
X game-card type. A custom card is declared with `"card": "custom"` in
`src/lib/og/site.json`.

## Brand-asset pass:

Work on the files that produce the card and its metadata. While a pass is
running, keep `/workspace/.grok/og-pending` fresh; the parent brand check treats
that marker as active for 10 minutes. No `wait_tasks` or `get_task_output` while
the asset pass is in progress; finish the independent source and verification
work without blocking on it. No `wait_tasks` or `get_task_output` after the
pass either; report the result through the task's normal completion channel.

Before finishing, run the relevant check for the product type:

```sh
node scripts/brand-check.mjs --placeholder-ok
```

A game or other canvas experience must use `--game` instead of the utility
placeholder flag:

```sh
node scripts/brand-check.mjs --game
```

The commands above are checks, not permission to waive a warning. A failed
custom-card pass is not complete; fix the asset or report the genuine tool
limitation.

See [handover.md](references/handover.md) for the staged-file contract.
