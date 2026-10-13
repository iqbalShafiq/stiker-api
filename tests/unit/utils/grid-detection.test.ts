import { describe, expect, it } from 'vitest';
import { gridDetectionOutputSchema } from '../../../src/utils/grid-detection';

describe('gridDetectionOutputSchema', () => {
  it('accepts a rows x cols layout with positive boundaries', () => {
    const result = gridDetectionOutputSchema.safeParse({
      gridLayout: '2x2',
      boundaries: [
        { x: 0, y: 0, width: 100, height: 100 },
        { x: 100, y: 0, width: 100, height: 100 },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a layout without the RxC form', () => {
    expect(
      gridDetectionOutputSchema.safeParse({
        gridLayout: 'grid',
        boundaries: [{ x: 0, y: 0, width: 1, height: 1 }],
      }).success
    ).toBe(false);
  });

  it('rejects empty boundaries and non-positive sizes', () => {
    expect(gridDetectionOutputSchema.safeParse({ gridLayout: '2x2', boundaries: [] }).success).toBe(
      false
    );
    expect(
      gridDetectionOutputSchema.safeParse({
        gridLayout: '2x2',
        boundaries: [{ x: 0, y: 0, width: 0, height: 10 }],
      }).success
    ).toBe(false);
  });
});
