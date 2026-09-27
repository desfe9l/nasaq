/** Physical letter keys preserve existing bindings on Arabic keyboards.
 * Symbols/digits keep their native key value; callers still own modifier rules. */
export function shortcutKey(event: { key: string; code: string }): string {
  return /^Key[A-Z]$/.test(event.code)
    ? event.code.slice(3).toLowerCase()
    : event.key.toLowerCase();
}

/** Readable shortcut hints on Windows/Linux and macOS, always rendered LTR. */
export function shortcutHint(
  hint: string,
  platform = typeof navigator === "undefined" ? "" : navigator.platform,
): string {
  return /Mac|iPad|iPhone/.test(platform)
    ? hint
    : hint
        .replaceAll("⌘", "Ctrl+")
        .replaceAll("⇧", "Shift+")
        .replace(/\+ /g, "+");
}
