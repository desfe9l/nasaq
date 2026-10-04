import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SHORT_CODE_ALPHABET,
  SHORT_CODE_LENGTH,
  isShortCode,
  normalizeShortCode,
  shortCodeFromBytes,
} from "./short-code.ts";

test("short codes are short, unambiguous and URL-safe", () => {
  assert.equal(SHORT_CODE_LENGTH, 7);
  /* No 0/O, no 1/l/I, no vowels: a code can be dictated over the phone. */
  for (const ambiguous of ["0", "O", "o", "1", "l", "I", "a", "e", "i", "u"]) {
    assert.ok(!SHORT_CODE_ALPHABET.includes(ambiguous), `alphabet must exclude ${ambiguous}`);
  }
  assert.equal(new Set(SHORT_CODE_ALPHABET).size, SHORT_CODE_ALPHABET.length);
  assert.match(SHORT_CODE_ALPHABET, /^[a-z0-9]+$/);
  /* 27^7 is far more addresses than the catalogue will ever need. */
  assert.ok(SHORT_CODE_ALPHABET.length ** SHORT_CODE_LENGTH > 1_000_000_000);
});

test("shortCodeFromBytes maps any bytes onto the alphabet at the exact length", () => {
  const code = shortCodeFromBytes(new Uint8Array([0, 1, 2, 255, 254, 27, 26]));
  assert.equal(code.length, SHORT_CODE_LENGTH);
  assert.ok(isShortCode(code));
  for (const char of code) assert.ok(SHORT_CODE_ALPHABET.includes(char));
  /* Short input is padded, long input is trimmed — never a partial code. */
  assert.equal(shortCodeFromBytes(new Uint8Array([5])).length, SHORT_CODE_LENGTH);
  assert.equal(shortCodeFromBytes(new Uint8Array(40)).length, SHORT_CODE_LENGTH);
  /* Deterministic: the same bytes always give the same code. */
  assert.equal(shortCodeFromBytes(new Uint8Array([9, 8, 7])), shortCodeFromBytes(new Uint8Array([9, 8, 7])));
});

test("only real codes are accepted, and nothing that could escape the path", () => {
  assert.equal(normalizeShortCode("k7m2p9q"), "k7m2p9q");
  /* Case is folded so a hand-written code still resolves. */
  assert.equal(normalizeShortCode("K7M2P9Q"), "k7m2p9q");
  assert.equal(normalizeShortCode("  k7m2p9q "), "k7m2p9q");
  for (const bad of [
    "",
    null,
    undefined,
    "abc",
    "../../admin",
    "../admin",
    "k7m2p9q/../../admin",
    "k7m2p9q?x=1",
    "k7m2p9q#x",
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "tpl_9f2c1a7e-4b0d-4a55-9c31-0aa9d0b21f44",
    "a1b2c3d", // ambiguous letters are not in the alphabet
  ]) {
    assert.equal(normalizeShortCode(bad), null, `${String(bad)} must be rejected`);
    assert.equal(isShortCode(bad), false);
  }
});
