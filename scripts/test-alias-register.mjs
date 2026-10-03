/**
 * Registers the test-only resolver hook (see `test-alias-loader.mjs`).
 *
 * Node loads `--import` modules in the main thread; `module.register` then
 * moves the hook onto the loader thread. Kept separate from the hook itself
 * because a resolver module must not also run registration side effects.
 */
import { register } from "node:module";
import { pathToFileURL } from "node:url";

register(
  new URL("./test-alias-loader.mjs", import.meta.url).href,
  pathToFileURL(`${process.cwd()}/`).href,
);
