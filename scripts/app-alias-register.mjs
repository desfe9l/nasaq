/**
 * Registers the production resolver hook for operator CLIs (see
 * `app-alias-loader.mjs`). Used by the `verify:owner` / `migrate:owner`
 * scripts, which must read the REAL deployment database — never a stub.
 */
import { register } from "node:module";
import { pathToFileURL } from "node:url";

register(
  new URL("./app-alias-loader.mjs", import.meta.url).href,
  pathToFileURL(`${process.cwd()}/`).href,
);
