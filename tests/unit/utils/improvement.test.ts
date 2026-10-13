import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  chunkImageInputs,
  improvementGridPlanOutputSchema,
  improvementPlanOutputSchema,
  normalizeImprovementPromptPlan,
} from '../../../src/utils/improvement';

describe('improvement utils', () => {
  it.each([
    { count: 1, chunks: [1] },
    { count: 2, chunks: [2] },
    { count: 14, chunks: [14] },
    { count: 15, chunks: [14, 1] },
    { count: 17, chunks: [14, 3] },
    { count: 28, chunks: [14, 14] },
    { count: 32, chunks: [14, 14, 4] },
  ])('chunks $count image(s) by 14', ({ count, chunks }) => {
    const items = Array.from({ length: count }, (_, index) => index);
    expect(chunkImageInputs(items).map(chunk => chunk.length)).toEqual(chunks);
  });

  it('normalizes single improvement prompt with text asset decoration', () => {
    const result = normalizeImprovementPromptPlan(
      JSON.stringify({
        improvementPrompt: 'Improve the sticker and remove text.',
        textAssetDecoration: {
          text: 'Hello   World',
          style: { fontFamily: 'display', color: '#111111', weight: 'bold' },
        },
      }),
      { allowTextAssetDecoration: true }
    );

    expect(result).toEqual({
      improvementPrompt: 'Improve the sticker and remove text.',
      textAssetDecoration: {
        text: 'Hello World',
        style: { fontFamily: 'display', color: '#111111', weight: 'bold' },
        source: 'detected',
      },
    });
  });

  it('ignores invalid or disallowed text asset decoration', () => {
    const result = normalizeImprovementPromptPlan(
      JSON.stringify({
        improvementPrompt: 'Improve as a 4x4 grid.',
        textAssetDecoration: {
          text: '',
          style: { fontFamily: '', color: '', weight: '' },
        },
      }),
      { allowTextAssetDecoration: false }
    );

    expect(result).toEqual({
      improvementPrompt: 'Improve as a 4x4 grid.',
    });
  });

  it('normalizes an object plan from structured output', () => {
    const result = normalizeImprovementPromptPlan(
      {
        improvementPrompt: 'Polish the sticker.',
        textAssetDecoration: {
          text: 'Hi',
          style: { fontFamily: 'serif', color: '#000000', weight: 'bold' },
        },
      },
      { allowTextAssetDecoration: true }
    );

    expect(result).toEqual({
      improvementPrompt: 'Polish the sticker.',
      textAssetDecoration: {
        text: 'Hi',
        style: { fontFamily: 'serif', color: '#000000', weight: 'bold' },
        source: 'detected',
      },
    });
  });

  it('throws when the structured output has no improvementPrompt', () => {
    expect(() => normalizeImprovementPromptPlan({}, { allowTextAssetDecoration: false })).toThrow(
      'Improvement agent did not return improvementPrompt'
    );
  });

  it('emits strict-provider schemas: every property required, no default keywords', () => {
    for (const schema of [improvementPlanOutputSchema, improvementGridPlanOutputSchema]) {
      const jsonSchema = z.toJSONSchema(schema) as {
        required?: string[];
        properties?: Record<string, unknown>;
      };
      expect((jsonSchema.required ?? []).sort()).toEqual(
        Object.keys(jsonSchema.properties ?? {}).sort()
      );
      expect(JSON.stringify(jsonSchema)).not.toContain('"default"');
    }
  });
});
