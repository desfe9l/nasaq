import { Moon, Sun, SunDim, SunMoon } from "lucide-react";
import { useEditor } from "@/lib/editor/store";
import type { AppearanceMode } from "@/lib/theme";
import { AnchorMenu, MenuGroup, MenuRow } from "./ui/AnchorMenu";
import { IconButton } from "./ui/IconButton";

/**
 * «المظهر» — the permanent, icon-first appearance switch of the toolbar.
 *
 * The three interface modes (فاتح، خافت، داكن) already live deep inside «عرض»
 * and the settings dialog; this control puts them one tap away without adding
 * a single pixel of toolbar height. The trigger is one IconButton cell — the
 * same box as every other header control — whose glyph mirrors the LIVE mode
 * (sun / dimmed sun / moon), so the current state is readable at a glance.
 * Opening it anchors the standard menu: three checked rows, each with its own
 * glyph and a one-line hint, closing on selection. Persistence is untouched —
 * it writes the same `setAppearance` the rest of the studio uses, which stores
 * the choice and syncs it across the site. Tooltips come from IconButton
 * (hover on pointer devices, long-press on touch), so the control explains
 * itself on desktop and iPad alike.
 */
const MODES: {
  id: AppearanceMode;
  label: string;
  hint: string;
  Icon: typeof Sun;
}[] = [
  { id: "light", label: "فاتح", hint: "واجهة مضيئة للنهار", Icon: Sun },
  { id: "dark", label: "داكن", hint: "واجهة معتمة لليل", Icon: Moon },
  {
    id: "dim",
    label: "خافت",
    hint: "إضاءة متوسطة مريحة للعين",
    Icon: SunDim,
  },
];

export function AppearanceMenu() {
  const appearance = useEditor((s) => s.appearance);
  const setAppearance = useEditor((s) => s.setAppearance);
  const current = MODES.find((m) => m.id === appearance) ?? MODES[0];
  const CurrentIcon = current.Icon ?? SunMoon;

  return (
    <AnchorMenu
      label="مظهر مساحة العمل"
      width={224}
      trigger={({ ref, ...props }) => (
        <IconButton
          {...props}
          ref={ref}
          label="المظهر"
          hint={`الوضع الحالي: ${current.label} — فاتح، خافت أو داكن`}
          icon={<CurrentIcon className="size-4" strokeWidth={1.7} />}
          data-tour="appearance"
        />
      )}
    >
      <MenuGroup title="مظهر مساحة العمل" />
      {MODES.map(({ id, label, hint, Icon }) => (
        <MenuRow
          key={id}
          icon={<Icon className="size-4" strokeWidth={1.7} />}
          label={label}
          hint={hint}
          checked={appearance === id}
          onSelect={() => setAppearance(id)}
        />
      ))}
    </AnchorMenu>
  );
}
