/** Native file integration: run against npm run dev. Auth endpoints are mocked,
 * not real OAuth; IndexedDB, browser downloads, font loading and editor are real.
 * BROWSER_EXECUTABLE / TEST_FONT_FILE / NSQ_TEST_URL override local defaults. */
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";
import JSZip from "jszip";
const base = process.env.NSQ_TEST_URL || "http://127.0.0.1:8080";
const output = ".cache/nsq-test";
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.BROWSER_EXECUTABLE || undefined,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const errors = [],
  checks = [];
let signedIn = true,
  failSignIn = true;
const font = process.env.TEST_FONT_FILE
  ? readFileSync(process.env.TEST_FONT_FILE).toString("base64")
  : null;
async function context() {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem("nasaq.onboarding.v1", "done");
    } catch {
      /* some third-party frames forbid storage */
    }
    Object.defineProperty(window, "launchQueue", {
      configurable: true,
      value: {
        setConsumer(fn) {
          window.__launch = fn;
        },
      },
    });
  });
  await ctx.route("https://fonts.googleapis.com/**", (r) =>
    r.fulfill({ contentType: "text/css", body: "" }),
  );
  await ctx.route("https://grok.com/**", (r) =>
    r.fulfill({ contentType: "application/javascript", body: "" }),
  );
  await ctx.route("**/api/auth/get-session**", (r) =>
    r.fulfill({
      json: signedIn
        ? {
            user: {
              id: "nsq-test-user",
              email: "reader@example.test",
              name: "Reader",
              emailVerified: true,
              createdAt: "2026-01-01T00:00:00Z",
              updatedAt: "2026-01-01T00:00:00Z",
            },
            session: {
              id: "test-session",
              userId: "nsq-test-user",
              token: "test-only",
              expiresAt: "2099-01-01T00:00:00Z",
              createdAt: "2026-01-01T00:00:00Z",
              updatedAt: "2026-01-01T00:00:00Z",
            },
          }
        : null,
    }),
  );
  await ctx.route("**/api/auth/sign-out", (r) => {
    signedIn = false;
    return r.fulfill({ json: { success: true } });
  });
  await ctx.route("**/api/auth/sign-in/social", (r) => {
    assert.ok(
      r.request().postDataJSON().callbackURL.endsWith("/editor?nsq=resume"),
    );
    if (failSignIn)
      return r.fulfill({
        status: 400,
        json: { code: "TEST_FAILURE", message: "Test sign-in failure" },
      });
    return r.fulfill({
      json: { redirect: true, url: `${base}/__nsq_test_callback` },
    });
  });
  await ctx.route("**/__nsq_test_callback", (r) => {
    signedIn = true;
    return r.fulfill({
      status: 302,
      headers: { location: `${base}/editor?nsq=resume` },
      body: "",
    });
  });
  ctx.on("page", (p) => p.on("pageerror", (e) => errors.push(e.message)));
  return ctx;
}
async function ready(page) {
  await page.evaluate(async () => {
    window.__nsqStore = (await import("/src/lib/editor/store.ts")).useEditor;
  });
  try {
    await page.waitForFunction(() => window.__nsqStore.getState().hydrated);
  } catch (e) {
    console.log(
      "DIAGNOSTIC",
      await page.evaluate(() => ({
        text: document.body.innerText.slice(0, 3000),
        owner: window.__nsqStore.getState().sessionOwner,
        modules: performance
          .getEntriesByType("resource")
          .map((r) => r.name)
          .filter((n) => n.includes("store.ts") || n.includes("get-session")),
      })),
      errors,
    );
    throw e;
  }
}
async function state(page) {
  return page.evaluate(async () => {
    const { useEditor } = await import("/src/lib/editor/store.ts");
    const s = useEditor.getState();
    return {
      id: s.id,
      name: s.name,
      pages: s.pages,
      sessionOwner: s.sessionOwner,
      settings: {
        printGuides: s.printGuides,
        showGrid: s.showGrid,
        snapGrid: s.snapGrid,
        snapElements: s.snapElements,
      },
      embeddedFonts: s.embeddedFonts,
    };
  });
}
async function pending(page) {
  return page.evaluate(async () => {
    const e = await (await import("/src/lib/nsq/inbox.ts")).getPending();
    return (
      e && {
        id: e.id,
        size: e.size,
        title: e.summary.title,
        thumbnail: e.summary.thumbnail,
      }
    );
  });
}
async function download(page) {
  const result = page.waitForEvent("download");
  await page.getByRole("button", { name: "ملف المشروع", exact: true }).click();
  await page.getByRole("menuitem", { name: /تنزيل/ }).click();
  const file = await result;
  const path = `${output}/${Date.now()}.nsq`;
  await file.saveAs(path);
  return { path, zip: await JSZip.loadAsync(readFileSync(path)) };
}
try {
  const author = await context(),
    page = await author.newPage();
  await page.goto(`${base}/editor`);
  await ready(page);
  await page.waitForFunction(
    () => window.__nsqStore.getState().sessionOwner === "nsq-test-user",
  );
  const source = await page.evaluate(async (font) => {
    const { writeNsq, readNsq } = await import("/src/lib/nsq/package.ts");
    const { importReadResult } = await import("/src/lib/nsq/intake.ts");
    const { useEditor } = await import("/src/lib/editor/store.ts");
    const el = (id, type, extra = {}) => ({
      id,
      type,
      name: id,
      x: 10,
      y: 10,
      w: 30,
      h: 20,
      rotation: 0,
      opacity: 1,
      z: 1,
      style: {},
      ...extra,
    });
    const picture = document.createElement("canvas");
    picture.width = 20;
    picture.height = 20;
    picture.getContext("2d").fillRect(0, 0, 20, 20);
    const project = {
      version: 2,
      name: "NSQ browser artwork",
      theme: "official",
      orgName: "Native QA",
      transactionNo: "NSQ-01",
      createdAt: 1700000000000,
      editorSettings: {
        printGuides: { safe: true, bleed: false, gutter: true },
        showGrid: true,
        snapGrid: false,
        snapElements: true,
      },
      embeddedFonts: font
        ? [{ family: "NSQ Fixture", dataUrl: `data:font/ttf;base64,${font}` }]
        : [],
      pages: [
        {
          id: "cover",
          name: "First artwork",
          w: 101.6,
          h: 76.2,
          bg: "#dc2626",
          elements: [
            el("title", "text", {
              content: "Editable NASAQ نص عربي",
              w: 74,
              style: {
                fontFamily: font ? "NSQ Fixture" : "sans-serif",
                fontSize: 16,
                color: "#ffffff",
              },
            }),
            el("photo", "image", {
              src: picture.toDataURL(),
              y: 33,
              style: { objectFit: "cover", objectX: 20, flipX: true },
              clippedBy: "mask",
            }),
            el("mask", "shape", {
              y: 33,
              style: { shapeId: "ellipse", fill: "#ffffff" },
              z: 2,
            }),
            el("group", "group", {
              x: -2.75,
              y: 2,
              z: -7,
              w: 2.5,
              h: 2.5,
              rotation: 13,
              locked: true,
              children: [
                el("vector", "svg", {
                  x: 0.25,
                  y: 0.5,
                  w: 2,
                  h: 2,
                  content:
                    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path fill="#16a34a" d="M0 0H10V10H0Z"/></svg>',
                }),
              ],
            }),
          ],
        },
        {
          id: "second",
          name: "Second page",
          w: 90,
          h: 130,
          bg: "#2563eb",
          elements: [
            el("note", "text", {
              content: "Second editable page",
              hidden: true,
            }),
          ],
        },
      ],
    };
    useEditor.getState().setName("Unsaved before native import");
    const file = await writeNsq({ project, activePageIndex: 1 });
    if (!(await importReadResult(await readNsq(file.blob))))
      throw Error(
        "fixture import failed: " +
          JSON.stringify({
            hydrated: useEditor.getState().hydrated,
            owner: useEditor.getState().sessionOwner,
            actual: (
              await import("/src/lib/editor/storage-owner.ts")
            ).getStorageOwner(),
          }),
      );
    useEditor.getState().setActivePage("cover");
    return project;
  }, font);
  await page.waitForSelector('#export-root [data-export-page="cover"]', {
    state: "attached",
  });
  assert.ok(
    await page.evaluate(async () =>
      (await (await import("/src/lib/editor/storage.ts")).listProjects()).some(
        (p) => p.name === "Unsaved before native import",
      ),
    ),
  );
  checks.push(
    "dirty current project saved before native replacement, including first assigned library ID",
  );
  const saved = await download(page);
  const manifest = JSON.parse(
    await saved.zip.file("manifest.json").async("string"),
  );
  assert.equal(manifest.formatVersion, 2);
  assert.equal(manifest.external.length, 0);
  assert.ok(saved.zip.file("Thumbnails/thumbnail.png"));
  assert.ok(saved.zip.file("QuickLook/Thumbnail.png"));
  const png = await saved.zip.file("Thumbnails/thumbnail.png").async("base64");
  const preview = await page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const c = document.createElement("canvas");
    c.width = image.width;
    c.height = image.height;
    const ctx = c.getContext("2d");
    ctx.drawImage(image, 0, 0);
    return {
      w: c.width,
      h: c.height,
      pixel: [...ctx.getImageData(c.width - 12, c.height - 12, 1, 1).data],
    };
  }, png);
  assert.equal(preview.w, 512);
  assert.ok(
    preview.pixel[0] > 180 && preview.pixel[2] < 80,
    "preview must show first-page red artwork, not blue page 2 or logo",
  );
  if (font)
    assert.ok(manifest.fonts.some((f) => f.family === "NSQ Fixture" && f.path));
  checks.push(
    "real artwork thumbnail + free-plan download + editable package assets/fonts",
  );
  assert.deepEqual(
    await page.evaluate(async () => {
      const io = await import("/src/lib/nsq/editor-io.ts");
      const { readNsq } = await import("/src/lib/nsq/package.ts");
      const { useEditor } = await import("/src/lib/editor/store.ts");
      const original = useEditor.getState();
      window.showSaveFilePicker = async () => {
        throw new DOMException("Cancelled", "AbortError");
      };
      const cancelled = await io.saveCurrentNsqAs();
      let finishPicker,
        written,
        closed = false;
      window.showSaveFilePicker = () =>
        new Promise((resolve) => {
          finishPicker = resolve;
        });
      const writing = io.saveCurrentNsqAs();
      const concurrent = await io.saveCurrentNsqAs();
      useEditor.setState({
        id: "another-project",
        name: "Changed during picker",
        activePageId: "other-page",
        pages: [
          { id: "other-page", name: "Other", w: 100, h: 100, elements: [] },
        ],
      });
      finishPicker({
        name: "captured.nsq",
        createWritable: async () => ({
          write: async (blob) => {
            written = blob;
          },
          close: async () => {
            closed = true;
          },
          abort: async () => {},
        }),
      });
      const saved = await writing;
      const read = await readNsq(written);
      const result = {
        cancelled,
        concurrent,
        saved,
        closed,
        title: read.project.name,
        pages: read.project.pages.length,
        linkedToOriginal: io.linkedFileName(original.id),
        linkedToCurrent: io.linkedFileName("another-project"),
      };
      useEditor.setState(original);
      return result;
    }),
    {
      cancelled: false,
      concurrent: false,
      saved: true,
      closed: true,
      title: source.name,
      pages: 2,
      linkedToOriginal: "captured.nsq",
      linkedToCurrent: null,
    },
  );
  checks.push(
    "save-as cancellation + immutable picker snapshot + concurrent save guard + correct handle association",
  );
  await author.close();

  signedIn = false;
  const receiver = await context(),
    guest = await receiver.newPage();
  await guest.goto(`${base}/open`);
  await guest.locator('input[type="file"]').setInputFiles(saved.path);
  await guest.waitForURL("**/editor?nsq=resume");
  await ready(guest);
  await guest.locator("#nsq-gate-title").waitFor();
  const firstPending = await pending(guest);
  assert.equal(firstPending.title, source.name);
  assert.ok(firstPending.thumbnail);
  assert.notEqual(
    (await state(guest)).name,
    source.name,
    "no import before authentication",
  );
  await guest.reload();
  await guest.locator("#nsq-gate-title").waitFor();
  assert.equal((await pending(guest)).id, firstPending.id);
  assert.deepEqual(
    await guest.evaluate(async () => {
      const inbox = await import("/src/lib/nsq/inbox.ts");
      const e = await inbox.getPending();
      let code;
      try {
        await inbox.putPending({ ...e, fileName: "replacement.nsq" });
      } catch (err) {
        code = err.code;
      }
      await inbox.clearPending("stale-id");
      return { code, id: (await inbox.getPending()).id };
    }),
    { code: "pending", id: firstPending.id },
  );
  checks.push(
    "validate/preserve before gate + reload durability + no pending overwrite + compare/delete",
  );
  await guest.getByRole("button", { name: /الدخول أو إنشاء حساب عبر/ }).click();
  await guest.getByText("Test sign-in failure", { exact: true }).waitFor();
  assert.equal((await pending(guest)).id, firstPending.id);
  failSignIn = false;
  await guest.getByRole("button", { name: /الدخول أو إنشاء حساب عبر/ }).click();
  // Better Auth's redirect plugin and the existing client can both navigate;
  // wait for the destination artwork, not an intermediate aborted navigation.
  await guest
    .locator('#export-root [data-export-page="cover"]')
    .waitFor({ state: "attached" });
  await ready(guest);
  await guest.waitForFunction(
    () => window.__nsqStore.getState().name === "NSQ browser artwork",
  );
  const imported = await state(guest);
  assert.equal(imported.id, `nsq-${firstPending.id}`);
  assert.deepEqual(imported.pages, source.pages);
  assert.deepEqual(imported.settings, source.editorSettings);
  assert.equal(await pending(guest), null);
  checks.push(
    "failed sign-in retained + mocked OAuth redirect resumes exact editable document once",
  );

  const edits = await guest.evaluate(async () => {
    const { useEditor } = await import("/src/lib/editor/store.ts");
    useEditor.getState().setActivePage("cover");
    useEditor
      .getState()
      .updateElement("title", { content: "Edited after reopening" });
    await useEditor.getState().saveNow();
    return useEditor.getState().pages;
  });
  await guest.reload();
  await ready(guest);
  assert.deepEqual((await state(guest)).pages, edits);
  if (font)
    assert.ok(
      (await state(guest)).embeddedFonts.some(
        (f) =>
          f.family === "NSQ Fixture" && f.dataUrl.includes(font.slice(0, 30)),
      ),
    );
  const resaved = await download(guest);
  if (font)
    assert.ok(
      JSON.parse(
        await resaved.zip.file("manifest.json").async("string"),
      ).fonts.some((f) => f.family === "NSQ Fixture" && f.path),
    );
  checks.push("edit + library reload + embedded-font re-save");

  const before = await state(guest);
  await guest.locator('input[type="file"][accept*=".nsq"]').setInputFiles({
    name: "corrupt.nsq",
    mimeType: "application/octet-stream",
    buffer: Buffer.from("PK broken"),
  });
  await guest
    .getByText(/تالف|غير مكتمل|ليس ملف/)
    .first()
    .waitFor();
  assert.deepEqual(await state(guest), before);
  const bytes = [...readFileSync(saved.path)];
  await guest.evaluate((bytes) => {
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array(bytes)], "drop.nsq"));
    window.dispatchEvent(
      new DragEvent("drop", {
        dataTransfer: dt,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, bytes);
  await guest.waitForFunction((id) => {
    const s = window.__nsqStore.getState();
    return s.id !== id && s.name === "NSQ browser artwork";
  }, before.id);
  assert.deepEqual((await state(guest)).pages, source.pages);
  checks.push(
    "invalid file leaves current project untouched + native drag/drop",
  );
  const secondTab = await receiver.newPage();
  await secondTab.goto(`${base}/editor`);
  await ready(secondTab);
  const beforeCount = await guest.evaluate(
    async () =>
      (await (await import("/src/lib/editor/storage.ts")).listProjects())
        .length,
  );
  const pendingId = await guest.evaluate(async (bytes) => {
    const inbox = await import("/src/lib/nsq/inbox.ts");
    const file = new File([new Uint8Array(bytes)], "two-tabs.nsq");
    return (
      await inbox.putPending({
        fileName: file.name,
        size: file.size,
        receivedAt: Date.now(),
        summary: { title: "Concurrent", pageCount: 2 },
        blob: file,
      })
    ).id;
  }, bytes);
  const outcomes = await Promise.all(
    [guest, secondTab].map((p) =>
      p.evaluate(async () =>
        (await import("/src/lib/nsq/intake.ts")).resumePending(),
      ),
    ),
  );
  assert.equal(outcomes.filter(Boolean).length, 1);
  const rows = await guest.evaluate(async () =>
    (await (await import("/src/lib/editor/storage.ts")).listProjects()).map(
      (p) => p.id,
    ),
  );
  assert.equal(rows.length, beforeCount + 1);
  assert.equal(rows.filter((id) => id === `nsq-${pendingId}`).length, 1);
  checks.push("two-tab resume serialized and imported exactly once");
  await receiver.close();

  signedIn = false;
  const launch = await context(),
    launched = await launch.newPage();
  await launched.goto(`${base}/`);
  await launched.waitForFunction(() => !!window.__launch);
  await launched.evaluate(
    (bytes) =>
      window.__launch({
        files: [
          {
            getFile: async () =>
              new File([new Uint8Array(bytes)], "OS-open.nsq"),
          },
        ],
      }),
    bytes,
  );
  await launched.waitForURL("**/editor?nsq=resume");
  await launched.locator("#nsq-gate-title").waitFor();
  assert.equal((await pending(launched)).title, source.name);
  checks.push("OS launchQueue intake from outside editor");
  await launch.close();

  const denied = await context(),
    quota = await denied.newPage();
  await quota.addInitScript(() => {
    const original = indexedDB.open.bind(indexedDB);
    indexedDB.open = (name, ...rest) => {
      if (name === "nasaq-inbox")
        throw new DOMException("Unavailable", "QuotaExceededError");
      return original(name, ...rest);
    };
  });
  await quota.goto(`${base}/open`);
  await quota.locator('input[type="file"]').setInputFiles(saved.path);
  await quota
    .getByText(/المتصفح.*تخزين|حفظ.*المتصفح|مساحة.*التخزين/)
    .first()
    .waitFor();
  assert.ok(quota.url().endsWith("/open"));
  assert.equal(await quota.locator("#nsq-gate-title").count(), 0);
  checks.push(
    "storage failure refuses sign-in handoff rather than losing received file",
  );
  await denied.close();
  assert.deepEqual(errors, []);
  writeFileSync(
    `${output}/result.json`,
    JSON.stringify({ checks, preview, errors }, null, 2),
  );
  console.log(JSON.stringify({ checks, preview, errors }, null, 2));
} finally {
  await browser.close();
}
