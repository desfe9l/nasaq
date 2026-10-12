import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canUseDemoExport } from "../product/product.ts";
import { useEditor } from "./store.ts";
import { runExport, type CapturedPage } from "./export.ts";

/** A paid file must not depend on the unrelated three-free-export counter. */
test("licensed raster exports download without consulting the free-export service", async () => {
  const before = useEditor.getState();
  const downloads: string[] = [];
  const blobs: Blob[] = [];
  const initialDirectory = process.cwd();
  const outputDirectory = mkdtempSync(join(tmpdir(), "nasaq-export-license-"));
  const previousDocument = globalThis.document;
  const previousCreate = URL.createObjectURL;
  const previousRevoke = URL.revokeObjectURL;
  const anchor = {
    href: "",
    download: "",
    rel: "",
    click() {
      downloads.push(this.download);
    },
    remove() {},
  };
  try {
    // Exercise resolved export access; the tier is set per export below.
    useEditor.setState({ showcase: true, hydrated: true });
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        createElement: () => anchor,
        body: { appendChild: () => {} },
      },
    });
    URL.createObjectURL = (blob) => {
      assert.ok(blob instanceof Blob);
      blobs.push(blob);
      return "blob:test-export";
    };
    URL.revokeObjectURL = () => {};
    // Known-good one-pixel image fixtures; the test inspects the downloaded
    // bytes, not just the download filename.
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVQI12P4z8AAAAMBAQAY3Y2wAAAAAElFTkSuQmCC",
      "base64",
    );
    const jpeg = Buffer.from(
      "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDAREAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAVAQEBAAAAAAAAAAAAAAAAAAAHCf/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/ADoDFU3/2Q==",
      "base64",
    );
    const canvas = {
      width: 20,
      height: 20,
      toBlob: (callback: (blob: Blob) => void, type: string) =>
        callback(new Blob([type === "image/png" ? png : jpeg], { type })),
      toDataURL: () => `data:image/jpeg;base64,${jpeg.toString("base64")}`,
    } as unknown as HTMLCanvasElement;
    const captured = [{ canvas, w: 10, h: 10 }] as CapturedPage[];
    const project = {
      ...before,
      pack: "blank" as const,
      pages: before.pages.slice(0, 1),
      name: "paid-report",
    };
    for (const tier of ["basic", "advanced"] as const) {
      useEditor.setState({
        entitlements: {
          ...before.entitlements,
          basic_export: tier === "basic",
          advanced_export: tier === "advanced",
        },
      });
      for (const format of ["png", "jpg", "pdf"] as const) {
        assert.equal(
          canUseDemoExport(format, tier === "advanced", tier === "basic"),
          true,
        );
        if (format === "pdf") {
          // jsPDF's Node save writes to cwd; use an isolated directory so the
          // real PDF can be reopened without leaving test output in the repo.
          process.chdir(outputDirectory);
          await runExport(format, captured, project, project.pages);
          const pdf = readFileSync(join(outputDirectory, "paid-report.pdf"));
          assert.match(pdf.subarray(0, 8).toString(), /^%PDF-/);
          assert.match(pdf.toString("latin1"), /\/Subtype \/Image/);
          process.chdir(initialDirectory);
        } else {
          await runExport(format, captured, project, project.pages);
        }
      }
    }
    assert.deepEqual(downloads, [
      "paid-report.png",
      "paid-report.jpg",
      "paid-report.png",
      "paid-report.jpg",
    ]);
    assert.deepEqual(
      await Promise.all(
        blobs.map(async (blob) =>
          Array.from(new Uint8Array(await blob.arrayBuffer()).slice(0, 4)),
        ),
      ),
      [
        [137, 80, 78, 71],
        [255, 216, 255, 224],
        [137, 80, 78, 71],
        [255, 216, 255, 224],
      ],
    );
    // Do not turn the free-account policy into a three-export giveaway.
    useEditor.setState({ entitlements: { ...before.entitlements } });
    process.chdir(outputDirectory);
    const freeProject = { ...project, name: "free-report" };
    for (const format of ["png", "jpg", "pdf"] as const) {
      assert.equal(canUseDemoExport(format, false, false), false);
      await runExport(format, captured, freeProject, freeProject.pages);
    }
    assert.equal(downloads.length, 4);
    assert.equal(blobs.length, 4);
    assert.equal(existsSync(join(outputDirectory, "free-report.pdf")), false);
  } finally {
    process.chdir(initialDirectory);
    rmSync(outputDirectory, { recursive: true, force: true });
    useEditor.setState(before);
    if (previousDocument === undefined)
      Reflect.deleteProperty(globalThis, "document");
    else
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: previousDocument,
      });
    URL.createObjectURL = previousCreate;
    URL.revokeObjectURL = previousRevoke;
  }
});
