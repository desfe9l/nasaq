import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { toast } from "sonner";
import { canUseDemoExport } from "../product/product.ts";
import { createTestSql } from "../commercial/test-db.ts";
import {
  canUseFreeExport,
  getFreeExportUsage,
  incrementFreeExportUsage,
} from "../license/server.ts";
import { useEditor } from "./store.ts";
import { runExport, type CapturedPage } from "./export.ts";

/** Compact one-pixel fixtures for the denial/decoupling cases. */
const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVQI12P4z8AAAAMBAQAY3Y2wAAAAAElFTkSuQmCC",
  "base64",
);
const JPEG_BYTES = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDAREAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAVAQEBAAAAAAAAAAAAAAAAAAAHCf/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/ADoDFU3/2Q==",
  "base64",
);

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

/** Shared document/URL/sonner stand-ins for the denial and decoupling cases. */
function installSimpleDom() {
  const downloads: string[] = [];
  const errors: string[] = [];
  let successes = 0;
  const previousDocument = globalThis.document;
  const previousCreate = URL.createObjectURL;
  const previousRevoke = URL.revokeObjectURL;
  const toastRef = toast as unknown as {
    error: (msg: string) => void;
    success: (msg: string) => void;
  };
  const previousError = toastRef.error;
  const previousSuccess = toastRef.success;
  const anchor = {
    href: "",
    download: "",
    rel: "",
    click() {
      downloads.push(this.download);
    },
    remove() {},
  };
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      createElement: () => anchor,
      body: { appendChild: () => {} },
    },
  });
  URL.createObjectURL = () => "blob:license-test";
  URL.revokeObjectURL = () => {};
  toastRef.error = (msg: string) => {
    errors.push(msg);
  };
  toastRef.success = () => {
    successes += 1;
  };
  return {
    downloads,
    errors,
    get successCount() {
      return successes;
    },
    restore() {
      if (previousDocument === undefined)
        Reflect.deleteProperty(globalThis, "document");
      else
        Object.defineProperty(globalThis, "document", {
          configurable: true,
          value: previousDocument,
        });
      URL.createObjectURL = previousCreate;
      URL.revokeObjectURL = previousRevoke;
      toastRef.error = previousError;
      toastRef.success = previousSuccess;
    },
  };
}

function fixtureCaptured(): CapturedPage[] {
  const canvas = {
    width: 20,
    height: 20,
    toBlob: (callback: (blob: Blob | null) => void, type: string) =>
      callback(
        new Blob([type === "image/png" ? PNG_BYTES : JPEG_BYTES], { type }),
      ),
    toDataURL: () =>
      `data:image/jpeg;base64,${JPEG_BYTES.toString("base64")}`,
  } as unknown as HTMLCanvasElement;
  return [{ canvas, w: 10, h: 10 }] as CapturedPage[];
}

test("paid exports never consult the free-export service", async () => {
  const before = useEditor.getState();
  const previousFetch = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = (() => {
    fetches += 1;
    return Promise.reject(new Error("network is disabled in this test"));
  }) as typeof fetch;
  const dom = installSimpleDom();
  try {
    useEditor.setState({
      showcase: true,
      hydrated: true,
      entitlements: {
        ...before.entitlements,
        basic_export: true,
        advanced_export: true,
      },
    });
    const project = {
      ...before,
      pack: "blank" as const,
      pages: before.pages.slice(0, 1),
      name: "decoupled-report",
    };
    await runExport("png", fixtureCaptured(), project, project.pages);
    assert.deepEqual(dom.downloads, ["decoupled-report.png"]);
    assert.equal(
      fetches,
      0,
      "the export pipeline must not reach the network for licensing",
    );
  } finally {
    dom.restore();
    globalThis.fetch = previousFetch;
    useEditor.setState(before);
  }
  // Static guard: the raster pipeline must never grow a counter reference.
  const source = readFileSync(join(import.meta.dirname, "export.ts"), "utf8");
  assert.doesNotMatch(
    source,
    /canUseFreeExport|incrementFreeExportUsage|getFreeExportUsage/,
  );
});

test("unlicensed tiers and unresolved access never reach the download", async () => {
  const before = useEditor.getState();
  const dom = installSimpleDom();
  const project = {
    ...before,
    pack: "blank" as const,
    pages: before.pages.slice(0, 1),
    name: "denied-report",
  };
  try {
    // 1) Access not yet verified: nothing downloads, whatever the format.
    useEditor.setState({ showcase: false, hydrated: false });
    for (const format of ["png", "jpg", "pdf"] as const) {
      await runExport(format, fixtureCaptured(), project, project.pages);
    }
    assert.deepEqual(dom.downloads, []);
    assert.equal(dom.successCount, 0);
    assert.ok(dom.errors.every((msg) => msg.includes("انتظر اكتمال التحقق")));

    // 2) Verified but unlicensed: every raster format is refused.
    useEditor.setState({
      showcase: true,
      hydrated: true,
      entitlements: {
        ...before.entitlements,
        basic_export: false,
        advanced_export: false,
      },
    });
    for (const format of ["png", "jpg", "pdf"] as const) {
      await runExport(format, fixtureCaptured(), project, project.pages);
    }
    assert.deepEqual(dom.downloads, []);
    assert.equal(dom.successCount, 0);
    assert.ok(dom.errors.some((msg) => msg.includes("قبل شراء الترخيص")));

    // 3) Basic licence: raster formats pass, advanced-only formats refuse.
    useEditor.setState({
      entitlements: {
        ...before.entitlements,
        basic_export: true,
        advanced_export: false,
      },
    });
    await runExport("pptx", fixtureCaptured(), project, project.pages);
    assert.deepEqual(dom.downloads, []);
    assert.ok(
      dom.errors.some((msg) => msg.includes("الترخيص المتقدم فقط")),
    );
    await runExport("png", fixtureCaptured(), project, project.pages);
    assert.deepEqual(dom.downloads, ["denied-report.png"]);
    assert.equal(dom.successCount, 1);
  } finally {
    dom.restore();
    useEditor.setState(before);
  }
});

test("the free-export counter limits free accounts and never grants rights", async () => {
  const { sql, close } = await createTestSql();
  try {
    const fresh = await getFreeExportUsage(sql, "free-user");
    assert.deepEqual(fresh, {
      png: 0,
      jpg: 0,
      pdf: 0,
      totalUsed: 0,
      remaining: 3,
    });
    assert.equal(await canUseFreeExport(sql, "free-user"), true);
    // Counter headroom is not a licence: the format gate still refuses.
    assert.equal(canUseDemoExport("png", false, false), false);

    await incrementFreeExportUsage(sql, "free-user", "png");
    await incrementFreeExportUsage(sql, "free-user", "jpg");
    const last = await incrementFreeExportUsage(sql, "free-user", "pdf");
    assert.equal(last.success, true);
    assert.equal(last.remaining, 0);

    const used = await getFreeExportUsage(sql, "free-user");
    assert.deepEqual(used, {
      png: 1,
      jpg: 1,
      pdf: 1,
      totalUsed: 3,
      remaining: 0,
    });
    assert.equal(await canUseFreeExport(sql, "free-user"), false);
    // The allowance is per user, not global.
    assert.equal(await canUseFreeExport(sql, "another-user"), true);
  } finally {
    await close();
  }
});
