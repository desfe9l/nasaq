import assert from "node:assert/strict";
import { describe, it } from "node:test";
import JSZip from "jszip";
import { readNsq, writeNsq, parseDataUrl } from "./package.ts";
import {
  NSQ_LIMITS,
  NsqError,
  migrateDocument,
  validatePages,
} from "./format.ts";
import { inspectZip } from "./zip-container.ts";
import { assertPassiveSvg } from "./passive-svg.ts";
import { writeAtomically } from "./atomic-file.ts";
import type { Project } from "../editor/model.ts";
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const project = (): Project => ({
  version: 2,
  name: "Native project",
  theme: "official",
  orgName: "Unit",
  createdAt: 1700000000000,
  pages: [
    {
      id: "page",
      name: "Page",
      w: 210,
      h: 297,
      elements: [
        {
          id: "image",
          type: "image",
          name: "Image",
          x: -27.125,
          y: 9.5,
          w: 2.5,
          h: 40.25,
          rotation: 27,
          opacity: 0.45,
          z: -5,
          src: PNG,
          style: {
            objectFit: "contain",
            objectX: 11,
            objectY: 89,
            flipX: true,
          },
        },
      ],
    },
  ],
});
const code = (value: string) => (err: unknown) =>
  err instanceof NsqError && err.code === value;
async function rewrite(change: (doc: any, manifest: any, zip: JSZip) => void) {
  const saved = await writeNsq({ project: project() });
  const zip = await JSZip.loadAsync(await saved.blob.arrayBuffer());
  const doc = JSON.parse(await zip.file("document.json")!.async("string"));
  const manifest = JSON.parse(await zip.file("manifest.json")!.async("string"));
  change(doc, manifest, zip);
  const data = JSON.stringify(doc);
  manifest.document.sha256 = undefined;
  manifest.document.size = new TextEncoder().encode(data).length;
  zip.file("document.json", data);
  zip.file("manifest.json", JSON.stringify(manifest));
  return zip.generateAsync({ type: "uint8array" });
}

describe("NSQ portability and evolution", () => {
  it("preserves metadata, exact authored geometry, settings and image transforms", async () => {
    const source = project();
    source.editorSettings = {
      printGuides: { safe: true, bleed: false, gutter: true },
      showGrid: true,
      snapGrid: false,
    };
    const saved = await writeNsq({ project: source });
    const read = await readNsq(saved.blob);
    assert.deepEqual(read.project.pages, source.pages);
    assert.deepEqual(read.project.editorSettings, source.editorSettings);
    assert.equal(read.project.createdAt, source.createdAt);
    assert.equal(saved.manifest.external.length, 0);
    const magic = new Uint8Array(await saved.blob.slice(0, 10).arrayBuffer());
    assert.deepEqual([...magic.slice(0, 4)], [80, 75, 3, 4]);
    assert.equal(
      new DataView(magic.buffer).getUint16(8, true),
      0,
      "mimetype stored, not compressed",
    );
  });
  it("never ships remote/blob/local dependencies or silently removes failed images", async () => {
    for (const src of [
      "https://example.invalid/photo.png",
      "blob:old-device",
      "file:///Users/me/photo.png",
      "C:/photo.png",
    ]) {
      const p = project();
      p.pages[0].elements[0].src = src;
      await assert.rejects(writeNsq({ project: p }), code("missing-asset"));
      assert.equal(
        p.pages[0].elements[0].src,
        src,
        "writer never mutates caller",
      );
    }
    const p = project();
    p.pages[0].elements[0].src = "/assets/photo.png";
    const saved = await writeNsq({
      project: p,
      resolveExternal: async () =>
        new Blob([parseDataUrl(PNG)!.bytes as Uint8Array<ArrayBuffer>], {
          type: "image/png",
        }),
    });
    assert.equal(
      (await readNsq(saved.blob)).project.pages![0].elements[0].src,
      PNG,
    );
  });
  it("migrates v1 deterministically but rejects future model/container versions", async () => {
    const bytes = await rewrite((_doc, m) => {
      m.formatVersion = 1;
      m.minReaderVersion = 1;
    });
    assert.deepEqual((await readNsq(bytes)).project.pages, project().pages);
    assert.throws(() => migrateDocument({}, 99), code("too-new"));
    await assert.rejects(
      readNsq(
        await rewrite((doc) => {
          doc.modelVersion = 99;
        }),
      ),
      code("too-new"),
    );
    await assert.rejects(
      readNsq(
        await rewrite((doc) => {
          doc.pages[0].elements[0].type = "future-widget";
        }),
      ),
      code("too-new"),
    );
  });
  it("does not accept renamed JSON as a native container", async () => {
    const json = new TextEncoder().encode(JSON.stringify(project()));
    await assert.rejects(
      readNsq(json, { allowLegacy: false }),
      code("not-nsq"),
    );
    assert.equal(
      (await readNsq(json)).legacy,
      true,
      "explicit legacy JSON still supported",
    );
  });
  it("does not interpret text beginning with the asset prefix as a vector asset", async () => {
    const p = project();
    p.pages[0].elements[0].type = "text";
    p.pages[0].elements[0].content = "nsq-asset:literal-not-a-reference";
    delete p.pages[0].elements[0].src;
    assert.equal(
      (await readNsq((await writeNsq({ project: p })).blob)).project.pages![0]
        .elements[0].content,
      "nsq-asset:literal-not-a-reference",
    );
  });
  it("keeps project data when optional thumbnail generation fails", async () => {
    const saved = await writeNsq({ project: project(), thumbnail: null });
    assert.equal(saved.manifest.thumbnail, null);
    assert.deepEqual(
      (await readNsq(saved.blob)).project.pages,
      project().pages,
    );
  });
});

