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
