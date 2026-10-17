import type { LucideIcon } from "lucide-react";
import {
  Blocks,
  FileText,
  Files,
  FolderOpen,
  Layers,
  LayoutTemplate,
  Palette,
  PencilRuler,
  Settings2,
  Shapes,
  SlidersHorizontal,
  Type,
} from "lucide-react";
import type { LeftTab, RightTab } from "@/lib/editor/store";

/**
 * Main tabs of the two side panels. Shared by each panel's tab header and by
 * the collapsed icon dock, so both always show the same tabs in the same order.
 */
export const LEFT_PANEL_TABS: { id: LeftTab; label: string; icon: LucideIcon }[] = [
  { id: "library", label: "المكتبة", icon: FolderOpen },
  { id: "tools", label: "أدوات العناصر", icon: PencilRuler },
  { id: "elements", label: "العناصر", icon: Blocks },
  { id: "shapes", label: "المستند والتخطيط", icon: Shapes },
  { id: "templates", label: "قوالب", icon: LayoutTemplate },
  { id: "pages", label: "صفحات", icon: Files },
  { id: "theme", label: "المظهر", icon: Palette },
  { id: "fonts", label: "خطوط", icon: Type },
];

export const RIGHT_PANEL_TABS: { id: RightTab; label: string; icon: LucideIcon }[] = [
  { id: "properties", label: "خصائص", icon: SlidersHorizontal },
  { id: "layers", label: "طبقات", icon: Layers },
];

/**
 * One look for every editor window: title + icon. Shared by the tab strip,
 * the window headers and the dock, so a grouped window reads as the same
 * six panels, never as new surfaces.
 */
export const PANEL_META: Record<
  import("@/lib/editor/panel-groups").EditorPanelId,
  { title: string; icon: LucideIcon }
> = {
  library: { title: "المكتبة", icon: FolderOpen },
  tools: { title: "أدوات العناصر", icon: PencilRuler },
  elements: { title: "لوحة العناصر", icon: Blocks },
  properties: { title: "الخصائص", icon: SlidersHorizontal },
  settings: { title: "الإعدادات", icon: Settings2 },
  layers: { title: "الطبقات", icon: Layers },
  report: { title: "أدوات التقرير", icon: FileText },
};
