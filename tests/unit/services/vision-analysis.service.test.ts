import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VisionAnalysisService } from '../../../src/services/vision-analysis.service';
import {
  improvementGridPlanOutputSchema,
  improvementPlanOutputSchema,
} from '../../../src/utils/improvement';

const generateStructuredCompletionMock = vi.hoisted(() => vi.fn());

vi.mock('../../../src/ai/completion', () => ({
  generateStructuredCompletion: generateStructuredCompletionMock,
}));

const image = { buffer: Buffer.from('cell'), mimeType: 'image/png' };

describe('VisionAnalysisService', () => {
  const service = new VisionAnalysisService();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('detectGridBoundaries', () => {
    it('throws GridDetectionError (422) when the AI boundaries fail coverage validation', async () => {
      generateStructuredCompletionMock.mockResolvedValueOnce({
        output: { gridLayout: '3x3', boundaries: [{ x: 0, y: 0, width: 10, height: 10 }] },
      });

      await expect(
        service.detectGridBoundaries(Buffer.from('grid').toString('base64'), 512, 512)
      ).rejects.toMatchObject({ code: 'GRID_DETECTION_FAILED', statusCode: 422 });
    });

    it('skips the model entirely when the user specified rows and cols', async () => {
      const result = await service.detectGridBoundaries(
        Buffer.from('grid').toString('base64'),
        512,
        512,
        2,
        2
      );

      expect(result.gridLayout).toBe('2x2');
      expect(result.boundaries).toHaveLength(4);
      expect(generateStructuredCompletionMock).not.toHaveBeenCalled();
    });
  });

  describe('buildImprovementPrompt', () => {
    it('uses the single-mode schema and returns the catalog model from the completion', async () => {
      generateStructuredCompletionMock.mockResolvedValueOnce({
        output: {
          improvementPrompt: 'polish it',
          textAssetDecoration: {
            text: '',
            style: { fontFamily: '', color: '', weight: '' },
          },
        },
        usage: { inputTokens: 10, outputTokens: 5 },
        cost: 0.001,
        latencyMs: 42,
        model: 'meta/muse-spark-1.3-contributor',
      });

      const result = await service.buildImprovementPrompt([image], 'single');

      expect(result.plan.improvementPrompt).toBe('polish it');
      expect(result.metadata.model).toBe('meta/muse-spark-1.3-contributor');
      expect(generateStructuredCompletionMock).toHaveBeenCalledWith(
        expect.objectContaining({ role: 'improvement', outputSchema: improvementPlanOutputSchema })
      );
    });

    it('uses the grid-mode schema (no decoration field) for grid inputs', async () => {
      generateStructuredCompletionMock.mockResolvedValueOnce({
        output: { improvementPrompt: 'grid polish' },
        usage: { inputTokens: 10, outputTokens: 5 },
        cost: 0.001,
        latencyMs: 42,
        model: 'meta/muse-spark-1.3-contributor',
      });

      const result = await service.buildImprovementPrompt([image, image], 'grid');

      expect(result.plan.improvementPrompt).toBe('grid polish');
      expect(generateStructuredCompletionMock).toHaveBeenCalledWith(
        expect.objectContaining({
          role: 'improvement',
          outputSchema: improvementGridPlanOutputSchema,
        })
      );
    });
  });
});
