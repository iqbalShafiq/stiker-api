import { describe, it, expect } from 'vitest';
import {
  chunkImageInputs,
  normalizeImprovementPromptPlan,
} from '../../../src/utils/improvement';

describe('improvement utils', () => {
  it.each([
    { count: 1, chunks: [1] },
    { count: 2, chunks: [2] },
    { count: 16, chunks: [16] },
    { count: 17, chunks: [16, 1] },
    { count: 32, chunks: [16, 16] },
  ])('chunks $count image(s) by 16', ({ count, chunks }) => {
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
});
