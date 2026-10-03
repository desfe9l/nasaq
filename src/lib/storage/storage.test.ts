import assert from "node:assert/strict";
import test from "node:test";
import {
  buildStorageObjectKey,
  isAllowedStorageContentType,
  isKeyOwnedBy,
  isSafeKeySegment,
  sanitizeFileName,
  storageIdentitySegment,
  UnsafeKeySegmentError,
  userKeyPrefix,
} from "./provider.ts";
import { presignGetUrl, type S3ClientConfig } from "./s3.server.ts";
import { parseDataUrl } from "./mirror.ts";
import { objectStorageConfigured, r2BucketName, r2Endpoint, resetObjectStorageCache } from "./r2.server.ts";

const config: S3ClientConfig = {
  endpoint: "https://account123.r2.cloudflarestorage.com",
  bucket: "nasaq-sa",
  region: "auto",
  accessKeyId: "AKIDEXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
  name: "test",
};

test("file names cannot escape their prefix", () => {
  assert.equal(sanitizeFileName("../../etc/passwd"), "passwd");
  assert.equal(sanitizeFileName("  logo .png "), "logo-.png");
  assert.equal(sanitizeFileName("///"), "asset");
});

test("object keys follow the isolated users/projects/assets layout", () => {
  assert.equal(
    buildStorageObjectKey({ userId: "userA", projectId: "proj1", assetId: "obj_a" }),
    "users/userA/projects/proj1/assets/obj_a",
  );
  // No project -> the per-user library slot, still under the user's prefix.
  assert.equal(
    buildStorageObjectKey({ userId: "userA", assetId: "obj_a" }),
    "users/userA/projects/_library/assets/obj_a",
  );
});

test("a file name is never what makes a key unique", () => {
  const a = buildStorageObjectKey({ userId: "userA", projectId: "p", assetId: "obj_1" });
  const b = buildStorageObjectKey({ userId: "userB", projectId: "p", assetId: "obj_2" });
  // Two users uploading the same "logo.png" cannot collide: the name is absent.
  assert.equal(a.includes("logo"), false);
  assert.notEqual(a, b);
  assert.equal(a.startsWith("users/userA/"), true);
  assert.equal(b.startsWith("users/userB/"), true);
});

test("path traversal cannot escape a user or project prefix", () => {
  for (const bad of ["../userB", "a/b", "..", "", "a%2Fb", "a/../../b"]) {
    assert.equal(isSafeKeySegment(bad), false);
    // An empty project id means "no project" and lands in the library slot;
    // every other malformed value is rejected outright.
    if (bad !== "") {
      assert.throws(
        () => buildStorageObjectKey({ userId: "userA", projectId: bad, assetId: "obj" }),
        UnsafeKeySegmentError,
      );
    }
    assert.throws(
      () => buildStorageObjectKey({ userId: "userA", projectId: "p", assetId: bad }),
      UnsafeKeySegmentError,
    );
  }
});

test("an unusual identity still gets its own collision-free prefix", () => {
  const a = storageIdentitySegment("user@example.com");
  const b = storageIdentitySegment("user@example.net");
  assert.ok(isSafeKeySegment(a));
  assert.notEqual(a, b);
  assert.equal(userKeyPrefix("user@example.com"), `users/${a}/`);
});

test("key ownership is asserted against the caller, not the path shape", () => {
  const keyA = buildStorageObjectKey({ userId: "userA", projectId: "p", assetId: "o1" });
  assert.equal(isKeyOwnedBy(keyA, "userA"), true);
  // User B may not act on user A's object even holding the exact key.
  assert.equal(isKeyOwnedBy(keyA, "userB"), false);
  // A prefix-confusion attempt ("userA" vs "userAB") must not pass.
  assert.equal(isKeyOwnedBy("users/userAB/projects/p/assets/o1", "userA"), false);
  assert.equal(isKeyOwnedBy("users/userA/../userB/projects/p/assets/o1", "userA"), false);
  assert.equal(isKeyOwnedBy("", "userA"), false);
});

test("only editor asset content types are accepted", () => {
  assert.ok(isAllowedStorageContentType("image", "image/png"));
  assert.ok(isAllowedStorageContentType("image", "image/jpeg; charset=binary"));
  assert.ok(isAllowedStorageContentType("svg", "image/svg+xml"));
  // SVG must not sneak through the bitmap kind, and HTML is never storable.
  assert.equal(isAllowedStorageContentType("image", "image/svg+xml"), false);
  assert.equal(isAllowedStorageContentType("image", "text/html"), false);
  assert.equal(isAllowedStorageContentType("project-file", "text/html"), false);
});

test("presigned URLs are path-style, time-limited and carry no secret", () => {
  const url = presignGetUrl(config, "assets/user-1/image/obj_a-logo.png", 900);
  assert.ok(url.startsWith("https://account123.r2.cloudflarestorage.com/nasaq-sa/assets/"));
  assert.match(url, /X-Amz-Algorithm=AWS4-HMAC-SHA256/);
  assert.match(url, /X-Amz-Expires=900/);
  assert.match(url, /X-Amz-Signature=[0-9a-f]{64}/);
  assert.equal(url.includes(config.secretAccessKey), false);
  // The expiry is clamped to the S3 maximum of seven days.
  assert.match(presignGetUrl(config, "k", 99_999_999), /X-Amz-Expires=604800/);
});

test("R2 endpoint derives from the account id and is overridable", () => {
  const saved = { ...process.env };
  try {
    delete process.env.R2_ENDPOINT;
    process.env.R2_ACCOUNT_ID = "acc1";
    assert.equal(r2Endpoint(), "https://acc1.r2.cloudflarestorage.com");
    process.env.R2_ENDPOINT = "custom.example.com";
    assert.equal(r2Endpoint(), "https://custom.example.com");
    delete process.env.R2_BUCKET_NAME;
    assert.equal(r2BucketName(), "nasaq-sa");
  } finally {
    process.env = saved;
    resetObjectStorageCache();
  }
});

test("storage stays inert until every credential is present", () => {
  const saved = { ...process.env };
  try {
    delete process.env.R2_ENDPOINT;
    process.env.R2_ACCOUNT_ID = "acc1";
    delete process.env.R2_ACCESS_KEY_ID;
    delete process.env.R2_SECRET_ACCESS_KEY;
    assert.equal(objectStorageConfigured(), false);
    process.env.R2_ACCESS_KEY_ID = "id";
    assert.equal(objectStorageConfigured(), false);
    process.env.R2_SECRET_ACCESS_KEY = "secret";
    assert.equal(objectStorageConfigured(), true);
  } finally {
    process.env = saved;
    resetObjectStorageCache();
  }
});

test("data URLs split into content type and payload", () => {
  assert.deepEqual(parseDataUrl("data:image/png;base64,AAAB"), {
    contentType: "image/png",
    base64: "AAAB",
  });
  assert.equal(parseDataUrl("https://example.com/a.png"), null);
});
