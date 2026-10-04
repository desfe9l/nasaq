import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ANON_OWNER,
  getStorageOwner,
  hasSignedInOwner,
  rowOwnership,
  setStorageOwner,
  subscribeStorageOwner,
} from "./storage-owner";

/** Restore the signed-out default so tests never leak state into each other. */
function signedOut() {
  setStorageOwner(null);
}

describe("storage owner registry", () => {
  it("starts (and resets) signed-out, failing closed", () => {
    signedOut();
    assert.equal(getStorageOwner(), ANON_OWNER);
    assert.equal(hasSignedInOwner(), false);
  });

  it("pins an account id and normalises empty input back to signed-out", () => {
    assert.equal(setStorageOwner("user-a"), "user-a");
    assert.equal(hasSignedInOwner(), true);
    assert.equal(setStorageOwner("   "), ANON_OWNER);
    assert.equal(setStorageOwner(undefined), ANON_OWNER);
    assert.equal(setStorageOwner(null), ANON_OWNER);
    signedOut();
  });

  it("notifies cache observers only when the effective owner changes", () => {
    signedOut();
    const seen: string[] = [];
    const unsubscribe = subscribeStorageOwner((ownerId) => seen.push(ownerId));
    setStorageOwner("user-a");
    setStorageOwner(" user-a ");
    setStorageOwner(null);
    unsubscribe();
    setStorageOwner("user-b");
    assert.deepEqual(seen, ["user-a", ANON_OWNER]);
    signedOut();
  });
});

describe("rowOwnership", () => {
  it("matches a row stamped with the current owner", () => {
    setStorageOwner("user-a");
    assert.equal(rowOwnership({ ownerId: "user-a" }), "own");
    signedOut();
    assert.equal(rowOwnership({ ownerId: ANON_OWNER }), "own");
  });

  it("never exposes another account's rows", () => {
    setStorageOwner("user-b");
    assert.equal(rowOwnership({ ownerId: "user-a" }), "foreign");
    signedOut();
    // Signed out, an account's rows stay foreign — this is the logout leak.
    assert.equal(rowOwnership({ ownerId: "user-a" }), "foreign");
  });

  it("lets a signed-in account adopt pre-isolation and visitor rows", () => {
    setStorageOwner("user-a");
    assert.equal(rowOwnership({}), "adoptable");
    assert.equal(rowOwnership({ ownerId: null }), "adoptable");
    assert.equal(rowOwnership({ ownerId: "" }), "adoptable");
    assert.equal(rowOwnership({ ownerId: ANON_OWNER }), "adoptable");
    signedOut();
  });

  it("lets a signed-out visitor adopt NOTHING", () => {
    signedOut();
    // Unstamped rows may be an account's private library from before
    // ownership tracking — invisible until an account claims them.
    assert.equal(rowOwnership({}), "foreign");
    assert.equal(rowOwnership({ ownerId: null }), "foreign");
    assert.equal(rowOwnership({ ownerId: "user-a" }), "foreign");
  });

  it("treats a missing row as foreign", () => {
    setStorageOwner("user-a");
    assert.equal(rowOwnership(null), "foreign");
    assert.equal(rowOwnership(undefined), "foreign");
    signedOut();
  });
});
