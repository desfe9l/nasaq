import type { LucideIcon } from "lucide-react";
import {
  Baseline,
  FileText,
  FolderOpen,
  Layers,
  LayoutTemplate,
  Palette,
  Puzzle,
  Settings2,
  Shapes,
  SlidersHorizontal,
} from "lucide-react";
import type { LeftTab, RightTab } from "@/lib/editor/store";

/**
 * Main tabs of the two side panels. Shared by each panel's tab header and by
 * the collapsed icon dock, so both always show the same tabs in the same order.
 */
export const LEFT_PANEL_TABS: {
  id: LeftTab;
  label: string;
  /** Full name for tooltips/aria where the strip caption may truncate. */
  longLabel?: string;
  icon: LucideIcon;
}[] = [
  { id: "library", label: "المكتبة", icon: FolderOpen },
  {
    id: "elementTools",
    label: "الأدوات",
    longLabel: "أدوات العناصر",
    icon: Puzzle,
  },
  { id: "elements", label: "عناصر", icon: LayoutTemplate },
  { id: "shapes", label: "أشكال", icon: Shapes },
  { id: "templates", label: "قوالب", icon: FileText },
  { id: "pages", label: "صفحات", icon: Layers },
  { id: "theme", label: "سمة", icon: Palette },
  { id: "fonts", label: "خطوط", icon: Baseline },
  { id: "settings", label: "إعدادات", icon: Settings2 },
];

export const RIGHT_PANEL_TABS: { id: RightTab; label: string; icon: LucideIcon }[] = [
  { id: "properties", label: "خصائص", icon: SlidersHorizontal },
  { id: "layers", label: "طبقات", icon: Layers },
];
