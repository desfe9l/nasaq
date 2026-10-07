/**
 * Compile-time contract for the runtime module emitted by
 * scripts/emit-share-raster-assets.mjs before Vite dev/build starts.
 *
 * The generated .ts stays ignored because it embeds binary assets; this tracked
 * declaration lets `tsc --noEmit` resolve the import in a clean checkout.
 */
export declare const wasm: Uint8Array;
export declare const fonts: Uint8Array[];
