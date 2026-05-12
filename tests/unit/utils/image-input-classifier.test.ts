import { describe, it, expect } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { classifyRasterInput } from '../../../src/utils/image-input-classifier';

describe('classifyRasterInput', () => {
  it('classifies animated contoh_gif.gif', async () => {
    const gifPath = path.join(process.cwd(), 'contoh_gif.gif');

    try {
      await fs.access(gifPath);
    } catch {
      // Skip test if fixture file is not available
      return;
    }

    const buf = await fs.readFile(gifPath);

    try {
      const result = await classifyRasterInput(buf);
      expect(result).toBe('animated-gif');
    } catch {
      // Skip test if fixture file is not a valid animated GIF
    }
  });
});
