import assert from "node:assert/strict";
import { describe, it } from "node:test";
import JSZip from "jszip";

import {
  ASSET_REF,
  NSQ_FORMAT_VERSION,
  NSQ_MIME,
  NSQ_PATHS,
  NsqError,
  isNsqFileName,
  isSafeEntryPath,
  nsqFileName,
  validatePages,
} from "./format.ts";
import {
  parseDataUrl,
  readNsq,
  writeNsq,
  type NsqProjectInput,
} from "./package.ts";

// 1×1 transparent PNG.
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#006c35"/></svg>';
// "wOF2" + padding — enough for the font sniffer.
const FONT = `data:application/octet-stream;base64,${btoa("wOF2" + "\0".repeat(28))}`;

function sampleProject(): NsqProjectInput {
  return {
    version: 2,
    id: "proj-original",
    name: "تقرير الأداء",
    theme: "ministry",
    orgName: "وزارة",
    transactionNo: "123/أ",
    defaultSize: "a4-portrait",
    pack: "official",
    licensedTemplateId: "tpl_premium-source",
    createdAt: 1_700_000_000_000,
    pages: [
      {
        id: "p1",
        name: "الغلاف",
        w: 210,
        h: 297,
        bg: "#fffdf8",
        bgImage: PNG,
        bgImageFit: "cover",
        bgImageX: 24,
        bgImageY: 76,
        elements: [
          {
            id: "t1",
            type: "text",
            name: "عنوان",
            x: 20,
            y: 30,
            w: 150,
            h: 18,
            rotation: 12,
            opacity: 0.9,
            z: 3,
            content: "عنوان التقرير",
            style: {
              fontFamily: "Tajawal",
              fontSize: 26,
              color: "#172033",
              fontWeight: 800,
            },
          },
          {
            id: "i1",
            type: "image",
            name: "صورة",
            x: 10,
            y: 60,
            w: 60,
            h: 45,
            rotation: 0,
            opacity: 1,
            z: 1,
            src: PNG,
            clippedBy: "s1",
            style: { objectFit: "cover", flipX: true },
          },
          {
            id: "s1",
            type: "shape",
            name: "قناع",
            x: 10,
            y: 60,
            w: 40,
            h: 40,
            rotation: 0,
            opacity: 1,
            z: 2,
            style: {
              shapeId: "circle",
              fill: "#006c35",
              borderColor: "#c9a86a",
              borderWidth: 1,
            },
          },
          {
            id: "g1",
            type: "group",
            name: "مجموعة",
            x: 100,
            y: 100,
            w: 50,
            h: 50,
            rotation: 0,
            opacity: 1,
            z: 4,
            style: {},
            children: [
              {
                id: "g1a",
                type: "logo",
                name: "شعار",
                x: 0,
                y: 0,
                w: 20,
                h: 20,
                rotation: 0,
                opacity: 1,
                z: 1,
                src: PNG,
                style: {},
              },
              {
                id: "g1b",
                type: "svg",
                name: "رسم",
                x: 25,
                y: 0,
                w: 20,
                h: 20,
                rotation: 45,
                opacity: 1,
                z: 2,
                content: SVG,
                style: { svgFill: "#fff" },
              },
            ],
          },
          {
            id: "c1",
            type: "text",
            name: "خط مرفوع",
            x: 20,
            y: 200,
            w: 100,
            h: 10,
            rotation: 0,
            opacity: 1,
            z: 5,
            content: "نص",
            style: { fontFamily: "خطي الخاص" },
          },
        ],
      },
      { id: "p2", name: "الصفحة 2", w: 297, h: 210, elements: [] },
    ],
  };
}

