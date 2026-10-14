/**
 * Panel grouping — editor surfaces can share ONE window as tabs; Settings stays pinned beside Properties.
 *
 * Authors kept asking for «أدوات التقرير» and «الخصائص» and «المكتبة» to live in
 * the same place instead of several floating cards. This module is the pure model
 * behind that: a partition of the editor panel ids into groups. The FIRST member
 * of a group is its host — the window that renders the group's tab strip — so
 * a group is never an extra object floating beside the panels it contains.
 *
 * Rules the model guarantees (and the tests pin):
 *   • every panel id appears in exactly one group,
 *   • the host is always the group's first member,
 *   • a group never keeps a duplicate id; unknown ids from storage are dropped
 *     and missing ids are restored, with Settings pinned beside Properties,
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
  | "settings"
  | "layers"
  | "report";

export const EDITOR_PANEL_IDS: readonly EditorPanelId[] = [
  "library",
  "tools",
  "elements",
  "properties",
  "settings",
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
 *   • the LEFT window — الخصائص and pinned الإعدادات, then الطبقات and أدوات التقرير.
 * Hosts lead their groups, so `elements` and `properties` are the windows.
 */
export const WORKSPACE_RIGHT_GROUP: readonly EditorPanelId[] = [
  "elements",
  "tools",
  "library",
];
export const WORKSPACE_LEFT_GROUP: readonly EditorPanelId[] = [
  "properties",
  "settings",
  "layers",
  "report",
];

/**
 * Remove a window key entirely. `PanelGroups`/`PanelGroupTabs` are total records,
 * so dropping a window is a deliberate key deletion the mapped type cannot
 * express as an optional property.
 */
function dropHost(
  groups: PanelGroups,
  tabs: PanelGroupTabs,
  host: EditorPanelId,
): void {
  delete (groups as Partial<PanelGroups>)[host];
  delete (tabs as Partial<PanelGroupTabs>)[host];
}

/** Keep the Settings surface permanently adjacent to Properties in every layout. */
function pinSettingsToProperties(
  groups: PanelGroups,
  tabs: PanelGroupTabs,
): void {
  let propertyHost = EDITOR_PANEL_IDS.find((host) =>
    groups[host]?.includes("properties"),
  );
  if (!propertyHost) {
    propertyHost = "properties";
    groups.properties = ["properties"];
    tabs.properties = "properties";
  }

  const settingsHost = EDITOR_PANEL_IDS.find((host) =>
    groups[host]?.includes("settings"),
  );
  const settingsWasActive = Boolean(
    settingsHost && tabs[settingsHost] === "settings",
  );

  // A stored/custom layout may have Settings in a different group. Move it
  // back beside Properties, preserving any other tabs and the active tab.
  if (settingsHost && settingsHost !== propertyHost) {
    const source: EditorPanelId[] = groups[settingsHost].filter(
      (id) => id !== "settings",
    );
    const previous = tabs[settingsHost];
    dropHost(groups, tabs, settingsHost);
    if (source.length) {
      const nextHost = source[0];
      groups[nextHost] = source;
      tabs[nextHost] = previous && source.includes(previous) ? previous : nextHost;
    }
  }

  // In the unlikely event of corrupt storage making Settings the host, re-key
  // that group to Properties so the pinned tab can never become a window.
  if (propertyHost === "settings") {
    const source: EditorPanelId[] = groups.settings.filter(
      (id) => id !== "settings" && id !== "properties",
    );
    const previous = tabs.settings;
    dropHost(groups, tabs, "settings");
    groups.properties = ["properties", "settings", ...source];
    tabs.properties =
      previous === "settings" || previous === "properties"
        ? previous
        : "properties";
    return;
  }

  const members = [...groups[propertyHost]];
  const remaining = members.filter(
    (id) => id !== "settings" && id !== "properties",
  );
  const propertyIndex = members.indexOf("properties");
  members.splice(0, members.length, ...remaining);
  members.splice(Math.max(0, propertyIndex), 0, "properties", "settings");
  groups[propertyHost] = members;
  if (settingsWasActive) tabs[propertyHost] = "settings";
  else if (!members.includes(tabs[propertyHost])) tabs[propertyHost] = "properties";
}