describe("NSQ hostile/corrupt input", () => {
  it("checks ZIP expansion limits BEFORE any decompression", async () => {
    const saved = await writeNsq({ project: project() });
    const bytes = new Uint8Array(await saved.blob.arrayBuffer());
    const view = new DataView(bytes.buffer);
    const end = bytes.length - 22;
    const central = view.getUint32(end + 16, true);
    view.setUint32(central + 24, NSQ_LIMITS.maxUncompressedBytes + 1, true);
    assert.throws(() => inspectZip(bytes), code("too-large"));
    await assert.rejects(readNsq(bytes), code("too-large"));
  });
  it("bounds actual inflated data even if a ZIP lies about its size", async () => {
    const bytes = await rewrite((_doc, _m, zip) =>
      zip.file("assets/bomb.svg", "x".repeat(10000), {
        compression: "DEFLATE",
      }),
    );
    const view = new DataView(bytes.buffer);
    let at = view.getUint32(bytes.length - 22 + 16, true);
    while (view.getUint32(at, true) === 0x02014b50) {
      const n = view.getUint16(at + 28, true);
      const name = new TextDecoder().decode(
        bytes.subarray(at + 46, at + 46 + n),
      );
      if (name === "document.json") {
        view.setUint32(at + 24, 1, true);
        break;
      }
      at +=
        46 + n + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
    }
    await assert.rejects(
      readNsq(bytes),
      (err) =>
        err instanceof NsqError && ["too-large", "corrupt"].includes(err.code),
    );
  });
  it("rejects traversal, missing references, duplicate IDs and broken clip links", async () => {
    await assert.rejects(
      readNsq(
        await rewrite((_d, _m, zip) => {
          zip.file("../escape.txt", "no");
        }),
      ),
      code("invalid"),
    );
    await assert.rejects(
      readNsq(
        await rewrite((d) => {
          d.pages[0].elements[0].src = "nsq-asset:missing";
        }),
      ),
      code("missing-asset"),
    );
    await assert.rejects(
      readNsq(
        await rewrite((d) => {
          d.pages[0].elements.push(d.pages[0].elements[0]);
        }),
      ),
      code("invalid"),
    );
    await assert.rejects(
      readNsq(
        await rewrite((d) => {
          d.pages[0].elements[0].clippedBy = "missing";
        }),
      ),
      code("invalid"),
    );
  });
  it("rejects executable/remote SVG without ever evaluating it", () => {
    const unsafe = [
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      '<svg onload="alert(1)"></svg>',
      "<svg><foreignObject><div>html</div></foreignObject></svg>",
      '<svg><image href="https://tracker.invalid/i"/></svg>',
      '<svg><use href="java&#x73;cript:alert(1)"/></svg>',
      '<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg/>',
      '<svg><rect style="fill:url(https://tracker.invalid/i)"/></svg>',
      "<svg><rect></svg>",
    ];
    unsafe.forEach((svg) =>
      assert.throws(() => assertPassiveSvg(svg), code("invalid")),
    );
    assert.doesNotThrow(() =>
      assertPassiveSvg(
        '<svg xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g"><stop offset="1" stop-color="#fff"/></linearGradient></defs><rect fill="url(#g)"/></svg>',
      ),
    );
  });
  it("limits malicious table dimensions before the renderer sees them", () => {
    const p = project().pages;
    p[0].elements[0].type = "table";
    p[0].elements[0].style.rows = 1e12;
    assert.throws(() => validatePages(p, { strict: true }), code("too-large"));
  });
});

describe("atomic native save", () => {
  it("never opens the destination if packaging/verification fails", async () => {
    let opened = false;
    await assert.rejects(
      writeAtomically(
        {
          name: "x.nsq",
          createWritable: async () => {
            opened = true;
            throw Error();
          },
        },
        async () => {
          throw Error("bad asset");
        },
      ),
    );
    assert.equal(opened, false);
  });
  it("aborts failures and commits bytes only after a successful close", async () => {
    for (const fail of ["write", "close", "none"]) {
      let destination = "previous",
        aborted = false;
      const next = new Blob(["verified package"]);
      const handle = {
        name: "x.nsq",
        createWritable: async () => ({
          write: async () => {
            if (fail === "write") throw Error("interrupted");
          },
          close: async () => {
            if (fail === "close") throw Error("interrupted");
            destination = "next";
          },
          abort: async () => {
            aborted = true;
          },
        }),
      };
      const save = writeAtomically(handle, async () => ({ blob: next }));
      if (fail === "none") {
        assert.equal((await save).blob, next);
        assert.equal(destination, "next");
      } else {
        await assert.rejects(save);
        assert.equal(destination, "previous");
        assert.equal(aborted, true);
      }
    }
  });
});
