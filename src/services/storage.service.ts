import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';

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

  async saveFile(buffer: Buffer, extension: string = 'png'): Promise<string> {
    await this.ensureUploadDir();
    const id = uuidv4();
    const filename = `${id}.${extension}`;
    const filepath = path.join(this.uploadDir, filename);
    await fs.writeFile(filepath, buffer);
    return filename;
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
    return `/uploads/${filename}`;
  }
}
