/**
 * Panel grouping — the six editor windows can share ONE window as tabs.
 *
 * Authors kept asking for «أدوات التقرير» and «الخصائص» and «المكتبة» to live in
 * the same place instead of six floating cards. This module is the pure model
 * behind that: a partition of the six panel ids into groups. The FIRST member
 * of a group is its host — the window that renders the group's tab strip — so
 * a group is never an extra object floating beside the panels it contains.
 *
 * Rules the model guarantees (and the tests pin):
 *   • every panel id appears in exactly one group,
 *   • the host is always the group's first member,
 *   • a group never keeps a duplicate id; unknown ids from storage are dropped
 *     and missing ids are added back as their own group,
 *   • moving a host that still has members promotes its next member, so a
 *     window never loses the tabs it was holding.
 *
 * Free of React and browser globals at module scope so the plain Node test
 * runner can exercise it, matching the other editor modules.
 */

export type EditorPanelId =
  | "library"
  | "tools"
  | "elements"
  | "properties"
  | "layers"
  | "report";

export const EDITOR_PANEL_IDS: readonly EditorPanelId[] = [
  "library",
  "tools",
  "elements",
  "properties",
  "layers",
  "report",
];

/** host id → the tabs that window holds, host first. */
export type PanelGroups = Record<EditorPanelId, EditorPanelId[]>;

/** Which tab is showing inside each host window. */
export type PanelGroupTabs = Record<EditorPanelId, EditorPanelId>;

export interface PanelGroupState {
  groups: PanelGroups;
  /** Active tab per host window; always one of that host's members. */
  tabs: PanelGroupTabs;
}

/*
 * v3: أدوات التقرير joins الخصائص والطبقات. Bumping the key resets every
 * author to the new arrangement once; their own regrouping is remembered
 * from then on.
 */
const STORAGE_KEY = "nasaq.panel.groups.v3";

/**
 * The two windows the editor opens with, as separate groups of tabs:
 *   • the RIGHT window — لوحة العناصر, then أدوات العناصر and المكتبة,
 *   • the LEFT window — الخصائص, then الطبقات and أدوات التقرير.
 * Hosts lead their groups, so `elements` and `properties` are the windows.
 */
export const WORKSPACE_RIGHT_GROUP: readonly EditorPanelId[] = [
  "elements",
  "tools",
  "library",
];
export const WORKSPACE_LEFT_GROUP: readonly EditorPanelId[] = [
  "properties",
  "layers",
  "report",
];

function isPanelId(value: unknown): value is EditorPanelId {
  return (
    typeof value === "string" && (EDITOR_PANEL_IDS as string[]).includes(value)
  );
}

/** Every panel alone in its own window — the shipped default. */
export function defaultPanelGroups(): PanelGroupState {
  const groups = {} as PanelGroups;
  const tabs = {} as PanelGroupTabs;
  for (const id of EDITOR_PANEL_IDS) {
    groups[id] = [id];
    tabs[id] = id;
  }
  return { groups, tabs };
}

/** The grouped default the editor opens with (two windows, see above). */
export function defaultWorkspaceGroups(): PanelGroupState {
  const right = WORKSPACE_RIGHT_GROUP[0];
  const left = WORKSPACE_LEFT_GROUP[0];
  return {
    groups: {
      [right]: [...WORKSPACE_RIGHT_GROUP],
      [left]: [...WORKSPACE_LEFT_GROUP],
    } as PanelGroups,
    tabs: { [right]: right, [left]: left } as PanelGroupTabs,
  };
}

/**
 * Normalise anything (parsed storage, hand-edited JSON) into a valid state.
 * Unknown ids are dropped, duplicates keep their first appearance, and any
 * panel the input forgot becomes its own group again.
 */
export function parsePanelGroups(raw: unknown): PanelGroupState {
  const base = defaultPanelGroups();
  if (!raw || typeof raw !== "object") return base;
  const stored = raw as { groups?: unknown; tabs?: unknown };
  if (!stored.groups || typeof stored.groups !== "object") return base;

  const seen = new Set<EditorPanelId>();
  const groups = {} as PanelGroups;
  const order: EditorPanelId[] = [];
  for (const [host, members] of Object.entries(
    stored.groups as Record<string, unknown>,
  )) {
    if (!isPanelId(host) || !Array.isArray(members) || seen.has(host)) continue;
    const list: EditorPanelId[] = [];
    // The host leads its own group, even if storage lost it.
    list.push(host);
    seen.add(host);
    for (const member of members) {
      if (!isPanelId(member) || seen.has(member)) continue;
      seen.add(member);
      list.push(member);
    }
    groups[host] = list;
    order.push(host);
  }
  // Anything storage forgot (a panel added later, a corrupt row) comes back
  // as its own window rather than vanishing from the UI.
  for (const id of EDITOR_PANEL_IDS)
    if (!seen.has(id)) {
      groups[id] = [id];
      order.push(id);
    }
  // Drop hosts that ended up empty (cannot happen above, but keep the type
  // honest for callers that build states by hand).
  for (const host of order) if (!groups[host]?.length) delete groups[host];

  const tabs = {} as PanelGroupTabs;
  const storedTabs =
    stored.tabs && typeof stored.tabs === "object"
      ? (stored.tabs as Record<string, unknown>)
      : {};
  for (const host of EDITOR_PANEL_IDS) {
    const members = groups[host];
    if (!members) continue;
    const wanted = storedTabs[host];
    tabs[host] = isPanelId(wanted) && members.includes(wanted) ? wanted : host;
  }
  return { groups, tabs };
}

