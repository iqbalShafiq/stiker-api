import type { Response, NextFunction, Request } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware';
import { ValidationError } from '../errors';
import { buildSuccessResponse } from '../utils/response-builder';
import { billingCatalogService } from '../services/billing/billing-catalog.service';
import { billingVerifyService } from '../services/billing/billing-verify.service';
import { billingRestoreService } from '../services/billing/billing-restore.service';
import { purchaseService } from '../services/billing/purchase.service';
import { googlePlayRtdnHandler } from '../services/billing/providers/google-play.rtdn.handler';
import { appleNotificationHandler } from '../services/billing/providers/apple.notification.handler';
import { xenditBillingService } from '../services/billing/providers/xendit.billing.service';
import { config } from '../config';
import type { AppleVerifyRequest, GooglePlayVerifyRequest, RestorePurchasesRequest } from '../types/billing';

export class BillingController {
  async listProducts(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const products = await billingCatalogService.listActiveProducts();
      res.status(200).json(buildSuccessResponse({ products }));
    } catch (error) {
      next(error);
    }
  }

  async verifyGooglePlay(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user?.id) throw new ValidationError('User not authenticated');
      const body = req.body as GooglePlayVerifyRequest;
      const result = await billingVerifyService.verifyGooglePlayPurchase(req.user.id, body);
      res.status(200).json(buildSuccessResponse(result));
    } catch (error) {
      next(error);
    }
  }

  async verifyApple(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user?.id) throw new ValidationError('User not authenticated');
      const body = req.body as AppleVerifyRequest;
      const result = await billingVerifyService.verifyApplePurchase(req.user.id, body);
      res.status(200).json(buildSuccessResponse(result));
    } catch (error) {
      next(error);
    }
  }

  async listPurchases(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user?.id) throw new ValidationError('User not authenticated');
      const limit = Math.min(50, parseInt(String(req.query.limit ?? '20'), 10) || 20);
      const offset = Math.max(0, parseInt(String(req.query.offset ?? '0'), 10) || 0);
      const rows = await purchaseService.listForUser(req.user.id, limit + 1, offset);
      const hasMore = rows.length > limit;
      const purchases = hasMore ? rows.slice(0, limit) : rows;
      res.status(200).json(
        buildSuccessResponse({
          purchases,
          limit,
          offset,
          hasMore,
        })
      );
    } catch (error) {
      next(error);
    }
  }

  async getSubscription(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user?.id) throw new ValidationError('User not authenticated');
      const subscription = await billingRestoreService.getSubscriptionSnapshot(req.user.id);
      res.status(200).json(buildSuccessResponse(subscription));
    } catch (error) {
      next(error);
    }
  }

  async restore(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user?.id) throw new ValidationError('User not authenticated');
      const body = req.body as RestorePurchasesRequest;
      const result = await billingVerifyService.restorePurchases(req.user.id, body);
      res.status(200).json(buildSuccessResponse(result));
    } catch (error) {
      next(error);
    }
  }

  async googlePlayRtdn(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const token = req.query.token ?? req.headers['x-goog-channel-token'];
      const expected = config.billing.googlePlay.rtdnVerificationToken;
      if (expected && token !== expected) {
        res.status(401).json({ success: false });
        return;
      }
      await googlePlayRtdnHandler.handlePubSubBody(req.body as Parameters<typeof googlePlayRtdnHandler.handlePubSubBody>[0]);
      res.status(200).send('OK');
    } catch (error) {
      next(error);
    }
  }

  async appleNotifications(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      await appleNotificationHandler.handleNotification(
        req.body as Parameters<typeof appleNotificationHandler.handleNotification>[0]
      );
      res.status(200).send('OK');
    } catch (error) {
      next(error);
    }
  }

  async xenditCheckout(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user?.id) throw new ValidationError('User not authenticated');
      const productCode = (req.body as { productCode?: string }).productCode;
      if (!productCode) throw new ValidationError('productCode is required');
      const result = await xenditBillingService.createCheckout(req.user.id, productCode);
      res.status(200).json(buildSuccessResponse(result));
    } catch (error) {
      next(error);
    }
  }

  async xenditWebhook(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const callbackToken = req.headers['x-callback-token'];
      if (
        config.billing.xendit.webhookToken &&
        callbackToken !== config.billing.xendit.webhookToken
      ) {
        res.status(401).json({ success: false });
        return;
      }
      const eventId = String((req.body as { id?: string }).id ?? Date.now());
      await xenditBillingService.handleWebhook(eventId, req.body as Record<string, unknown>);
      res.status(200).json({ success: true });
    } catch (error) {
      next(error);
    }
  }
}

export const billingController = new BillingController();
