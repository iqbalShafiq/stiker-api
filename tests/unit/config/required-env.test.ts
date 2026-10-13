import { describe, expect, it } from 'vitest';
import { requiredEnvFrom, MissingEnvError } from '../../../src/config';

describe('requiredEnv', () => {
  it('returns the value when present', () => {
    expect(requiredEnvFrom({ JWT_SECRET: 'abc' }, 'JWT_SECRET')).toBe('abc');
  });

  it('throws a MissingEnvError naming every missing variable', () => {
    expect(() => requiredEnvFrom({ A: 'x' }, 'A', 'B', 'C')).toThrow(MissingEnvError);
    expect(() => requiredEnvFrom({ A: 'x' }, 'A', 'B', 'C')).toThrow(/B, C/);
  });

  it('treats blank values as missing', () => {
    expect(() => requiredEnvFrom({ A: '   ' }, 'A')).toThrow(MissingEnvError);
  });
});
