# NASAQ native projects (`.nsq`)

## Contract (container v2, document model v2)

`.nsq` is an editable, self-contained ZIP, not a renamed JSON export or flattened
image. The canonical schema/types, limits, validators and migration registry live
in `src/lib/nsq/format.ts`; encoding/decoding lives in `package.ts`.

| Entry                      | Meaning                                                                                                                                                                |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mimetype`                 | First entry, stored uncompressed: `application/vnd.nasaq.project+zip`                                                                                                  |
| `manifest.json`            | `format: "nasaq.project"`, format/min-reader versions, document descriptor, content-addressed asset descriptors, fonts, preview descriptor, project title, attribution |
| `document.json`            | `schema: "nasaq.document"`, model version, project metadata, pages, active-page index and whitelisted editor settings                                                  |
| `assets/<digest>.<ext>`    | Deduplicated PNG/JPEG/WebP/GIF/AVIF/passive SVG bytes                                                                                                                  |
| `fonts/<digest>.<ext>`     | Available uploaded TTF/OTF/WOFF/WOFF2 bytes used by the document                                                                                                       |
| `Thumbnails/thumbnail.png` | Optional actual first-page artwork preview                                                                                                                             |
| `QuickLook/Thumbnail.png`  | Copy of the same preview for compatible preview integrations                                                                                                           |
| `README.txt`               | Plain-text NASAQ attribution and `/open` instructions; never artwork                                                                                                   |

Document image sources and SVG content reference manifest asset IDs with
`nsq-asset:<id>`. The prefix in an ordinary text element is literal text. Assets
and the document have byte lengths and SHA-256 integrity digests where Web Crypto
is available; ZIP CRC is always checked for extracted entries. A filename is not
trusted as evidence of file type.

All existing element types remain native elements: geometry in millimetres,
rotation, opacity, z-order, text/table content, style data, image fitting/cropping
and mirroring, lock/visibility flags, header/footer links, nested groups and
clipping references. Page order, backgrounds, custom dimensions, theme,
organization, transaction number, original creation metadata, source-project ID
and attribution travel with the project. Validated native geometry and layer
values are not clamped/renumbered by the legacy library normalizer. Imported
projects get a new owner-scoped library ID rather than overwriting a source ID.
Print-guide settings and grid/snapping preferences travel with the document;
account identity, entitlements, application credentials and transient UI state do
not.

### Compatibility and font behavior

- Container v1 has an explicit migration to v2. Unsupported future container or
  model versions fail before any import; the editor never drops unknown future
  elements and calls the result a successful import.
- Existing `.json` backups remain available through their separate legacy path.
  Renaming a JSON backup to `.nsq` does not turn it into a native container.
- Available uploaded font bytes persist in the owner-scoped library, survive
  reload, and are re-embedded on the next save. Font families supplied by the web
  app or operating system have metadata/fallbacks, not a promise of offline
  availability. Missing/unreadable faces warn and use the existing fallback stack
  without rewriting font names or authored geometry. A fallback can change glyph
  appearance/line breaks; installing the intended font restores its rendering.
- No native source-file paywall: authenticated accounts can save/download `.nsq`
  on any plan. Existing paid presentation/print export gates are unchanged.

## Save and open lifecycle

The project snapshot, settings, font sources and filename are captured at the
save gesture, before a picker or asynchronous rendering. The shared WYSIWYG
snapshot renderer captures page **one**, not the active page. A changed live
scene, failed capture or five-second optional-preview deadline results in a valid
editable package without a thumbnail, never a generic/stale logo replacement.

Compression and read-back validation finish **before** `createWritable()`.
File System Access writes commit on `close()`; write/close failures attempt
`abort()`, leaving the previous destination intact under the browser's API
contract. Picker cancellation does not download or replace anything. Saves are
serialized and handles are associated with the captured owner/project. Browsers
without File System Access receive a normal `.nsq` download instead. Regular
downloads do not overwrite a linked local file.

Open/New/Save As/Download remain in the existing editor file menu; native files
also enter through picker, drag/drop, `/open`, the projects page and the installed
PWA's `launchQueue`. The PWA launch consumer is mounted globally, including
launches while a different route is open. Actual OS associations require a
supporting browser, installed PWA and user/OS approval. Embedding preview PNGs
**does not install a Windows/macOS thumbnail provider**; automatic file-manager
thumbnails are not guaranteed. NASAQ's own intake gate displays the embedded
preview; artwork has no attribution watermark.

### Account handoff and recovery

1. Recognize and validate the complete file before showing a sign-in gate.
2. Commit the original bytes, unique handoff token and preview summary to a
   dedicated IndexedDB inbox before navigation/authentication. Unavailable or
   full storage stops the handoff instead of promising a memory-only fallback.
3. Keep that record through failed/cancelled sign-in, reload and redirects. Reuse
   the platform's existing Better Auth flow with `/editor?nsq=resume` as both
   success/error return. A second received file cannot overwrite a live pending
   file. The user can defer or explicitly discard it. Inbox retention is three
   days; browser eviction or manually clearing site data can still remove it.
4. After authentication **and** matching storage-owner hydration, save dirty
   current work, persist the received project, then open it as editable data.
   Owner/document guards prevent an asynchronous import from replacing a changed
   editor/account. Failed restoration keeps the file with retry/discard actions.
5. A deterministic ID derived from the handoff token makes crash/retry imports
   idempotent; an existing completed import is reopened, never overwritten.
   Web Locks serialize cross-tab resumes where available. Inbox deletion is
   compare-and-delete after success, not a blind clear of a possibly newer file.

## Untrusted input and budgets

ZIP central and local headers are inspected before inflation: safe relative
paths, no duplicates/overlaps, valid bounds, supported compression, no encryption,
ZIP64 or multidisk archives. Every extracted entry is streamed into a bounded
buffer and checked against declared length and CRC. Declared sizes alone are not
trusted. Default budgets: compressed 300 MiB, expanded 600 MiB, 5,000 entries,
64 MiB document, 2 MiB manifest, 64 MiB image/SVG, 32 MiB font, 4 MiB thumbnail,
500 pages, 5,000 top-level elements/page, 50,000 total elements and nesting depth 12. Table dimensions are also bounded before renderer allocation.

No package HTML, JavaScript, scripts or macros are evaluated. Native SVG must be
passive, balanced, single-root markup: no script/event handlers, foreignObject,
DOCTYPE/entities, active CSS, external links or remote paint resources. CSS URL
and executable style values are rejected. Invalid geometry, duplicate IDs,
unknown types and broken mask references reject native imports rather than
silently changing the design. The existing renderer's SVG allowlist remains a
second boundary. External/relative images in an author's live document must be
successfully resolved into supported bytes at save time; inaccessible/local
paths fail clearly, never becoming missing art in a supposedly portable file.

## Verification

```sh
npm run typecheck
npm run test:src
npm run test:nsq
npm run build
# Fresh npm run dev server (avoid stale Vite HMR module instances):
BROWSER_EXECUTABLE=/path/to/chromium TEST_FONT_FILE=/path/to/font.ttf npm run test:nsq:browser
```

Native unit tests cover editable round trips, images/vectors/fonts, migration,
metadata/settings, malformed/future archives, bounded inflation, paths, SVG,
clipping, missing assets and transactional writes. Browser QA covers real artwork
preview pixels, native downloads, free-plan portability, Save As cancellation and
snapshot/handle races, IndexedDB durability, rejected overwrites, sign-in failure
and redirect restoration, editing/reloading/re-saving fonts, invalid files,
drag/drop, simultaneous tab resumes, OS-launch entry and unavailable inbox
storage. Browser authentication endpoints and the OS launch delivery are mocked;
this is not a live Google OAuth or Windows/macOS shell certification. Generated
files and test results stay in ignored `.cache/nsq-test/`.
