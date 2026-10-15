import fs from 'fs';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CleanupService } from '../../../src/utils/cleanup';
import {
  resolveStoragePath,
  toStorageRelativePath,
} from '../../../src/utils/storage-path';
import { config } from '../../../src/config';

describe('storage path helpers', () => {
  it('normalizes url, backslash and relative forms', () => {
    expect(toStorageRelativePath('/uploads/users/u1/stickers/a.png')).toBe('users/u1/stickers/a.png');
    expect(toStorageRelativePath('users\\u1\\stickers\\a.png')).toBe('users/u1/stickers/a.png');
    expect(toStorageRelativePath('users/u1/stickers/a.png')).toBe('users/u1/stickers/a.png');
  });

  it('resolves legacy prefixed paths without doubling the upload dir', () => {
    const resolved = resolveStoragePath('/uploads/users/u1/a.png', config.uploadDir);
    expect(resolved).toBe(path.join(process.cwd(), config.uploadDir, 'users/u1/a.png'));
    expect(resolved).not.toContain(`${path.sep}uploads${path.sep}uploads`);
  });
});

describe('CleanupService.deleteFiles', () => {
  const testDir = '__cleanup-test__';
  const uploadRoot = path.join(process.cwd(), config.uploadDir, testDir);

  beforeAll(() => {
    fs.mkdirSync(uploadRoot, { recursive: true });
    fs.writeFileSync(path.join(uploadRoot, 'relative.png'), 'a');
    fs.writeFileSync(path.join(uploadRoot, 'prefixed.png'), 'b');
  });

  afterAll(() => {
    fs.rmSync(uploadRoot, { recursive: true, force: true });
  });

  it('deletes both storage-relative and legacy /uploads-prefixed files', () => {
    const service = new CleanupService();

    const deleted = service.deleteFiles([
      `${testDir}/relative.png`,
      `/uploads/${testDir}/prefixed.png`,
    ]);

    expect(deleted).toBe(2);
    expect(fs.existsSync(path.join(uploadRoot, 'relative.png'))).toBe(false);
    expect(fs.existsSync(path.join(uploadRoot, 'prefixed.png'))).toBe(false);
  });

  it('skips missing files without counting them', () => {
    const service = new CleanupService();
    expect(service.deleteFiles([`${testDir}/missing.png`])).toBe(0);
  });
});
