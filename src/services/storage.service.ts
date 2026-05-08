import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';

interface SaveFileOptions {
  extension?: string;
  subDir?: string;
  baseName?: string;
}

export class StorageService {
  private uploadDir: string;

  constructor(uploadDir: string = config.uploadDir) {
    this.uploadDir = uploadDir;
  }

  async ensureUploadDir(): Promise<void> {
    try {
      await fs.access(this.uploadDir);
    } catch {
      await fs.mkdir(this.uploadDir, { recursive: true });
    }
  }

  async saveFile(
    buffer: Buffer,
    extensionOrOptions: string | SaveFileOptions = 'png'
  ): Promise<string> {
    const options: SaveFileOptions =
      typeof extensionOrOptions === 'string'
        ? { extension: extensionOrOptions }
        : extensionOrOptions;
    const extension = options.extension ?? 'png';
    const subDir = options.subDir ? options.subDir.trim() : '';
    const baseName = options.baseName?.trim();

    await this.ensureUploadDir();

    const targetDir = subDir ? path.join(this.uploadDir, subDir) : this.uploadDir;
    await fs.mkdir(targetDir, { recursive: true });

    const safeBaseName = baseName
      ? baseName.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-')
      : uuidv4();
    const filename = `${safeBaseName}.${extension}`;
    const filepath = path.join(targetDir, filename);
    await fs.writeFile(filepath, buffer);

    const relativePath = subDir ? path.join(subDir, filename) : filename;
    return relativePath.split(path.sep).join('/');
  }

  getFilePath(filename: string): string {
    return path.join(this.uploadDir, filename);
  }

  async fileExists(filename: string): Promise<boolean> {
    try {
      await fs.access(path.join(this.uploadDir, filename));
      return true;
    } catch {
      return false;
    }
  }

  async deleteFile(filename: string): Promise<void> {
    try {
      await fs.unlink(path.join(this.uploadDir, filename));
    } catch {
      // Ignore deletion errors
    }
  }

  getPublicUrl(filename: string): string {
    const normalized = filename.split('\\').join('/');
    return `/uploads/${normalized}`;
  }
}
