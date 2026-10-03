/**
 * Configuration and customization for the Studio Tool Dock.
 * Photoshop-style customization: reorder, hide/show, categories (including Extra Tools), and restore defaults.
 */

export interface ToolDockItemConfig {
  id: string;
  visible: boolean;
  order: number;
  category: "primary" | "media" | "panels" | "extra";
}

export interface ToolDockDefinition {
  id: string;
  label: string;
  shortcut: string;
  category: "primary" | "media" | "panels" | "extra";
}

export const TOOL_DEFINITIONS: ToolDockDefinition[] = [
  { id: "select", label: "تحديد وتحريك", shortcut: "V", category: "primary" },
  { id: "text", label: "نص بالرسم", shortcut: "T", category: "primary" },
  { id: "shape", label: "رسم مربع / أشكال", shortcut: "R", category: "primary" },
  { id: "image", label: "الوسائط والصور", shortcut: "", category: "media" },
  { id: "files", label: "ملفات المشروع (.nsq)", shortcut: "⌘O", category: "media" },
  { id: "layers", label: "الطبقات", shortcut: "", category: "panels" },
  { id: "properties", label: "الخصائص والتنسيق", shortcut: "", category: "panels" },
  { id: "colors", label: "لوحة الألوان", shortcut: "", category: "panels" },
  { id: "connectors", label: "الموصلات والخطوط", shortcut: "", category: "extra" },
];

export const DEFAULT_TOOL_DOCK_CONFIG: ToolDockItemConfig[] = TOOL_DEFINITIONS.map(
  (def, index) => ({
    id: def.id,
    visible: true,
    order: index,
    category: def.category,
  }),
);

const STORAGE_KEY = "nasaq.tool-dock.config-v1";

export function loadToolDockConfig(): ToolDockItemConfig[] {
  if (typeof window === "undefined") return DEFAULT_TOOL_DOCK_CONFIG;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_TOOL_DOCK_CONFIG;
    const parsed = JSON.parse(raw) as ToolDockItemConfig[];
    if (!Array.isArray(parsed)) return DEFAULT_TOOL_DOCK_CONFIG;
    // Merge with any newly added tool definitions
    const knownIds = new Set(parsed.map((p) => p.id));
    const merged = [...parsed];
    for (const def of TOOL_DEFINITIONS) {
      if (!knownIds.has(def.id)) {
        merged.push({
          id: def.id,
          visible: true,
          order: merged.length,
          category: def.category,
        });
      }
    }
    return merged.sort((a, b) => a.order - b.order);
  } catch {
    return DEFAULT_TOOL_DOCK_CONFIG;
  }
}

export function saveToolDockConfig(config: ToolDockItemConfig[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    /* Storage disabled or unavailable */
  }
}

export function resetToolDockConfig(): ToolDockItemConfig[] {
  if (typeof window === "undefined") return DEFAULT_TOOL_DOCK_CONFIG;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* Ignore */
  }
  return DEFAULT_TOOL_DOCK_CONFIG;
}
