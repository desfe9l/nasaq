import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defaultParseSearch } from "@tanstack/react-router";

import { searchFlag, searchString } from "./router-search.ts";

/**
 * Regression suite for the `?showcase=1` loss.
 *
 * The router's default search parser JSON-parses each value, so numeric and
 * boolean-looking parameters arrive as numbers/booleans. A
 * `typeof v === "string"` guard in `validateSearch` then dropped them and the
 * router rewrote the address without the parameter — the non-persisting
 * marketing preview (`/editor?template=official&showcase=1`) silently booted
 * as a persisting editor session.
 */
describe("searchString against the router's real parser", () => {
  it("keeps the text form of values the parser turned into numbers", () => {
    const parsed = defaultParseSearch(
      "?template=official&showcase=1&nsq=resume&q=2024&size=3",
    ) as Record<string, unknown>;
    assert.equal(parsed.showcase, 1, "the parser really produces a number");
    assert.equal(searchString(parsed.showcase), "1");
    assert.equal(searchString(parsed.template), "official");
    assert.equal(searchString(parsed.nsq), "resume");
    assert.equal(searchString(parsed.q), "2024");
    assert.equal(searchString(parsed.size), "3");
  });

  it("keeps boolean-looking values addressable", () => {
    const parsed = defaultParseSearch("?showcase=true") as Record<string, unknown>;
    assert.equal(searchString(parsed.showcase), "true");
  });

  it("drops what cannot be a parameter text", () => {
    assert.equal(searchString(undefined), undefined);
    assert.equal(searchString(null), undefined);
    assert.equal(searchString({ nested: 1 }), undefined);
    assert.equal(searchString([1, 2]), undefined);
    assert.equal(searchString(Number.NaN), undefined);
    assert.equal(searchString(Infinity), undefined);
  });

  it("searchFlag accepts the documented ?showcase=1 and tolerant true", () => {
    for (const query of ["?showcase=1", "?showcase=true"]) {
      const parsed = defaultParseSearch(query) as Record<string, unknown>;
      assert.equal(searchFlag(parsed.showcase), true, query);
    }
    assert.equal(searchFlag(undefined), false);
    assert.equal(searchFlag("0"), false);
  });

  it("the editor entry contract: showcase=1 survives a validateSearch round trip", () => {
    // Mirrors src/routes/editor/index.tsx — the route must keep the flag so
    // `?template=official&showcase=1` boots the NON-persisting preview.
    const parsed = defaultParseSearch(
      "?template=official&showcase=1",
    ) as Record<string, unknown>;
    const validated = {
      showcase: searchString(parsed.showcase),
      template: searchString(parsed.template),
    };
    assert.deepEqual(validated, { showcase: "1", template: "official" });
    assert.equal(validated.showcase === "1", true, "directBoot must trigger");
  });
});
