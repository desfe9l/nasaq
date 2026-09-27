import { useEffect, useState } from "react";
import { Toaster, type ToasterProps } from "sonner";
import { readStoredTheme, subscribeTheme } from "@/lib/theme";

/**
 * Toast host that follows the site theme.
 *
 * `sonner` paints its own surface (background, border, close button, description)
 * from the `theme` prop, and it cannot read a CSS variable — left at its default
 * it rendered a white card over a Dark page, i.e. exactly the "element that does
 * not adapt" bug the theme tokens exist to prevent. The mode comes from the one
 * source of truth (`lib/theme.ts`), so a toggle anywhere in the app re-skins the
 * toasts without a reload.
 */
export function ThemedToaster(props: ToasterProps) {
  const [dark, setDark] = useState(() => readStoredTheme() === true);
  useEffect(() => subscribeTheme(setDark), []);
  return <Toaster theme={dark ? "dark" : "light"} {...props} />;
}
