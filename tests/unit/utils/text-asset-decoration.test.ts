import { describe, it, expect } from 'vitest';
import {
  buildTextAssetDecoration,
  textOutsideForegroundToAsset,
} from '../../../src/utils/text-asset-decoration';

describe('text asset decoration utils', () => {
  it('builds normalized text asset decoration with defaults', () => {
    expect(buildTextAssetDecoration({ text: '  Nice   Text  ' }, 'input')).toEqual({
      text: 'Nice Text',
      style: {
        fontFamily: 'sans-serif',
        color: '#FFFFFF',
        weight: 'regular',
      },
      source: 'input',
    });
  });

  it('returns undefined when text is missing', () => {
    expect(buildTextAssetDecoration({ text: '   ' })).toBeUndefined();
  });

  it('converts textOutsideForeground to shared asset shape', () => {
    expect(textOutsideForegroundToAsset({
      text: 'Caption',
      style: { fontFamily: 'serif', color: '#000000', weight: 'medium' },
    })).toEqual({
      text: 'Caption',
      style: { fontFamily: 'serif', color: '#000000', weight: 'medium' },
      source: 'detected',
    });
  });
});