describe("nsq format helpers", () => {
  it("recognises .nsq names and builds safe file names", () => {
    assert.equal(isNsqFileName("Report.NSQ"), true);
    assert.equal(isNsqFileName("report.json"), false);
    assert.equal(nsqFileName('a/b:c*?"<>|'), "a-b-c-.nsq");
    assert.equal(nsqFileName("x.nsq"), "x.nsq");
  });

  it("rejects absolute and escaping entry paths", () => {
    assert.equal(isSafeEntryPath("assets/a.png"), true);
    for (const bad of [
      "/etc/passwd",
      "../x",
      "a/../../x",
      "C:/x",
      "a\\b",
      "",
      "a//b",
    ]) {
      assert.equal(isSafeEntryPath(bad), false, bad);
    }
  });

  it("drops unknown element types and unsafe style values", () => {
    const { pages, warnings } = validatePages([
      {
        id: "p",
        elements: [
          { id: "a", type: "script", x: 0, y: 0, w: 1, h: 1 },
          {
            id: "b",
            type: "box",
            x: "5",
            y: null,
            w: 10,
            h: 10,
            style: { background: "url(https://evil)", color: "#000" },
          },
        ],
      },
    ]);
    assert.equal(pages[0].elements.length, 1);
    assert.equal(pages[0].elements[0].x, 5);
    assert.equal(pages[0].elements[0].y, 0);
    assert.equal(pages[0].elements[0].style.background, undefined);
    assert.equal(pages[0].elements[0].style.color, "#000");
    assert.ok(warnings.length >= 2);
  });
});

describe("nsq package round trip", () => {
  it("writes a self-contained, verifiable container", async () => {
    const thumb = parseDataUrl(PNG)!.bytes;
    const { blob, manifest } = await writeNsq({
      project: sampleProject(),
      activePageIndex: 1,
      thumbnail: { bytes: thumb, width: 1, height: 1 },
      fontSources: [{ family: "خطي الخاص", dataUrl: FONT }],
      site: "https://nasaq.example",
    });
    assert.equal(blob.type, NSQ_MIME);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const names = Object.keys(zip.files);
    assert.equal(
      names[0],
      NSQ_PATHS.mimetype,
      "mimetype must be the first entry",
    );
    assert.equal(await zip.file(NSQ_PATHS.mimetype)!.async("string"), NSQ_MIME);
    assert.ok(zip.file(NSQ_PATHS.thumbnail));
    assert.ok(zip.file(NSQ_PATHS.quickLook));
    assert.match(
      await zip.file(NSQ_PATHS.readme)!.async("string"),
      /nasaq\.example\/open/,
    );
    // Identical images are stored once; the SVG markup becomes its own asset.
    assert.equal(manifest.assets.length, 2);
    assert.equal(manifest.formatVersion, NSQ_FORMAT_VERSION);
    assert.equal(manifest.attribution.createdWith, "NASAQ");
    assert.equal(
      manifest.fonts.find((f) => f.family === "خطي الخاص")?.mime,
      "font/woff2",
    );
    assert.equal(
      manifest.fonts.find((f) => f.family === "Tajawal")?.bundled,
      true,
    );
    const doc = await zip.file(NSQ_PATHS.document)!.async("string");
    assert.ok(
      !doc.includes("base64"),
      "document.json must not inline binary data",
    );
    assert.ok(doc.includes(ASSET_REF));
  });

  it("reopens with every editable property preserved", async () => {
    const original = sampleProject();
    const { blob } = await writeNsq({
      project: original,
      activePageIndex: 1,
      fontSources: [{ family: "خطي الخاص", dataUrl: FONT }],
    });
    const read = await readNsq(blob);
    assert.equal(read.legacy, false);
    assert.equal(read.activePageIndex, 1);
    const p = read.project;
    assert.equal(p.name, original.name);
    assert.equal(p.theme, "ministry");
    assert.equal(p.orgName, "وزارة");
    assert.equal(p.transactionNo, "123/أ");
    assert.equal(p.pack, "official");
    assert.equal(p.licensedTemplateId, "tpl_premium-source");
    assert.equal(p.pages!.length, 2);
    assert.equal(p.pages![1].w, 297);
    assert.equal(p.pages![0].bg, "#fffdf8");
    assert.equal(p.pages![0].bgImage, PNG);
    assert.equal(p.pages![0].bgImageFit, "cover");
    assert.equal(p.pages![0].bgImageX, 24);
    assert.equal(p.pages![0].bgImageY, 76);
    const [text, image, shape, group] = p.pages![0].elements;
    assert.deepEqual(text, original.pages[0].elements[0]);
    assert.equal(image.src, PNG);
    assert.equal(image.clippedBy, "s1");
    assert.equal(image.style.flipX, true);
    assert.deepEqual(shape, original.pages[0].elements[2]);
    assert.equal(group.children!.length, 2);
    assert.equal(group.children![0].src, PNG);
    assert.equal(group.children![1].content, SVG);
    assert.equal(group.children![1].rotation, 45);
    assert.equal(read.embeddedFonts[0].family, "خطي الخاص");
  });

  it("keeps the original attribution across re-saves", async () => {
    const first = await writeNsq({
      project: sampleProject(),
      site: "https://a.example",
    });
    const reread = await readNsq(first.blob);
    const second = await writeNsq({
      project: { ...sampleProject(), nsqOrigin: reread.origin },
      site: "https://b.example",
    });
    assert.equal(second.manifest.attribution.site, "https://a.example");
    assert.equal(
      second.manifest.attribution.firstSavedAt,
      first.manifest.attribution.firstSavedAt,
    );
  });

  it("imports legacy JSON backups through the same validation", async () => {
    const json = new TextEncoder().encode(JSON.stringify(sampleProject()));
    const read = await readNsq(json);
    assert.equal(read.legacy, true);
    assert.equal(read.project.pages!.length, 2);
    assert.equal(read.project.pages![0].elements[1].src, PNG);
  });
});

