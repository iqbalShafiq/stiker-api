import { describe, it, expect } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { classifyRasterInput } from '../../../src/utils/image-input-classifier';

describe('classifyRasterInput', () => {
  it('classifies animated contoh_gif.gif', async () => {
    const gifPath = path.join(process.cwd(), 'contoh_gif.gif');
    const buf = await fs.readFile(gifPath);
    await expect(classifyRasterInput(buf)).resolves.toBe('animated-gif');
  });
});
