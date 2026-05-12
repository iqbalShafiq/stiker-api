import fs from 'fs';
import path from 'path';
import { ProcessingHistoryService } from '../services/processing-history.service';
import { config } from '../config';

export class CleanupService {
  private historyService: ProcessingHistoryService;

  constructor() {
    this.historyService = new ProcessingHistoryService();
  }

  async runCleanup(): Promise<{ deletedRecords: number; deletedFiles: number }> {
    // Get all expired records before deletion to know which files to clean
    const expiredRecords = await this.historyService.findExpired();

    const deletedRecords = await this.historyService.deleteExpired();

    // Extract file paths from expired records
    const filePathsToDelete = new Set<string>();
    for (const record of expiredRecords) {
      const outputFiles = record.outputFiles as Array<{
        url: string;
        path: string;
        filename: string;
        width?: number;
        height?: number;
      }>;

      for (const file of outputFiles) {
        if (file.path) {
          filePathsToDelete.add(file.path);
        }
      }
    }

    // Delete files
    const deletedFiles = this.deleteFiles(Array.from(filePathsToDelete));

    return { deletedRecords, deletedFiles };
  }

  deleteFiles(filePaths: string[]): number {
    let deletedCount = 0;

    for (const filePath of filePaths) {
      try {
        const fullPath = path.join(process.cwd(), config.uploadDir, filePath);
        if (fs.existsSync(fullPath)) {
          fs.unlinkSync(fullPath);
          deletedCount++;
        }
      } catch {
        // Silently skip files that cannot be deleted
      }
    }

    return deletedCount;
  }
}