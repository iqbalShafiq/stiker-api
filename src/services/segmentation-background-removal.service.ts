import fs from 'fs/promises';
import path from 'path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { removeBackground } from '@imgly/background-removal-node';
import type { Config as ImglyBackgroundRemovalConfig } from '@imgly/background-removal-node';
import { config } from '../config';

/**
 * Local ONNX segmentation via IMG.LY (@imgly/background-removal-node).
 * Uses a small concurrency limit so multiple concurrent API requests do not OOM the server.
 */
function filesystemDirToImglyPublicPath(dirPath: string): string {
  const resolved = path.resolve(dirPath);
  const withSlash = resolved.endsWith(path.sep) ? resolved : `${resolved}${path.sep}`;
  return pathToFileURL(withSlash).href;
}

export class SegmentationBackgroundRemovalService {
  private readonly publicPath: string;
  private readonly model: 'small' | 'medium' | 'large';
  private readonly maxConcurrency: number;
  private permits: number;
  private readonly waitQueue: Array<() => void> = [];

  constructor(
    options?: Partial<{
      /** Writable directory on disk (filesystem path; converted to file:// for IMG.LY). */
      publicPath: string;
      model: 'small' | 'medium' | 'large';
      maxConcurrency: number;
    }>
  ) {
    this.publicPath =
      options?.publicPath ?? config.imglyBackgroundRemoval.publicPath;
    this.model = options?.model ?? config.imglyBackgroundRemoval.model;
    this.maxConcurrency = Math.max(
      1,
      options?.maxConcurrency ?? config.imglyBackgroundRemoval.maxConcurrency
    );
    this.permits = this.maxConcurrency;
  }

  async remove(imageBuffer: Buffer): Promise<Buffer> {
    await this.ensureCacheDir();
    await this.acquire();

    try {
      const decodedPng = await sharp(imageBuffer).png().toBuffer();
      const imageBlob = new Blob([decodedPng], { type: 'image/png' });

      const imglyConfig: ImglyBackgroundRemovalConfig = {
        publicPath: filesystemDirToImglyPublicPath(this.publicPath),
        model: this.model,
        output: {
          format: 'image/png',
          quality: 1,
        },
      };

      const blob = await removeBackground(imageBlob, imglyConfig);
      const arrayBuffer = await blob.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } finally {
      this.release();
    }
  }

  private async ensureCacheDir(): Promise<void> {
    await fs.mkdir(this.publicPath, { recursive: true });
  }

  private acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      this.waitQueue.push(resolve);
    });
  }

  private release(): void {
    const next = this.waitQueue.shift();
    if (next) {
      next();
      return;
    }

    this.permits++;
  }
}

const globalKey = '__stikerApi_segmentationBgRemoval__';

function getGlobalInstance(): SegmentationBackgroundRemovalService | undefined {
  return (globalThis as Record<string, unknown>)[globalKey] as
    | SegmentationBackgroundRemovalService
    | undefined;
}

function setGlobalInstance(service: SegmentationBackgroundRemovalService): void {
  (globalThis as Record<string, unknown>)[globalKey] = service;
}

/** Shared instance so all controllers share one model cache and one concurrency limiter. */
export function getSegmentationBackgroundRemovalService(): SegmentationBackgroundRemovalService {
  const existing = getGlobalInstance();
  if (existing) {
    return existing;
  }

  const resolvedPublicPath = path.isAbsolute(config.imglyBackgroundRemoval.publicPath)
    ? config.imglyBackgroundRemoval.publicPath
    : path.resolve(process.cwd(), config.imglyBackgroundRemoval.publicPath);

  const service = new SegmentationBackgroundRemovalService({
    publicPath: resolvedPublicPath,
    model: config.imglyBackgroundRemoval.model,
    maxConcurrency: config.imglyBackgroundRemoval.maxConcurrency,
  });
  setGlobalInstance(service);
  return service;
}