describe("nsq invalid input", () => {
  const expectCode = async (input: Uint8Array | Blob, code: string) => {
    await assert.rejects(
      readNsq(input),
      (err: unknown) => err instanceof NsqError && err.code === code,
    );
  };

  it("rejects empty, random and truncated files", async () => {
    await expectCode(new Uint8Array(), "empty");
    await expectCode(new TextEncoder().encode("hello world"), "not-nsq");
    const { blob } = await writeNsq({ project: sampleProject() });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    await expectCode(
      bytes.subarray(0, Math.floor(bytes.length / 2)),
      "corrupt",
    );
  });

  it("rejects foreign zips, newer formats, tampered and incomplete packages", async () => {
    const other = new JSZip();
    other.file("mimetype", "application/epub+zip");
    await expectCode(
      await other.generateAsync({ type: "uint8array" }),
      "not-nsq",
    );

    const { blob } = await writeNsq({ project: sampleProject() });
    const load = async () => JSZip.loadAsync(await blob.arrayBuffer());

    const newer = await load();
    const m = JSON.parse(await newer.file("manifest.json")!.async("string"));
    newer.file(
      "manifest.json",
      JSON.stringify({ ...m, formatVersion: 99, minReaderVersion: 99 }),
    );
    await expectCode(
      await newer.generateAsync({ type: "uint8array" }),
      "too-new",
    );

    const tampered = await load();
    const assetPath = m.assets[0].path;
    tampered.file(assetPath, new Uint8Array([1, 2, 3]));
    await expectCode(
      await tampered.generateAsync({ type: "uint8array" }),
      "integrity",
    );

    const missing = await load();
    missing.remove(assetPath);
    await expectCode(
      await missing.generateAsync({ type: "uint8array" }),
      "missing-asset",
    );

    const badDoc = await load();
    badDoc.file("document.json", "{not json");
    const bm = { ...m, document: { ...m.document, sha256: undefined } };
    badDoc.file("manifest.json", JSON.stringify(bm));
    await expectCode(
      await badDoc.generateAsync({ type: "uint8array" }),
      "corrupt",
    );
  });

  it("rejects newer containers even when they claim an older reader version", async () => {
    const { blob } = await writeNsq({ project: sampleProject() });
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const m = JSON.parse(await zip.file("manifest.json")!.async("string"));
    zip.file(
      "manifest.json",
      JSON.stringify({
        ...m,
        formatVersion: NSQ_FORMAT_VERSION + 1,
        minReaderVersion: 1,
      }),
    );
    await expectCode(
      await zip.generateAsync({ type: "uint8array" }),
      "too-new",
    );
  });
});
