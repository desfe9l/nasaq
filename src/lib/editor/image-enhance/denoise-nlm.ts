/**
 * Non-local means image denoiser — pure TypeScript, no dependencies.
 *
 * This is the same algorithm family as OpenCV's `fastNlMeansDenoisingColored`
 * (the reference "detail-preserving" denoiser): every pixel becomes a weighted
 * average of same-coloured pixels found *anywhere* in its search window,
 * weighted by full patch similarity. Because the weight of a neighbour depends
 * on how closely its surrounding patch matches, edges and fine texture survive
 * while flat, noisy areas smooth out — the failure mode of plain blur
 * (everything smears) does not occur.
 *
 * Optimisations implemented here:
 *  - RGB → YCbCr split: luma is denoised at full resolution, chroma at half
 *    resolution with a stronger filter (matches camera-pipeline practice and
 *    cuts cost ~4× while chroma noise is perceptually less important).
 *  - Per-offset squared-difference maps summed with O(1)-per-pixel sliding
 *    window sums (row prefix + vertical running sum) instead of O(patch) sums.
 *  - Noise level is estimated robustly from the image itself (median of the
 *    Laplacian detail band — the classical Loupas estimator), so one click
 *    works on any photo without a strength dial; images without measurable
 *    noise are returned untouched.
 *  - Tiling with overlap keeps memory bounded for large photos.
 *
 * The module is DOM-free on purpose: it runs unchanged in the processing Web
 * Worker and in Node unit tests.
 */

