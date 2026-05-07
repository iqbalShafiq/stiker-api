import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { StorageService } from '../../../src/services/storage.service';

describe('StorageService', () => {
  const testUploadDir = 'test-uploads';
  let service: StorageService;

  beforeEach(() => {
    service = new StorageService(testUploadDir);
  });

  afterEach(async () => {
    try {
      await fs.rm(testUploadDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('saveFile', () => {
    it('should save a file and return filename', async () => {
      const buffer = Buffer.from('test content');
      const filename = await service.saveFile(buffer, 'txt');

      expect(filename).toBeDefined();
      expect(filename.endsWith('.txt')).toBe(true);

      const savedPath = await service.getFilePath(filename);
      const savedContent = await fs.readFile(savedPath);
      expect(savedContent.toString()).toBe('test content');
    });
  });

  describe('fileExists', () => {
    it('should return true for existing file', async () => {
      const buffer = Buffer.from('test content');
      const filename = await service.saveFile(buffer, 'txt');

      const exists = await service.fileExists(filename);
      expect(exists).toBe(true);
    });

    it('should return false for non-existing file', async () => {
      const exists = await service.fileExists('non-existing-file.txt');
      expect(exists).toBe(false);
    });
  });

  describe('deleteFile', () => {
    it('should delete existing file', async () => {
      const buffer = Buffer.from('test content');
      const filename = await service.saveFile(buffer, 'txt');

      await service.deleteFile(filename);

      const exists = await service.fileExists(filename);
      expect(exists).toBe(false);
    });
  });

  describe('getPublicUrl', () => {
    it('should return correct public URL', () => {
      const url = service.getPublicUrl('test-file.png');
      expect(url).toBe('/uploads/test-file.png');
    });
  });
});
