import { ExternalLink } from "lucide-react";
import type { EditorPanelId, PanelGroupState } from "@/lib/editor/panel-groups";
import { PANEL_META } from "./panel-tabs";
import { cn } from "@/lib/utils";

export { PANEL_META };

/**
 * The tab strip a window grows when it hosts more than one panel.
 *
 * Settings is a fixed, non-draggable companion to Properties. The pair remains
 * pinned at the leading edge of the strip while the other tabs stay scrollable.
 */
export function PanelTabStrip({
  host,
  compact = false,
  state,
  onSelect,
  onDropTab,
  onDetach,
}: {
  host: EditorPanelId;
  compact?: boolean;
  state: PanelGroupState;
  onSelect: (tab: EditorPanelId) => void;
  onDropTab: (tab: EditorPanelId, host: EditorPanelId) => void;
  onDetach: (tab: EditorPanelId) => void;
}) {
  const members = state.groups[host] ?? [host];
  const active = state.tabs[host] ?? host;
  const grouped = members.length > 1;
  const renderTab = (id: EditorPanelId) => {
    const meta = PANEL_META[id];
    const Icon = meta.icon;
    const pinned = id === "settings";
    return (
      <div
        key={id}
        role="tab"
        aria-selected={id === active}
        tabIndex={0}
        draggable={!compact && !pinned}
        onDragStart={(event) => {
          if (pinned) {
            event.preventDefault();
            return;
          }
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
        title={
          pinned || compact
            ? meta.title
            : `${meta.title} — اسحبه إلى نافذة أخرى للتجميع`
        }
      >
        <Icon className="size-3.5" aria-hidden />
        <span>{meta.title}</span>
        {!compact && grouped && id === active && id !== "settings" && (
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
  };

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
        if (id === "settings") return null;
        if (id === "properties" && members.includes("settings"))
          return (
            <div
              key="pinned-properties-settings"
              role="presentation"
              className="panel-tab-pinned-group"
            >
              {renderTab("properties")}
              {renderTab("settings")}
            </div>
          );
        return renderTab(id);
      })}
      {!compact && !grouped && (
        <span className="panel-tab-hint" aria-hidden>
          أفلت تبويبًا هنا لجمعه
        </span>
      )}
    </div>
  );
}
