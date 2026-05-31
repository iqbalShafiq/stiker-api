import type { Request, Response, NextFunction } from 'express';
import { config } from '../config';
import { buildSuccessResponse } from '../utils/response-builder';

const legalVersion = '2026-05-31';
const webBase = (): string => config.publicWebBaseUrl.replace(/\/$/, '');

export class LegalController {
  getSummary(_req: Request, res: Response, next: NextFunction): void {
    try {
      const base = webBase();
      res.status(200).json(
        buildSuccessResponse({
          privacyUrl: `${base}/privacy`,
          termsUrl: `${base}/terms`,
          retentionUrl: `${base}/retention`,
          version: legalVersion,
          effectiveDate: legalVersion,
        })
      );
    } catch (error) {
      next(error);
    }
  }

  getPrivacy(_req: Request, res: Response, next: NextFunction): void {
    try {
      res.status(200).json(
        buildSuccessResponse({
          title: 'Privacy Policy',
          version: legalVersion,
          effectiveDate: legalVersion,
          url: `${webBase()}/privacy`,
          summary:
            'Setiker processes images you upload for sticker creation, AI generation, and cloud sync. ' +
            'Account data is stored to provide authentication and pack synchronization.',
        })
      );
    } catch (error) {
      next(error);
    }
  }

  getTerms(_req: Request, res: Response, next: NextFunction): void {
    try {
      res.status(200).json(
        buildSuccessResponse({
          title: 'Terms of Service',
          version: legalVersion,
          effectiveDate: legalVersion,
          url: `${webBase()}/terms`,
          summary:
            'By using Setiker you agree to use AI features responsibly and comply with applicable laws ' +
            'when creating and sharing sticker packs.',
        })
      );
    } catch (error) {
      next(error);
    }
  }

  getRetention(_req: Request, res: Response, next: NextFunction): void {
    try {
      res.status(200).json(
        buildSuccessResponse({
          processingHistoryDays: config.historyExpirationDays,
          deletedAccountGraceDays: 30,
          aiInputHandling:
            'Images sent to AI features are processed to generate stickers and may be retained ' +
            'according to processing history retention.',
          description: `Processing outputs expire after ${config.historyExpirationDays} days.`,
        })
      );
    } catch (error) {
      next(error);
    }
  }
}
