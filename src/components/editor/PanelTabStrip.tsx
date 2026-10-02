import { ExternalLink } from "lucide-react";
import type { EditorPanelId, PanelGroupState } from "@/lib/editor/panel-groups";
import { PANEL_META } from "./panel-tabs";
import { cn } from "@/lib/utils";

export { PANEL_META };

/**
 * The tab strip a window grows when it hosts more than one panel.
 *
 * Tabs are drag sources AND the strip is a drop target, so grouping is a
 * plain drag: pull «الخصائص» onto «أدوات التقرير» and they share one window.
 * A single-member window still renders the strip (quietly), because that is
 * the drop zone the FIRST drag needs to find.
 */
export function PanelTabStrip({
  host,
  state,
  onSelect,
  onDropTab,
  onDetach,
}: {
  host: EditorPanelId;
  state: PanelGroupState;
  onSelect: (tab: EditorPanelId) => void;
  onDropTab: (tab: EditorPanelId, host: EditorPanelId) => void;
  onDetach: (tab: EditorPanelId) => void;
}) {
  const members = state.groups[host] ?? [host];
  const active = state.tabs[host] ?? host;
  const grouped = members.length > 1;
  return (
    <div
      className="panel-tab-strip"
      role="tablist"
      aria-label={`تبويبات نافذة ${PANEL_META[host].title}`}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("text/nasaq-panel"))
          event.preventDefault();
      }}
      onDrop={(event) => {
        const tab = event.dataTransfer.getData("text/nasaq-panel");
        if (!tab) return;
        event.preventDefault();
        event.stopPropagation();
        onDropTab(tab as EditorPanelId, host);
      }}
    >
      {members.map((id) => {
        const meta = PANEL_META[id];
        const Icon = meta.icon;
        return (
          <div
            key={id}
            role="tab"
            aria-selected={id === active}
            tabIndex={0}
            draggable
            onDragStart={(event) => {
              event.dataTransfer.setData("text/nasaq-panel", id);
              event.dataTransfer.effectAllowed = "move";
            }}
            onClick={() => onSelect(id)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelect(id);
              }
            }}
            className={cn("panel-tab", id === active && "is-active")}
            title={`${meta.title} — اسحبه إلى نافذة أخرى للتجميع`}
          >
            <Icon className="size-3.5" aria-hidden />
            <span>{meta.title}</span>
            {grouped && id === active && (
              <button
                type="button"
                aria-label={`فك تجمع ${meta.title} في نافذة مستقلة`}
                title="فك التجمع — نافذة مستقلة"
                onClick={(event) => {
                  event.stopPropagation();
                  onDetach(id);
                }}
              >
                <ExternalLink className="size-3" aria-hidden />
              </button>
            )}
          </div>
        );
      })}
      {!grouped && (
        <span className="panel-tab-hint" aria-hidden>
          أفلت تبويبًا هنا لجمعه
        </span>
      )}
    </div>
  );
}
