import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import {
  analyzeInstallCommand,
  collectImportSpecifiers,
  inspectDeployConfig,
} from "./deploy-config.mjs";

const temporaryRoots = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function write(root, path, contents) {
  const fullPath = join(root, path);
  mkdirSync(join(fullPath, ".."), { recursive: true });
  writeFileSync(fullPath, contents);
}

function makeFixture(installCommand = "npm ci") {
  const root = mkdtempSync(join(os.tmpdir(), "nasaq-deploy-config-"));
  temporaryRoots.push(root);

  const manifest = {
    name: "deploy-guard-fixture",
    private: true,
    scripts: {
      build:
        "npm run check:deploy && node scripts/with-app-env.mjs vite build && node scripts/migrate.mjs",
      "check:deploy": "node scripts/deploy-config.mjs",
    },
    dependencies: { "@tanstack/start": "1.0.0", pg: "1.0.0", react: "1.0.0" },
    devDependencies: {
      "@vitejs/plugin-react": "1.0.0",
      nitro: "1.0.0",
      playwright: "1.0.0",
      vite: "1.0.0",
    },
  };
  const lockRoot = {
    name: manifest.name,
    dependencies: { ...manifest.dependencies },
    devDependencies: { ...manifest.devDependencies },
  };
  write(root, "package.json", JSON.stringify(manifest, null, 2));
  write(
    root,
    "package-lock.json",
    JSON.stringify({ lockfileVersion: 3, packages: { "": lockRoot } }, null, 2),
  );
  write(root, "vercel.json", JSON.stringify({ installCommand }));
  write(
    root,
    "vite.config.ts",
    [
      'import { defineConfig } from "vite";',
      'import { tanstackStart } from "@tanstack/start/vite";',
      'import react from "@vitejs/plugin-react";',
      'import { nitro } from "nitro/vite";',
      'import "./scripts/build-helper.mjs";',
      'export default defineConfig({ plugins: [tanstackStart(), react(), nitro({ serverDir: "./server" })] });',
    ].join("\n"),
  );
  write(root, "scripts/deploy-config.mjs", 'import "node:fs";\n');
  write(root, "scripts/with-app-env.mjs", 'import "node:child_process";\n');
  write(root, "scripts/build-helper.mjs", 'import "node:path";\n');
  write(root, "scripts/migrate.mjs", 'import pg from "pg";\n');
  write(root, "src/router.tsx", 'import "./routeTree.gen";\n');
  write(root, "src/routeTree.gen.ts", 'import "./routes/index";\n');
  write(root, "src/routes/index.tsx", 'import React from "react";\n');
  write(root, "src/routes/index.test.tsx", 'import "playwright";\n');
  write(root, "server/middleware/security.ts", 'import "react";\n');
  return root;
}

test("production npm install honors explicit dev inclusion", () => {
  assert.equal(analyzeInstallCommand("npm ci").includesDev, false);
  assert.equal(analyzeInstallCommand("npm ci --include=dev").includesDev, true);
  assert.equal(analyzeInstallCommand("npm ci --include dev").includesDev, true);
  assert.equal(
    analyzeInstallCommand("npm ci --omit=dev --include=dev").includesDev,
    true,
  );
  assert.equal(
    analyzeInstallCommand("npm ci --production=false").includesDev,
    true,
  );
  assert.equal(analyzeInstallCommand("npm ci", false).includesDev, true);
});

test("import scanner ignores comments and type-only imports but follows runtime edges", () => {
  const imports = collectImportSpecifiers(
    [
      '// import "comment-only";',
      'import type { Foo } from "type-only";',
      'import value from "runtime-package";',
      'export { helper } from "re-exported-package";',
      'const load = () => import("lazy-package");',
      'const requireIt = require("commonjs-package");',
    ].join("\n"),
    "fixture.ts",
  );
  assert.deepEqual(imports, [
    "runtime-package",
    "re-exported-package",
    "lazy-package",
    "commonjs-package",
  ]);
});

test("Vercel guard follows production build imports and excludes tests", () => {
  const root = makeFixture("npm ci");
  const blocked = inspectDeployConfig(root);
  assert.equal(blocked.ok, false);
  assert.deepEqual(blocked.devOnly, ["@vitejs/plugin-react", "nitro", "vite"]);
  assert.match(
    blocked.issues.join("\n"),
    /would prune build-required devDependencies/,
  );
  assert.equal(
    [...blocked.graph.packages.keys()].includes("playwright"),
    false,
  );
  assert.ok(blocked.graph.files.includes("scripts/deploy-config.mjs"));
  assert.ok(blocked.graph.files.includes("src/routes/index.tsx"));
  assert.equal(
    blocked.graph.files.some((path) => path.includes("index.test.tsx")),
    false,
  );

  write(
    root,
    "vercel.json",
    JSON.stringify({ installCommand: "npm ci --include=dev" }),
  );
  const fixed = inspectDeployConfig(root);
  assert.equal(fixed.ok, true, fixed.issues.join("\n"));
});
