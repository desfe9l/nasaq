import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  LIBRARY_KIND,
  LIBRARY_VERSION,
  buildLibraryFile,
  downloadLibraryFile,
  planLibraryImport,
} from "./library-export.ts";
import type { Asset, AssetFolder } from "./storage";

/**
 * The library EXPORT side. Import and the round trip are pinned in
 * library-manager.test.ts; this file guards what leaves the device: the file
 * is canonical (no device-private fields), JSON-stable, and the download path
 * produces a dated `.json` through a real anchor click.
 */

const PNG = "data:image/png;base64,iVBORw0KGgo=";

const folders: AssetFolder[] = [
  { id: "folder-uncategorized", name: "غير مصنّف", createdAt: 1 },
  { id: "f-logos", name: "شعارات", createdAt: 2, parentId: null },
  { id: "f-logos-mono", name: "أحادية", createdAt: 3, parentId: "f-logos" },
];

const assets: Asset[] = [
  {
    id: "a-1",
    name: "شعار",
    src: PNG,
    w: 120,
    h: 80,
    addedAt: 10,
    folderId: "f-logos",
    remoteId: "r2-object-123",
    contentHash: "deadbeef",
  },
  { id: "a-2", name: "ختم", src: PNG, w: 50, h: 50, addedAt: 11 },
];

test("library-export: the file carries only the canonical fields", () => {
  const file = buildLibraryFile({ folders, assets });
  assert.equal(file.kind, LIBRARY_KIND);
  assert.equal(file.version, LIBRARY_VERSION);
  assert.deepEqual(Object.keys(file), ["kind", "version", "folders", "assets"]);

  // Device-private bookkeeping (cloud mirror id, content hash) never leaves.
  for (const a of file.assets) {
    assert.deepEqual(Object.keys(a).sort(), ["addedAt", "folderId", "h", "id", "name", "src", "w"]);
    assert.ok(!("remoteId" in a));
    assert.ok(!("contentHash" in a));
  }
  for (const f of file.folders) {
    assert.deepEqual(Object.keys(f).sort(), ["createdAt", "id", "name", "parentId"]);
  }
});

test("library-export: missing folderId/parentId are normalised to null, not dropped", () => {
  const file = buildLibraryFile({ folders, assets });
  assert.equal(file.folders[0].parentId, null, "root folder without parentId → null");
  assert.equal(file.folders[2].parentId, "f-logos", "nesting is preserved");
  assert.equal(file.assets[1].folderId, null, "folderless asset → null");
  assert.equal(file.assets[0].folderId, "f-logos");
  // JSON keeps explicit nulls (undefined would vanish and break the reader).
  const json = JSON.parse(JSON.stringify(file));
  assert.equal(json.assets[1].folderId, null);
  assert.equal(json.folders[0].parentId, null);
});

test("library-export: order is preserved and the input is not mutated", () => {
  const snapshot = JSON.stringify({ folders, assets });
  const file = buildLibraryFile({ folders, assets });
  assert.deepEqual(
    file.folders.map((f) => f.id),
    ["folder-uncategorized", "f-logos", "f-logos-mono"],
  );
  assert.deepEqual(
    file.assets.map((a) => a.id),
    ["a-1", "a-2"],
  );
  assert.equal(JSON.stringify({ folders, assets }), snapshot);
  // Fresh objects: editing the export cannot reach the store rows.
  assert.notEqual(file.assets[0], assets[0]);
  assert.notEqual(file.folders[0], folders[0]);
});

test("library-export: an empty library is still a valid, importable file", () => {
  const file = buildLibraryFile({ folders: [], assets: [] });
  assert.deepEqual(file, { kind: LIBRARY_KIND, version: LIBRARY_VERSION, folders: [], assets: [] });
  const plan = planLibraryImport(JSON.parse(JSON.stringify(file)), { folders: [], assets: [] });
  assert.equal(plan.assets.length, 0);
  assert.equal(plan.skipped, 0);
});

test("library-export: the exported bytes import back with every asset placed", () => {
  const file = JSON.parse(JSON.stringify(buildLibraryFile({ folders, assets })));
  const plan = planLibraryImport(file, { folders: [], assets: [] });
  assert.equal(plan.assets.length, 2);
  const folderIds = new Set(plan.folders.map((f) => f.id));
  for (const a of plan.assets) {
    assert.ok(a.folderId && folderIds.has(a.folderId), `${a.name} lands in a real folder`);
  }
  // The folderless asset is classified into the default shelf, not lost.
  assert.equal(plan.assets.find((a) => a.name === "ختم")?.folderId, "folder-uncategorized");
});

/* ---------- download path (DOM stubbed) ---------- */

const g = globalThis as Record<string, unknown>;
const saved = { document: g.document, URL: g.URL, Blob: g.Blob };

afterEach(() => {
  g.document = saved.document;
  g.URL = saved.URL;
  g.Blob = saved.Blob;
});

test("library-export: downloadLibraryFile clicks a dated .json anchor and schedules the URL revoke", async () => {
  const events: string[] = [];
  let blobText = "";
  let blobType = "";
  const anchor: Record<string, unknown> = {
    click: () => events.push("click"),
    remove: () => events.push("remove"),
  };
  g.document = {
    createElement: (tag: string) => {
      events.push(`create:${tag}`);
      return anchor;
    },
    body: { appendChild: () => events.push("append") },
  };
  g.Blob = class {
    constructor(parts: string[], opts: { type: string }) {
      blobText = parts.join("");
      blobType = opts.type;
    }
  };
  let revoked = 0;
  g.URL = {
    createObjectURL: () => "blob:nasaq/library",
    revokeObjectURL: () => {
      revoked += 1;
    },
  };

  const name = downloadLibraryFile({ folders, assets });

  assert.match(name, /^nasaq-library-\d{4}-\d{2}-\d{2}\.json$/);
  assert.equal(anchor.href, "blob:nasaq/library");
  assert.equal(anchor.download, name);
  assert.deepEqual(events, ["create:a", "append", "click", "remove"]);
  assert.equal(blobType, "application/json");
  const parsed = JSON.parse(blobText);
  assert.equal(parsed.kind, LIBRARY_KIND);
  assert.equal(parsed.assets.length, 2);
  assert.ok(!blobText.includes("r2-object-123"), "cloud ids never reach the download");
  // Revocation is deferred (the click must have consumed the URL first).
  assert.equal(revoked, 0);
  await new Promise((r) => setTimeout(r, 4100));
  assert.equal(revoked, 1);
});
