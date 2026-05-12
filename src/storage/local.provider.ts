import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';
import { IStorageProvider, SaveFileOptions } from './interface';

export class LocalStorageProvider implements IStorageProvider {
  private uploadDir: string;

  constructor(uploadDir: string = config.uploadDir) {
    this.uploadDir = uploadDir;
  }

  private getFilePathInternal(filename: string): string {
    return path.join(this.uploadDir, filename);
  }

  private async ensureDir(dir: string): Promise<void> {
    await fs.mkdir(dir, { recursive: true });
  }

  private sanitizeBaseName(baseName: string): string {
    return baseName.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-');
  }

  async saveFile(buffer: Buffer, options: SaveFileOptions = {}): Promise<string> {
    const extension = options.extension ?? 'png';
    const subDir = options.subDir?.trim() ?? '';
    const ownerId = options.ownerId?.trim() ?? '';
    const baseName = options.baseName?.trim();

    let targetDir = this.uploadDir;
    let relativeDir = '';

    if (ownerId) {
      relativeDir = path.posix.join('users', ownerId, 'stickers');
      targetDir = path.join(this.uploadDir, relativeDir);
    } else if (subDir) {
      relativeDir = subDir;
      targetDir = path.join(this.uploadDir, subDir);
    }

    await this.ensureDir(targetDir);

    const safeBaseName = baseName ? this.sanitizeBaseName(baseName) : uuidv4();
    const filename = `${safeBaseName}.${extension}`;
    const relativePath = relativeDir ? path.posix.join(relativeDir, filename) : filename;
    const filepath = path.join(targetDir, filename);

    await fs.writeFile(filepath, buffer);

    return relativePath;
  }

  getFilePath(filename: string): string {
    return this.getFilePathInternal(filename);
  }

  async fileExists(filename: string): Promise<boolean> {
    try {
      await fs.access(this.getFilePathInternal(filename));
      return true;
    } catch {
      return false;
    }
  }

  async deleteFile(filename: string): Promise<void> {
    try {
      await fs.unlink(this.getFilePathInternal(filename));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }

  getPublicUrl(filename: string): string {
    const normalized = filename.split('\\').join('/');
    return `/uploads/${normalized}`;
  }
}
