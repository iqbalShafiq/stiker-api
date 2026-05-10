import sharp from 'sharp';
import type { GridBoundary, GridDetectionResult } from '../types';

export class ImageService {
  async getImageDimensions(buffer: Buffer): Promise<{ width: number; height: number }> {
    const metadata = await sharp(buffer).metadata();
    return {
      width: metadata.width ?? 0,
      height: metadata.height ?? 0,
    };
  }

  async splitImage(buffer: Buffer, boundaries: GridBoundary[]): Promise<Buffer[]> {
    const results: Buffer[] = [];

    for (const boundary of boundaries) {
      const cropped = await sharp(buffer)
        .extract({
          left: Math.round(boundary.x),
          top: Math.round(boundary.y),
          width: Math.round(boundary.width),
          height: Math.round(boundary.height),
        })
        .png()
        .toBuffer();

      results.push(cropped);
    }

    return results;
  }

  async detectGridBoundaries(buffer: Buffer): Promise<GridDetectionResult | null> {
    const { data, info } = await sharp(buffer).greyscale().raw().toBuffer({
      resolveWithObject: true,
    });

    const width = info.width;
    const height = info.height;
    if (!width || !height) {
      return null;
    }

    const colProjection = new Array<number>(width).fill(0);
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let y = 0; y < height; y++) {
        sum += data[y * width + x];
      }
      colProjection[x] = sum / height;
    }

    const rowProjection = new Array<number>(height).fill(0);
    for (let y = 0; y < height; y++) {
      let sum = 0;
      for (let x = 0; x < width; x++) {
        sum += data[y * width + x];
      }
      rowProjection[y] = sum / width;
    }

    const xIntervals = this.detectContentIntervals(colProjection, width);
    const yIntervals = this.detectContentIntervals(rowProjection, height);

    if (xIntervals.length < 2 || yIntervals.length < 2) {
      return null;
    }

    const boundaries: GridBoundary[] = [];
    for (const yInterval of yIntervals) {
      for (const xInterval of xIntervals) {
        boundaries.push({
          x: xInterval.start,
          y: yInterval.start,
          width: xInterval.end - xInterval.start + 1,
          height: yInterval.end - yInterval.start + 1,
        });
      }
    }

    return {
      gridLayout: `${yIntervals.length}x${xIntervals.length}`,
      boundaries,
    };
  }

  private detectContentIntervals(
    projection: number[],
    totalSize: number
  ): Array<{ start: number; end: number }> {
    const projectionMean = projection.reduce((sum, value) => sum + value, 0) / projection.length;
    const projectionStd = Math.sqrt(
      projection.reduce((sum, value) => sum + (value - projectionMean) ** 2, 0) /
        projection.length
    );

    const separatorThreshold = Math.min(248, projectionMean + projectionStd * 1.1);
    const minSeparatorWidth = Math.max(3, Math.round(totalSize * 0.004));
    const minCellSize = Math.max(32, Math.round(totalSize * 0.06));

    const separators: Array<{ start: number; end: number }> = [];
    let separatorStart = -1;

    for (let index = 0; index < projection.length; index++) {
      const isSeparator = projection[index] >= separatorThreshold;
      if (isSeparator && separatorStart === -1) {
        separatorStart = index;
      } else if (!isSeparator && separatorStart !== -1) {
        const separatorEnd = index - 1;
        if (separatorEnd - separatorStart + 1 >= minSeparatorWidth) {
          separators.push({ start: separatorStart, end: separatorEnd });
        }
        separatorStart = -1;
      }
    }

    if (separatorStart !== -1) {
      const separatorEnd = projection.length - 1;
      if (separatorEnd - separatorStart + 1 >= minSeparatorWidth) {
        separators.push({ start: separatorStart, end: separatorEnd });
      }
    }

    if (separators.length === 0) {
      return [];
    }

    const intervals: Array<{ start: number; end: number }> = [];
    let cursor = 0;

    for (const separator of separators) {
      if (separator.start <= cursor + 1) {
        cursor = separator.end + 1;
        continue;
      }

      const end = separator.start - 1;
      if (end - cursor + 1 >= minCellSize) {
        intervals.push({ start: cursor, end });
      }
      cursor = separator.end + 1;
    }

    if (projection.length - cursor >= minCellSize) {
      intervals.push({ start: cursor, end: projection.length - 1 });
    }

    if (intervals.length === 0) {
      return intervals;
    }

    // Expand each interval into surrounding gutter space to avoid clipping text near cell edges.
    const expandedIntervals = intervals.map((interval, index) => {
      const previous = intervals[index - 1];
      const next = intervals[index + 1];

      const prevGap = previous ? interval.start - previous.end - 1 : interval.start;
      const nextGap = next ? next.start - interval.end - 1 : totalSize - interval.end - 1;

      const expandedStart = Math.max(0, interval.start - Math.floor(Math.max(0, prevGap) / 2));
      const expandedEnd = Math.min(
        totalSize - 1,
        interval.end + Math.floor(Math.max(0, nextGap) / 2)
      );

      return { start: expandedStart, end: expandedEnd };
    });

    // Outer cells can safely stretch to image edges without touching other cells.
    // This reduces clipping risk for text near the outer border.
    if (expandedIntervals.length > 0) {
      expandedIntervals[0].start = 0;
      expandedIntervals[expandedIntervals.length - 1].end = totalSize - 1;
    }

    // Keep intervals strictly non-overlapping to avoid pulling neighboring cells.
    for (let index = 1; index < expandedIntervals.length; index++) {
      const prev = expandedIntervals[index - 1];
      const current = expandedIntervals[index];
      if (current.start <= prev.end) {
        const split = Math.floor((prev.end + current.start) / 2);
        prev.end = split;
        current.start = split + 1;
      }
    }

    return this.optimizeAdjacentSplits(projection, expandedIntervals, totalSize);
  }

  private optimizeAdjacentSplits(
    projection: number[],
    intervals: Array<{ start: number; end: number }>,
    totalSize: number
  ): Array<{ start: number; end: number }> {
    if (intervals.length < 2) {
      return intervals;
    }

    const optimized = intervals.map((interval) => ({ ...interval }));
    const minSegmentSize = Math.max(24, Math.round(totalSize * 0.04));
    const searchRadius = Math.max(6, Math.round(totalSize * 0.01));

    for (let index = 1; index < optimized.length; index++) {
      const prev = optimized[index - 1];
      const current = optimized[index];

      const midpoint = Math.floor((prev.end + current.start) / 2);
      const searchStart = Math.max(prev.start + minSegmentSize - 1, midpoint - searchRadius);
      const searchEnd = Math.min(current.end - minSegmentSize, midpoint + searchRadius);

      if (searchStart > searchEnd) {
        continue;
      }

      let bestSplit = midpoint;
      let bestScore = -Infinity;

      for (let split = searchStart; split <= searchEnd; split++) {
        const leftSize = split - prev.start + 1;
        const rightSize = current.end - split;
        if (leftSize < minSegmentSize || rightSize < minSegmentSize) {
          continue;
        }

        const separatorScore = projection[split];
        if (separatorScore > bestScore) {
          bestScore = separatorScore;
          bestSplit = split;
        }
      }

      prev.end = bestSplit;
      current.start = bestSplit + 1;
    }

    return optimized;
  }

  async removeBackground(buffer: Buffer): Promise<Buffer> {
    const { data, info } = await sharp(buffer)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const threshold = 240;
    const newData = Buffer.from(data);

    for (let i = 0; i < newData.length; i += 4) {
      const r = newData[i];
      const g = newData[i + 1];
      const b = newData[i + 2];

      if (r > threshold && g > threshold && b > threshold) {
        newData[i + 3] = 0;
      }
    }

    return sharp(newData, {
      raw: {
        width: info.width,
        height: info.height,
        channels: 4,
      },
    })
      .png()
      .toBuffer();
  }

  /**
   * Like removeBackground but only clears **near-neutral** bright pixels (studio white/grey).
   * Safer for animated-GIF fallback so light coloured foreground is less likely to be erased.
   */
  async removeNeutralBrightBackground(buffer: Buffer): Promise<Buffer> {
    const { data, info } = await sharp(buffer)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const newData = Buffer.from(data);

    for (let i = 0; i < newData.length; i += 4) {
      const r = newData[i];
      const g = newData[i + 1];
      const b = newData[i + 2];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const chroma = max === 0 ? 0 : (max - min) / max;
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;

      const neutralBright = luma >= 238 && chroma < 0.14;
      const paperWhite = luma >= 250 && chroma < 0.28;
      if (neutralBright || paperWhite) {
        newData[i + 3] = 0;
      }
    }

    return sharp(newData, {
      raw: {
        width: info.width,
        height: info.height,
        channels: 4,
      },
    })
      .png()
      .toBuffer();
  }

  /**
   * Pull partial-alpha pixels toward opaque so GIF palette encoding keeps more subject mass.
   * divisor in (0.5, 1); lower = stronger lift (e.g. 0.88).
   */
  async reinforceAlphaForGifQuantization(buffer: Buffer, divisor: number = 0.9): Promise<Buffer> {
    const safeDivisor = Math.min(0.99, Math.max(0.55, divisor));
    const { data, info } = await sharp(buffer)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const newData = Buffer.from(data);
    const minA = 12;
    const maxA = 252;

    for (let i = 3; i < newData.length; i += 4) {
      const a = newData[i];
      if (a <= minA || a >= maxA) {
        continue;
      }
      newData[i] = Math.min(255, Math.round(a / safeDivisor));
    }

    return sharp(newData, {
      raw: {
        width: info.width,
        height: info.height,
        channels: 4,
      },
    })
      .png()
      .toBuffer();
  }

  /**
   * Strip pixels that still match the dominant **border** colour of the source frame (mean of all edge pixels).
   * More robust than corners alone for scenes where the flat wall colour matches most of the perimeter.
   */
  async stripResidualNearCornerBackground(
    sourceFramePng: Buffer,
    segmentedRgba: Buffer,
    maxRgbDistance: number
  ): Promise<Buffer> {
    const { data: src, info } = await sharp(sourceFramePng)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const { data: seg, info: segInfo } = await sharp(segmentedRgba)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const w = info.width;
    const h = info.height;
    if (!w || !h || segInfo.width !== w || segInfo.height !== h) {
      return segmentedRgba;
    }

    let br = 0;
    let bg = 0;
    let bb = 0;
    let n = 0;
    for (let x = 0; x < w; x++) {
      for (const y of [0, h - 1]) {
        const i = (y * w + x) * 4;
        br += src[i];
        bg += src[i + 1];
        bb += src[i + 2];
        n += 1;
      }
    }
    for (let y = 1; y < h - 1; y++) {
      for (const x of [0, w - 1]) {
        const i = (y * w + x) * 4;
        br += src[i];
        bg += src[i + 1];
        bb += src[i + 2];
        n += 1;
      }
    }
    br /= n;
    bg /= n;
    bb /= n;

    const out = Buffer.from(seg);
    const distSqMax = maxRgbDistance * maxRgbDistance;
    /** Skip stripping on very dark originals (navy suit vs purple wall). */
    const darkProtectMaxChannel = 72;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4;
        if (out[o + 3] === 0) {
          continue;
        }
        const r = src[o];
        const g = src[o + 1];
        const b = src[o + 2];
        if (Math.max(r, g, b) < darkProtectMaxChannel) {
          continue;
        }
        const mx = Math.max(r, g, b);
        const mn = Math.min(r, g, b);
        const saturation = mx === 0 ? 0 : (mx - mn) / mx;
        if (saturation > 0.38) {
          continue;
        }
        const dr = r - br;
        const dg = g - bg;
        const db = b - bb;
        if (dr * dr + dg * dg + db * db <= distSqMax) {
          out[o + 3] = 0;
        }
      }
    }

    return sharp(out, {
      raw: {
        width: w,
        height: h,
        channels: 4,
      },
    })
      .png()
      .toBuffer();
  }

  /**
   * Reduce frame-to-frame mask flicker / “chopped Batman” by taking a **rolling temporal max**
   * on alpha (±halfWindow frames), repeated `passes` times (widens temporal support).
   * RGB stays tied to each frame’s pixels (assume motion is sticker-scale).
   */
  async stabilizeAnimatedAlphaTemporalCoherence(
    frames: Buffer[],
    halfWindow: number,
    passes: number
  ): Promise<Buffer[]> {
    if (frames.length < 2 || halfWindow < 1 || passes < 1) {
      return frames;
    }

    let currentBuffers = frames;

    for (let pass = 0; pass < passes; pass++) {
      const raws = await Promise.all(
        currentBuffers.map((f) => sharp(f).ensureAlpha().raw().toBuffer({ resolveWithObject: true }))
      );
      const n = currentBuffers.length;
      const w = raws[0].info.width;
      const h = raws[0].info.height;
      const pix = w * h;

      for (let i = 1; i < n; i++) {
        if (raws[i].info.width !== w || raws[i].info.height !== h) {
          return frames;
        }
      }

      const nextBuffers: Buffer[] = [];
      for (let fi = 0; fi < n; fi++) {
        const base = Buffer.from(raws[fi].data);
        const kLow = fi - halfWindow;
        const kHigh = fi + halfWindow;

        for (let pIdx = 0; pIdx < pix; pIdx++) {
          const o = pIdx * 4;
          let mx = 0;
          for (
            let k = Math.max(0, kLow);
            k <= Math.min(n - 1, kHigh);
            k++
          ) {
            const ak = raws[k].data[o + 3];
            if (ak > mx) {
              mx = ak;
            }
          }
          base[o + 3] = mx;
        }

        nextBuffers.push(
          await sharp(base, {
            raw: {
              width: w,
              height: h,
              channels: 4,
            },
          })
            .png()
            .toBuffer()
        );
      }

      currentBuffers = nextBuffers;
    }

    return currentBuffers;
  }

  /**
   * Heuristic cleanup after ML/GIF quantization: removes pale low-saturation speckles (leftover wall)
   * and restores solid alpha on dark saturated regions (flat-colour cartoon suits/cowls).
   */
  async repairCartoonFlattenedAlpha(buffer: Buffer): Promise<Buffer> {
    const { data, info } = await sharp(buffer)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const w = info.width;
    const h = info.height;
    const out = Buffer.from(data);

    for (let i = 0; i < out.length; i += 4) {
      const r = out[i];
      const g = out[i + 1];
      const b = out[i + 2];
      const mx = Math.max(r, g, b);
      const mn = Math.min(r, g, b);
      const saturation = mx === 0 ? 0 : (mx - mn) / mx;
      const a = out[i + 3];

      if (a === 0) {
        continue;
      }

      if (mx > 198 && saturation < 0.26 && a < 168) {
        out[i + 3] = 0;
        continue;
      }

      if (mx <= 135 && saturation >= 0.06 && a >= 22) {
        out[i + 3] = 255;
      }
    }

    return sharp(out, {
      raw: {
        width: w,
        height: h,
        channels: 4,
      },
    })
      .png()
      .toBuffer();
  }

  /** Morphological close on the alpha band only (dilate→erode). */
  async morphologicalCloseAlpha(buffer: Buffer, kernelSize: number): Promise<Buffer> {
    if (kernelSize < 3 || kernelSize % 2 === 0) {
      return buffer;
    }

    const { data, info } = await sharp(buffer)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const width = info.width;
    const height = info.height;
    const radius = Math.floor(kernelSize / 2);
    const pix = width * height;
    const alpha = new Uint8Array(pix);
    for (let i = 0, j = 0; j < pix; i += 4, j++) {
      alpha[j] = data[i + 3];
    }

    const dilated = new Uint8Array(pix);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let mx = 0;
        for (let dy = -radius; dy <= radius; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= height) {
            continue;
          }
          for (let dx = -radius; dx <= radius; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= width) {
              continue;
            }
            const v = alpha[yy * width + xx];
            if (v > mx) {
              mx = v;
            }
          }
        }
        dilated[y * width + x] = mx;
      }
    }

    const closed = new Uint8Array(pix);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let mn = 255;
        for (let dy = -radius; dy <= radius; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= height) {
            continue;
          }
          for (let dx = -radius; dx <= radius; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= width) {
              continue;
            }
            const v = dilated[yy * width + xx];
            if (v < mn) {
              mn = v;
            }
          }
        }
        closed[y * width + x] = mn;
      }
    }

    const out = Buffer.from(data);
    for (let j = 0; j < pix; j++) {
      out[j * 4 + 3] = closed[j];
    }

    return sharp(out, {
      raw: {
        width,
        height,
        channels: 4,
      },
    })
      .png()
      .toBuffer();
  }

  /** Dilate alpha only (expand FG mask spatially without erode shrink). Odd kernel ≥ 3. */
  async morphologicalDilateAlpha(buffer: Buffer, kernelSize: number): Promise<Buffer> {
    if (kernelSize < 3 || kernelSize % 2 === 0) {
      return buffer;
    }

    const { data, info } = await sharp(buffer)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const width = info.width;
    const height = info.height;
    const radius = Math.floor(kernelSize / 2);
    const pix = width * height;
    const alpha = new Uint8Array(pix);
    for (let i = 0, j = 0; j < pix; i += 4, j++) {
      alpha[j] = data[i + 3];
    }

    const dilated = new Uint8Array(pix);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let mx = 0;
        for (let dy = -radius; dy <= radius; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= height) {
            continue;
          }
          for (let dx = -radius; dx <= radius; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= width) {
              continue;
            }
            const v = alpha[yy * width + xx];
            if (v > mx) {
              mx = v;
            }
          }
        }
        dilated[y * width + x] = mx;
      }
    }

    const out = Buffer.from(data);
    for (let j = 0; j < pix; j++) {
      out[j * 4 + 3] = dilated[j];
    }

    return sharp(out, {
      raw: {
        width,
        height,
        channels: 4,
      },
    })
      .png()
      .toBuffer();
  }

  async hasMeaningfulTransparency(
    buffer: Buffer,
    minTransparentRatio: number = 0.02
  ): Promise<boolean> {
    const { data } = await sharp(buffer)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const pixelCount = data.length / 4;
    if (pixelCount === 0) {
      return false;
    }

    let transparentPixels = 0;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] < 245) {
        transparentPixels += 1;
      }
    }

    const transparentRatio = transparentPixels / pixelCount;
    return transparentRatio >= minTransparentRatio;
  }

  async resizeImage(buffer: Buffer, width: number, height: number): Promise<Buffer> {
    return sharp(buffer)
      .resize(width, height, { fit: 'cover' })
      .png()
      .toBuffer();
  }

  async resizeToSquareContain(buffer: Buffer, size: number = 512): Promise<Buffer> {
    return sharp(buffer)
      .resize(size, size, {
        fit: 'contain',
        background: { r: 255, g: 255, b: 255, alpha: 0 },
      })
      .png()
      .toBuffer();
  }

  async convertToPng(buffer: Buffer): Promise<Buffer> {
    return sharp(buffer).png().toBuffer();
  }
}
