import { describe, it, expect } from 'vitest';
import {
  buildEmptyTextAssetDecoration,
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

  it('builds empty text asset decoration fallback', () => {
    expect(buildEmptyTextAssetDecoration('detected', 'Hello')).toEqual({
      text: 'Hello',
      style: {
        fontFamily: 'sans-serif',
        color: '#FFFFFF',
        weight: 'regular',
      },
      source: 'detected',
    });
  });

  it('keeps default empty fallback text when not passed', () => {
    expect(buildEmptyTextAssetDecoration()).toEqual({
      text: '',
      style: {
        fontFamily: 'sans-serif',
        color: '#FFFFFF',
        weight: 'regular',
      },
      source: 'detected',
    });
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