export function loadPanelGroups(): PanelGroupState {
  if (typeof window === "undefined") return defaultWorkspaceGroups();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return defaultWorkspaceGroups();
    return parsePanelGroups(JSON.parse(raw));
  } catch {
    return defaultWorkspaceGroups();
  }
}

export function savePanelGroups(state: PanelGroupState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* the session keeps the grouping in memory */
  }
}

/** The window that currently holds `id` (its host). */
export function hostOf(state: PanelGroupState, id: EditorPanelId): EditorPanelId {
  for (const host of EDITOR_PANEL_IDS)
    if (state.groups[host]?.includes(id)) return host;
  return id;
}

/** True when the window renders a tab strip (it holds more than itself). */
export function isGrouped(state: PanelGroupState, host: EditorPanelId): boolean {
  return (state.groups[host]?.length ?? 1) > 1;
}

/**
 * Move `tab` into the window hosted by `target`, at `index` (default: last).
 * Index counts positions among the target's members AFTER the host, so 0 puts
 * the tab right after the host's own tab.
 *
 * Hosts keep their window: dragging the host tab of a grouped window into
 * another window promotes the next member to host, so the tabs left behind
 * stay together in one window instead of scattering.
 */
export function movePanelTab(
  state: PanelGroupState,
  tab: EditorPanelId,
  target: EditorPanelId,
  index?: number,
): PanelGroupState {
  if (!state.groups[target] || tab === target) return state;
  const from = hostOf(state, tab);
  if (from === target) {
    // Reorder inside the same window: rebuild that member list.
    const members = state.groups[target].filter((m) => m !== tab);
    const at = Math.max(
      1,
      Math.min(members.length, (index ?? members.length) + 0),
    );
    members.splice(at, 0, tab);
    return {
      ...state,
      groups: { ...state.groups, [target]: members },
    };
  }

  const groups: PanelGroups = { ...state.groups };
  const tabs: PanelGroupTabs = { ...state.tabs };
  removeFromGroup(groups, tabs, from, tab);

  const targetMembers = [...groups[target]];
  const at = Math.max(
    1,
    Math.min(targetMembers.length, index ?? targetMembers.length),
  );
  targetMembers.splice(at, 0, tab);
  groups[target] = targetMembers;

  // The moved tab becomes visible in its new window.
  tabs[target] = tab;
  fixTabs(groups, tabs);
  return { groups, tabs };
}

/**
 * Take `tab` out of its group, re-keying the group to its new host when the
 * leaving tab was the host itself (the host leads its group, always).
 */
function removeFromGroup(
  groups: PanelGroups,
  tabs: PanelGroupTabs,
  from: EditorPanelId,
  tab: EditorPanelId,
): void {
  const sourceMembers = groups[from].filter((m) => m !== tab);
  const previous = tabs[from];
  delete groups[from];
  delete tabs[from];
  if (!sourceMembers.length) return;
  const nextHost = sourceMembers[0];
  groups[nextHost] = sourceMembers;
  // The window keeps showing whatever it was showing, if that still exists.
  tabs[nextHost] =
    previous && sourceMembers.includes(previous) ? previous : nextHost;
}

/** Every surviving window shows a tab it actually holds. */
function fixTabs(groups: PanelGroups, tabs: PanelGroupTabs): void {
  for (const host of EDITOR_PANEL_IDS)
    if (groups[host] && !groups[host].includes(tabs[host]))
      tabs[host] = groups[host][0];
}

/** Give `tab` its own window again (the reverse of a drop). */
export function detachPanelTab(
  state: PanelGroupState,
  tab: EditorPanelId,
): PanelGroupState {
  const from = hostOf(state, tab);
  if (from === tab) return state;
  const groups: PanelGroups = { ...state.groups };
  const tabs: PanelGroupTabs = { ...state.tabs };
  removeFromGroup(groups, tabs, from, tab);
  groups[tab] = [tab];
  tabs[tab] = tab;
  fixTabs(groups, tabs);
  return { groups, tabs };
}

/** Open `tab`: returns the host window to raise + the tab to show in it. */
export function openPanelTab(
  state: PanelGroupState,
  tab: EditorPanelId,
): { host: EditorPanelId; tab: EditorPanelId } {
  const host = hostOf(state, tab);
  return { host, tab };
}
