import { describe, it, expect, vi } from 'vitest';
import { GridSplitService } from '../../../src/services/grid-split.service';
import type { OpenRouterService } from '../../../src/services/openrouter.service';
import type { ImageService } from '../../../src/services/image.service';
import type { IStorageProvider } from '../../../src/storage/interface';

describe('GridSplitService extractTextAssets', () => {
  it('returns text assets with merged outside-foreground text and metadata', async () => {
    const openRouterServiceMock = {
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
    } as unknown as OpenRouterService;

    const imageServiceMock = {} as ImageService;
    const storageServiceMock = {} as IStorageProvider;
    const service = new GridSplitService(openRouterServiceMock, imageServiceMock, storageServiceMock);

    const result = await service.extractTextAssets([Buffer.from('a'), Buffer.from('b')]);

    expect(result.assets).toHaveLength(2);
    expect(result.assets[0]).toEqual({
      id: 'cell-01',
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
