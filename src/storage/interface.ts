export interface SaveFileOptions {
  extension?: string;
  subDir?: string;
  baseName?: string;
  ownerId?: string;
}

export interface IStorageProvider {
  saveFile(buffer: Buffer, options: SaveFileOptions): Promise<string>;
  getFilePath(filename: string): string;
  fileExists(filename: string): Promise<boolean>;
  deleteFile(filename: string): Promise<void>;
  getPublicUrl(filename: string): string;
}
