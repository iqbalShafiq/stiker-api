import type { Request, Response, NextFunction } from 'express';
import { legalContentService } from '../services/legal-content.service';
import { buildSuccessResponse } from '../utils/response-builder';
import { LEGAL_VERSION } from '../content/legal';
import { renderAccountDeletionPageHtml, renderLegalDocumentHtml } from '../utils/legal-html';

export class LegalController {
  getSummary(_req: Request, res: Response, next: NextFunction): void {
    try {
      res.status(200).json(buildSuccessResponse(legalContentService.getSummary()));
    } catch (error) {
      next(error);
    }
  }

  getPrivacy(_req: Request, res: Response, next: NextFunction): void {
    try {
      res.status(200).json(buildSuccessResponse(legalContentService.getPrivacy()));
    } catch (error) {
      next(error);
    }
  }

  getTerms(_req: Request, res: Response, next: NextFunction): void {
    try {
      res.status(200).json(buildSuccessResponse(legalContentService.getTerms()));
    } catch (error) {
      next(error);
    }
  }

  getAccountDeletion(_req: Request, res: Response, next: NextFunction): void {
    try {
      res.status(200).json(buildSuccessResponse(legalContentService.getAccountDeletion()));
    } catch (error) {
      next(error);
    }
  }

  getRetention(_req: Request, res: Response, next: NextFunction): void {
    try {
      res.status(200).json(buildSuccessResponse(legalContentService.getRetention()));
    } catch (error) {
      next(error);
    }
  }

  getPrivacyHtml(_req: Request, res: Response, next: NextFunction): void {
    try {
      const doc = legalContentService.getPrivacy();
      res.type('html').send(renderLegalDocumentHtml(doc, { showNav: true }));
    } catch (error) {
      next(error);
    }
  }

  getTermsHtml(_req: Request, res: Response, next: NextFunction): void {
    try {
      const doc = legalContentService.getTerms();
      res.type('html').send(renderLegalDocumentHtml(doc, { showNav: true }));
    } catch (error) {
      next(error);
    }
  }

  getRetentionHtml(_req: Request, res: Response, next: NextFunction): void {
    try {
      const retention = legalContentService.getRetention();
      res.type('html').send(
        renderLegalDocumentHtml(
          {
            title: 'Data Retention Policy',
            version: LEGAL_VERSION,
            effectiveDate: LEGAL_VERSION,
            summary: retention.description,
            sections: retention.sections,
          },
          { showNav: true },
        ),
      );
    } catch (error) {
      next(error);
    }
  }

  getAccountDeletionHtml(_req: Request, res: Response, next: NextFunction): void {
    try {
      const doc = legalContentService.getAccountDeletion();
      res.type('html').send(renderAccountDeletionPageHtml(doc));
    } catch (error) {
      next(error);
    }
  }
}
