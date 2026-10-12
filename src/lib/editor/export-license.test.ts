import assert from "node:assert/strict";
import { test } from "node:test";
import { canUseDemoExport } from "../product/product.ts";
import { useEditor } from "./store.ts";
import { runExport, type CapturedPage } from "./export.ts";

/** A paid file must not depend on the unrelated three-free-export counter. */
test("licensed raster exports download without consulting the free-export service", async () => {
  const before = useEditor.getState();
  const downloads: string[] = [];
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
    URL.createObjectURL = () => "blob:test-export";
    URL.revokeObjectURL = () => {};
    const canvas = {
      width: 20,
      height: 20,
      toBlob: (callback: (blob: Blob) => void) =>
        callback(new Blob(["raster"])),
      toDataURL: () => "data:image/jpeg;base64,/9j/2Q==",
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
      for (const format of ["png", "jpg"] as const) {
        assert.equal(
          canUseDemoExport(format, tier === "advanced", tier === "basic"),
          true,
        );
        await runExport(format, captured, project, project.pages);
      }
    }
    assert.deepEqual(downloads, [
      "paid-report.png",
      "paid-report.jpg",
      "paid-report.png",
      "paid-report.jpg",
    ]);
    // Do not turn the free-account policy into a three-export giveaway.
    useEditor.setState({ entitlements: { ...before.entitlements } });
    await runExport("png", captured, project, project.pages);
    assert.equal(downloads.length, 4);
  } finally {
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