export interface DenoiseInput {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface DenoiseResult {
  data: Uint8ClampedArray;
  /** True when the image was already clean and nothing was changed. */
  skipped: boolean;
  /** Estimated luminance noise sigma (0 when skipped). */
  sigma: number;
}

export interface DenoiseOptions {
  /** Called after each tile finishes: (completedTiles, totalTiles). */
  onTileProgress?: (done: number, total: number) => void;
}

/** Patch radius: 5×5 similarity patches. */
const PATCH_RADIUS = 2;
/** Tile core size; overlap must cover search + patch. */
const TILE_CORE = 1024;
/** Use a 7×7 search window up to this many pixels, 5×5 above it. */
const WIDE_SEARCH_MAX_PIXELS = 6_000_000;
/** Below this estimated sigma the image is considered clean. */
const MIN_SIGMA = 0.75;
/** Filter strength multipliers on estimated sigma (luma / chroma). */
const K_LUMA = 1.2;
const K_CHROMA = 1.7;

/* ------------------------------------------------------------------ */
/* Noise estimation                                                    */
/* ------------------------------------------------------------------ */

/**
 * Robust noise sigma from the Laplacian detail band:
 * sigma = median(|L|) / (0.6745 * 6), where L is the 3×3 second-derivative
 * convolution. The constant 6 is the L2 norm of the kernel; 0.6745 converts a
 * median of |N(0,1)| to a standard deviation. Histogram-based median keeps it
 * O(N) for huge images.
 */
export function estimateSigma(y: Float32Array, width: number, height: number): number {
  if (width < 3 || height < 3) return 0;
  const BINS = 4096;
  const SCALE = 8; // |L| bucket width; saturates far above any real noise
  const hist = new Uint32Array(BINS + 1);
  let count = 0;
  for (let iy = 1; iy < height - 1; iy += 1) {
    const row = iy * width;
    const up = row - width;
    const dn = row + width;
    for (let x = 1; x < width - 1; x += 1) {
      const l =
        y[up + x - 1] -
        2 * y[up + x] +
        y[up + x + 1] -
        2 * y[row + x - 1] +
        4 * y[row + x] -
        2 * y[row + x + 1] +
        y[dn + x - 1] -
        2 * y[dn + x] +
        y[dn + x + 1];
      const a = Math.abs(l);
      const bin = a >= BINS * SCALE ? BINS : (a / SCALE) | 0;
      hist[bin] += 1;
      count += 1;
    }
  }
  if (!count) return 0;
  const half = count / 2;
  let acc = 0;
  for (let b = 0; b <= BINS; b += 1) {
    acc += hist[b];
    if (acc >= half) {
      // Lower bound of the median bin: a truly flat image lands in bin 0 and
      // yields sigma 0, which the caller maps to "already clean".
      const detail = b * SCALE;
      return detail / (0.6745 * 6);
    }
  }
  return 0;
}

/* ------------------------------------------------------------------ */
/* Colour conversion                                                   */
/* ------------------------------------------------------------------ */

/** BT.601 full-range RGB → YCbCr (Y only allocated at full resolution). */
function toYCbCr(input: DenoiseInput): {
  y: Float32Array;
  cb: Float32Array;
  cr: Float32Array;
  cw: number;
  ch: number;
} {
  const { data, width, height } = input;
  const n = width * height;
  const y = new Float32Array(n);
  const cw = (width + 1) >> 1;
  const ch = (height + 1) >> 1;
  const cb = new Float32Array(cw * ch);
  const cr = new Float32Array(cw * ch);
  for (let i = 0, p = 0; i < n; i += 1, p += 4) {
    const r = data[p];
    const g = data[p + 1];
    const b = data[p + 2];
    y[i] = 0.299 * r + 0.587 * g + 0.114 * b;
  }
  for (let cy = 0; cy < ch; cy += 1) {
    const y0 = cy * 2;
    const y1 = Math.min(y0 + 1, height - 1);
    for (let cx = 0; cx < cw; cx += 1) {
      const x0 = cx * 2;
      const x1 = Math.min(x0 + 1, width - 1);
      let sCb = 0;
      let sCr = 0;
      for (const yy of [y0, y1]) {
        for (const xx of [x0, x1]) {
          const p = (yy * width + xx) * 4;
          const r = data[p];
          const g = data[p + 1];
          const b = data[p + 2];
          sCb += 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
          sCr += 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
        }
      }
      cb[cy * cw + cx] = sCb / 4;
      cr[cy * cw + cx] = sCr / 4;
    }
  }
  return { y, cb, cr, cw, ch };
}

/* ------------------------------------------------------------------ */
/* exp lookup table                                                    */
/* ------------------------------------------------------------------ */

const EXP_RANGE = 24;
const EXP_BINS = 2048;
const EXP_TABLE = new Float32Array(EXP_BINS + 1);
for (let i = 0; i <= EXP_BINS; i += 1) {
  EXP_TABLE[i] = Math.exp((-i * EXP_RANGE) / EXP_BINS);
}
EXP_TABLE[EXP_BINS] = 0;

function weightOf(x: number): number {
  if (x <= 0) return 1;
  if (x >= EXP_RANGE) return 0;
  return EXP_TABLE[((x / EXP_RANGE) * EXP_BINS) | 0];
}

/* ------------------------------------------------------------------ */
/* Tiled non-local means on a single channel                           */
/* ------------------------------------------------------------------ */

function nlmChannel(
  src: Float32Array,
  width: number,
  height: number,
  searchRadius: number,
  sigma: number,
  k: number,
  reportTile: ((done: number, total: number) => void) | undefined,
): Float32Array {
  const out = new Float32Array(src.length);
  const patch = PATCH_RADIUS;
  const pad = searchRadius + patch + 1;
  const bias = 2 * sigma * sigma; // E[d̄²] of two identical noisy patches
  const h2 = (k * sigma) * (k * sigma);

  const tilesX = Math.max(1, Math.ceil(width / TILE_CORE));
  const tilesY = Math.max(1, Math.ceil(height / TILE_CORE));
  const totalTiles = tilesX * tilesY;
  let doneTiles = 0;

  for (let ty = 0; ty < tilesY; ty += 1) {
    for (let tx = 0; tx < tilesX; tx += 1) {
      const x0 = tx * TILE_CORE;
      const y0 = ty * TILE_CORE;
      const x1 = Math.min(width, x0 + TILE_CORE);
      const y1 = Math.min(height, y0 + TILE_CORE);

      // Tile rect padded so every core pixel's search+patch window fits.
      const px0 = Math.max(0, x0 - pad);
      const py0 = Math.max(0, y0 - pad);
      const px1 = Math.min(width, x1 + pad);
      const py1 = Math.min(height, y1 + pad);
      const tw = px1 - px0;
      const th = py1 - py0;

      const tile = new Float32Array(tw * th);
      for (let yy = 0; yy < th; yy += 1) {
        const srcRow = (py0 + yy) * width + px0;
        tile.set(src.subarray(srcRow, srcRow + tw), yy * tw);
      }

      const coreW = x1 - x0;
      const coreH = y1 - y0;
      const sum = new Float32Array(coreW * coreH);
      const wsum = new Float32Array(coreW * coreH);

      // Centre pixel contributes with unit weight (the classic NLM anchor).
      for (let cy = 0; cy < coreH; cy += 1) {
        const tileRow = (y0 - py0 + cy) * tw + (x0 - px0);
        for (let cx = 0; cx < coreW; cx += 1) {
          const i = cy * coreW + cx;
          sum[i] = tile[tileRow + cx];
          wsum[i] = 1;
        }
      }

      const d = new Float32Array(tw * th);
      const integral = new Float64Array((tw + 1) * (th + 1));

      for (let dy = -searchRadius; dy <= searchRadius; dy += 1) {
        for (let dx = -searchRadius; dx <= searchRadius; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          if (dx >= tw || -dx >= tw || dy >= th || -dy >= th) continue;

          // Squared difference map D(q) = (T(q) - T(q+δ))² where defined.
          const qx0 = dx > 0 ? 0 : -dx;
          const qx1 = dx > 0 ? tw - dx : tw;
          const qy0 = dy > 0 ? 0 : -dy;
          const qy1 = dy > 0 ? th - dy : th;
          d.fill(0);
          for (let yy = qy0; yy < qy1; yy += 1) {
            const row = yy * tw;
            const off = dy * tw + dx;
            for (let xx = qx0; xx < qx1; xx += 1) {
              const v = tile[row + xx] - tile[row + xx + off];
              d[row + xx] = v * v;
            }
          }

          accumulateOffset(
            tile,
            d,
            integral,
            tw,
            th,
            px0,
            py0,
            x0,
            y0,
            coreW,
            coreH,
            dx,
            dy,
            patch,
            bias,
            h2,
            sum,
            wsum,
            qx0,
            qx1,
            qy0,
            qy1,
          );
        }
      }

      for (let cy = 0; cy < coreH; cy += 1) {
        const outRow = (y0 + cy) * width + x0;
        const base = cy * coreW;
        for (let cx = 0; cx < coreW; cx += 1) {
          out[outRow + cx] = sum[base + cx] / wsum[base + cx];
        }
      }

      doneTiles += 1;
      reportTile?.(doneTiles, totalTiles);
    }
  }
  return out;
}

/**
 * Accumulate one search offset into (sum, wsum) using an integral image of
 * the squared-difference map. Float64 keeps prefix sums exact at tile size;
 * the buffer is reused across offsets to keep GC pressure flat.
 */
function accumulateOffset(
  tile: Float32Array,
  d: Float32Array,
  integral: Float64Array,
  tw: number,
  th: number,
  px0: number,
  py0: number,
  x0: number,
  y0: number,
  coreW: number,
  coreH: number,
  dx: number,
  dy: number,
  patch: number,
  bias: number,
  h2: number,
  sum: Float32Array,
  wsum: Float32Array,
  qx0: number,
  qx1: number,
  qy0: number,
  qy1: number,
): void {
  const iw = tw + 1;
  integral.fill(0);
  for (let yy = 0; yy < th; yy += 1) {
    let rowAcc = 0;
    const dRow = yy * tw;
    const iRow = (yy + 1) * iw;
    const iPrev = yy * iw;
    for (let xx = 0; xx < tw; xx += 1) {
      rowAcc += d[dRow + xx];
      integral[iRow + xx + 1] = integral[iPrev + xx + 1] + rowAcc;
    }
  }

  for (let cy = 0; cy < coreH; cy += 1) {
    const gy = y0 + cy; // global pixel y
    // Candidate value is T(p + δ); guard its ROW stays inside the tile. At
    // the outer image border the tile is clamped, so offsets pointing past
    // the edge would read outside the array (NaN) without this.
    const srcRow = gy - py0 + dy;
    if (srcRow < 0 || srcRow >= th) continue;
    // Patch box around p, intersected with the region where D is defined.
    // At the outer image border the box shrinks; dividing by the actual
    // compared area keeps the distance unbiased (no over-smoothing there).
    const by0 = Math.max(qy0, gy - patch - py0);
    const by1 = Math.min(qy1, gy + patch - py0 + 1);
    if (by1 <= by0) continue;
    const iTop = by0 * iw;
    const iBot = by1 * iw;
    const tileSrcRow = srcRow * tw;
    for (let cx = 0; cx < coreW; cx += 1) {
      const gx = x0 + cx;
      const bx0 = Math.max(qx0, gx - patch - px0);
      const bx1 = Math.min(qx1, gx + patch - px0 + 1);
      if (bx1 <= bx0) continue;
      // Candidate value is T(p + δ); guard its column stays inside the tile.
      const srcX = gx - px0 + dx;
      if (srcX < 0 || srcX >= tw) continue;
      const area = (bx1 - bx0) * (by1 - by0);
      const d2 =
        (integral[iBot + bx1] -
          integral[iBot + bx0] -
          integral[iTop + bx1] +
          integral[iTop + bx0]) /
        area;
      const w = weightOf((d2 - bias) / h2);
      if (w <= 0) continue;
      const i = cy * coreW + cx;
      sum[i] += w * tile[tileSrcRow + srcX];
      wsum[i] += w;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Public entry                                                        */
/* ------------------------------------------------------------------ */

/** Search radius picked for the image size (bounds runtime on huge photos). */
export function searchRadiusFor(pixelCount: number): number {
  return pixelCount <= WIDE_SEARCH_MAX_PIXELS ? 3 : 2;
}

/**
 * Denoise RGBA pixels in place semantics: returns a fresh array, alpha bytes
 * copied through untouched. Deterministic for identical input.
 */
export function denoiseImage(
  input: DenoiseInput,
  options: DenoiseOptions = {},
): DenoiseResult {
  const { data, width, height } = input;
  if (width < 3 || height < 3) {
    return { data: new Uint8ClampedArray(data), skipped: true, sigma: 0 };
  }
  const { y, cb, cr, cw, ch } = toYCbCr(input);
  const sigma = estimateSigma(y, width, height);
  if (sigma < MIN_SIGMA) {
    return { data: new Uint8ClampedArray(data), skipped: true, sigma };
  }

  const radius = searchRadiusFor(width * height);
  const totalTiles =
    Math.max(1, Math.ceil(width / TILE_CORE)) *
    Math.max(1, Math.ceil(height / TILE_CORE));
  // Chroma tiles finish too; report luma + chroma as one 100% track.
  let done = 0;
  const report = (finished: number, of: number): void => {
    done += 1;
    const chromaTiles =
      Math.max(1, Math.ceil(cw / TILE_CORE)) * Math.max(1, Math.ceil(ch / TILE_CORE));
    const totalAll = totalTiles + 2 * chromaTiles;
    options.onTileProgress?.(Math.min(done, totalAll), totalAll);
    void finished;
    void of;
  };

  const yDenoised = nlmChannel(y, width, height, radius, sigma, K_LUMA, report);
  const cbDenoised = nlmChannel(cb, cw, ch, 2, sigma, K_CHROMA, report);
  const crDenoised = nlmChannel(cr, cw, ch, 2, sigma, K_CHROMA, report);

  const out = new Uint8ClampedArray(width * height * 4);
  for (let py = 0; py < height; py += 1) {
    const fy = py / 2;
    const cy0 = Math.min(ch - 1, fy | 0);
    const cy1 = Math.min(ch - 1, cy0 + 1);
    const fy1 = fy - cy0;
    for (let px = 0; px < width; px += 1) {
      const fx = px / 2;
      const cx0 = Math.min(cw - 1, fx | 0);
      const cx1 = Math.min(cw - 1, cx0 + 1);
      const fx1 = fx - cx0;
      // Bilinear upsample of the denoised chroma planes.
      const cbV =
        cbDenoised[cy0 * cw + cx0] * (1 - fx1) * (1 - fy1) +
        cbDenoised[cy0 * cw + cx1] * fx1 * (1 - fy1) +
        cbDenoised[cy1 * cw + cx0] * (1 - fx1) * fy1 +
        cbDenoised[cy1 * cw + cx1] * fx1 * fy1;
      const crV =
        crDenoised[cy0 * cw + cx0] * (1 - fx1) * (1 - fy1) +
        crDenoised[cy0 * cw + cx1] * fx1 * (1 - fy1) +
        crDenoised[cy1 * cw + cx0] * (1 - fx1) * fy1 +
        crDenoised[cy1 * cw + cx1] * fx1 * fy1;
      const Y = yDenoised[py * width + px];
      const r = Y + 1.402 * (crV - 128);
      const g = Y - 0.344136 * (cbV - 128) - 0.714136 * (crV - 128);
      const b = Y + 1.772 * (cbV - 128);
      const p = (py * width + px) * 4;
      out[p] = r < 0 ? 0 : r > 255 ? 255 : r;
      out[p + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
      out[p + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
      out[p + 3] = data[p + 3];
    }
  }
  return { data: out, skipped: false, sigma };
}