function isPanelId(value: unknown): value is EditorPanelId {
  return (
    typeof value === "string" && (EDITOR_PANEL_IDS as string[]).includes(value)
  );
}

/** Standalone windows by default, with Settings pinned beside Properties. */
export function defaultPanelGroups(): PanelGroupState {
  const groups = {} as PanelGroups;
  const tabs = {} as PanelGroupTabs;
  for (const id of EDITOR_PANEL_IDS) {
    if (id === "settings") continue;
    groups[id] = id === "properties" ? ["properties", "settings"] : [id];
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
 * Unknown ids are dropped, duplicates keep their first appearance, and missing
 * panels are restored. Settings is always reunited with Properties.
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
    if (id !== "settings" && !seen.has(id)) {
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
  pinSettingsToProperties(groups, tabs);
  fixTabs(groups, tabs);
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
  // Settings is a permanently pinned companion to Properties, never a
  // draggable/detachable panel of its own.
  if (!state.groups[target] || tab === target || tab === "settings" || target === "settings")
    return state;

  const from = hostOf(state, tab);
  const groups: PanelGroups = { ...state.groups };
  const tabs: PanelGroupTabs = { ...state.tabs };

  if (tab === "properties") {
    if (from === target) {
      const members: EditorPanelId[] = groups[target].filter(
        (member) => member !== "properties" && member !== "settings",
      );
      const at = Math.max(1, Math.min(members.length, index ?? members.length));
      members.splice(at, 0, "properties", "settings");
      groups[target] = members;
    } else {
      const settingsWasActive = tabs[from] === "settings";
      const sourceMembers: EditorPanelId[] = groups[from].filter(
        (member) => member !== "properties" && member !== "settings",
      );
      const previous = tabs[from];
      delete groups[from];
      delete tabs[from];
      if (sourceMembers.length) {
        const nextHost = sourceMembers[0];
        groups[nextHost] = sourceMembers;
        tabs[nextHost] =
          previous && sourceMembers.includes(previous) ? previous : nextHost;
      }
      const targetMembers = [...groups[target]];
      const at = Math.max(
        1,
        Math.min(targetMembers.length, index ?? targetMembers.length),
      );
      targetMembers.splice(at, 0, "properties", "settings");
      groups[target] = targetMembers;
      tabs[target] = settingsWasActive ? "settings" : "properties";
    }
    pinSettingsToProperties(groups, tabs);
    fixTabs(groups, tabs);
    return { groups, tabs };
  }

  if (from === target) {
    const members = groups[target].filter((member) => member !== tab);
    const at = Math.max(
      1,
      Math.min(members.length, (index ?? members.length) + 0),
    );
    members.splice(at, 0, tab);
    groups[target] = members;
  } else {
    removeFromGroup(groups, tabs, from, tab);
    const targetMembers = [...groups[target]];
    const at = Math.max(
      1,
      Math.min(targetMembers.length, index ?? targetMembers.length),
    );
    targetMembers.splice(at, 0, tab);
    groups[target] = targetMembers;
    tabs[target] = tab;
  }

  pinSettingsToProperties(groups, tabs);
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
  if (tab === "settings") return state;
  const from = hostOf(state, tab);
  if (from === tab && tab !== "properties") return state;
  const groups: PanelGroups = { ...state.groups };
  const tabs: PanelGroupTabs = { ...state.tabs };

  if (tab === "properties") {
    const previous = tabs[from];
    const sourceMembers: EditorPanelId[] = groups[from].filter(
      (member) => member !== "properties" && member !== "settings",
    );
    delete groups[from];
    delete tabs[from];
    if (sourceMembers.length) {
      const nextHost = sourceMembers[0];
      groups[nextHost] = sourceMembers;
      tabs[nextHost] =
        previous && sourceMembers.includes(previous) ? previous : nextHost;
    }
    groups.properties = ["properties", "settings"];
    tabs.properties = previous === "settings" ? "settings" : "properties";
  } else {
    removeFromGroup(groups, tabs, from, tab);
    groups[tab] = [tab];
    tabs[tab] = tab;
  }

  pinSettingsToProperties(groups, tabs);
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
