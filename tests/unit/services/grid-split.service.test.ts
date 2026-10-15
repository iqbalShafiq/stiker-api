import { beforeEach, describe, it, expect, vi } from 'vitest';
import { GridSplitService } from '../../../src/services/grid-split.service';
import type { ImageGenerationService } from '../../../src/services/image-generation.service';
import type { VisionAnalysisService } from '../../../src/services/vision-analysis.service';
import type { ImageService } from '../../../src/services/image.service';
import type { IStorageProvider } from '../../../src/storage/interface';
import { BackgroundRemovalError, GridDetectionError } from '../../../src/errors';

const removeBackgroundMock = vi.hoisted(() => vi.fn());

vi.mock('../../../src/services/background-removal.service', () => ({
  removeBackground: removeBackgroundMock,
}));

function visionBase() {
  return {
    detectGridBoundaries: vi.fn(async () => ({
      gridLayout: '2x1',
      boundaries: [
        { x: 0, y: 0, width: 256, height: 512 },
        { x: 256, y: 0, width: 256, height: 512 },
      ],
    })),
    analyzeCellTextOutsideForeground: vi.fn(async () => ({
      hasTextOutsideForeground: false,
      textOutsideForeground: [],
    })),
  };
}

function imageServiceBase() {
  return {
    splitImage: vi.fn(async () => [Buffer.from('cell-1'), Buffer.from('cell-2')]),
    resizeToSquareContain: vi.fn(async (buffer: Buffer) => buffer),
    getImageDimensions: vi.fn(async () => ({ width: 512, height: 512 })),
  };
}

function storageBase() {
  return {
    saveFile: vi.fn(async (_buffer: Buffer, options?: { baseName?: string }) => {
      return `${options?.baseName ?? 'file'}.png`;
    }),
    getPublicUrl: vi.fn((filename: string) => `/uploads/${filename}`),
  };
}

describe('GridSplitService extractTextAssets', () => {
  it('returns text assets with merged outside-foreground text and metadata', async () => {
    const visionAnalysisServiceMock = {
      analyzeCellTextOutsideForeground: vi
        .fn()
        .mockResolvedValueOnce({
          hasTextOutsideForeground: true,
          textOutsideForeground: [
            {
              text: 'Hello',
              style: { fontFamily: 'sans-serif', color: '#ffffff', weight: 'bold' },
            },
            {
              text: 'World',
              style: { fontFamily: 'sans-serif', color: '#ffffff', weight: 'bold' },
            },
          ],
        })
        .mockResolvedValueOnce({
          hasTextOutsideForeground: false,
          textOutsideForeground: [],
        }),
    } as unknown as VisionAnalysisService;

    const imageGenerationServiceMock = {} as ImageGenerationService;
    const imageServiceMock = {} as ImageService;
    const storageServiceMock = {} as IStorageProvider;
    const service = new GridSplitService(
      imageGenerationServiceMock,
      visionAnalysisServiceMock,
      imageServiceMock,
      storageServiceMock
    );

    const result = await service.extractTextAssets([Buffer.from('a'), Buffer.from('b')]);

    expect(result.assets).toHaveLength(2);
    expect(result.assets[0]).toEqual({
      id: 'cell-01',
      textAssetDecoration: {
        text: 'Hello World',
        style: { fontFamily: 'sans-serif', color: '#ffffff', weight: 'bold' },
        source: 'detected',
      },
      textOutsideForeground: {
        text: 'Hello World',
        style: { fontFamily: 'sans-serif', color: '#ffffff', weight: 'bold' },
      },
    });
    expect(result.assets[1]).toEqual({
      id: 'cell-02',
    });
    expect(result.metadata).toEqual({
      gridLayout: 'custom-cells',
      cellCount: 2,
      outputSize: 'source',
      normalized: false,
      backgroundRemoved: false,
      backgroundRemovalMethod: 'none',
    });
  });
});

describe('GridSplitService split', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function buildService(overrides: {
    vision?: ReturnType<typeof visionBase>;
    imageGeneration?: { normalizeGridImage: ReturnType<typeof vi.fn> };
    imageService?: ReturnType<typeof imageServiceBase>;
  } = {}) {
    const imageService = overrides.imageService ?? imageServiceBase();
    const service = new GridSplitService(
      (overrides.imageGeneration ?? { normalizeGridImage: vi.fn() }) as unknown as ImageGenerationService,
      (overrides.vision ?? visionBase()) as unknown as VisionAnalysisService,
      imageService as unknown as ImageService,
      storageBase() as unknown as IStorageProvider
    );
    return { service, imageService };
  }

  it('keeps splitting when a single cell fails background removal (per-cell tolerance)', async () => {
    removeBackgroundMock
      .mockRejectedValueOnce(new BackgroundRemovalError('cell failed'))
      .mockResolvedValueOnce({ processedBuffer: Buffer.from('removed'), method: 'imgly-onnx' });

    const { service } = buildService();
    const result = await service.split(Buffer.from('grid'), { outputSubDir: 'grid-split/x' });

    expect(result.images).toHaveLength(2);
    expect(removeBackgroundMock).toHaveBeenCalledTimes(2);
    expect(result.metadata.backgroundRemoved).toBe(true);
    expect(result.metadata.backgroundRemovalMethod).toBe('post-split:imgly-onnx');
  });

  it('reports normalized:false and splits the original when normalization fails', async () => {
    removeBackgroundMock.mockResolvedValue({
      processedBuffer: Buffer.from('removed'),
      method: 'imgly-onnx',
    });
    const gridBuffer = Buffer.from('grid');
    const { service, imageService } = buildService({
      imageGeneration: { normalizeGridImage: vi.fn().mockRejectedValue(new Error('normalize failed')) },
    });

    const result = await service.split(gridBuffer, {
      outputSubDir: 'grid-split/x',
      normalize: true,
    });

    expect(result.metadata.normalized).toBe(false);
    expect(imageService.splitImage).toHaveBeenCalledTimes(1);
    expect(imageService.splitImage.mock.calls[0][0]).toBe(gridBuffer);
    expect(result.images).toHaveLength(2);
  });

  it('propagates grid detection errors instead of falling back', async () => {
    const vision = {
      ...visionBase(),
      detectGridBoundaries: vi.fn().mockRejectedValue(new GridDetectionError('AI grid detection failed')),
    };
    const { service } = buildService({ vision });

    await expect(
      service.split(Buffer.from('grid'), { outputSubDir: 'grid-split/x' })
    ).rejects.toMatchObject({ code: 'GRID_DETECTION_FAILED', statusCode: 422 });
    expect(removeBackgroundMock).not.toHaveBeenCalled();
  });

  it('returns cells without text assets when every cell analysis fails', async () => {
    removeBackgroundMock.mockResolvedValue({
      processedBuffer: Buffer.from('removed'),
      method: 'imgly-onnx',
    });
    const vision = {
      ...visionBase(),
      analyzeCellTextOutsideForeground: vi.fn().mockRejectedValue(new Error('vision down')),
    };
    const { service } = buildService({ vision });

    const result = await service.split(Buffer.from('grid'), { outputSubDir: 'grid-split/x' });

    expect(result.images).toHaveLength(2);
    expect(result.images.every((image) => image.textOutsideForeground === undefined)).toBe(true);
  });
});
