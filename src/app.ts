import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { apiReference } from '@scalar/express-api-reference';
import { config } from './config';
import logger from './utils/logger';
import { getHealthStatus } from './utils/health-check';
import { upload } from './middleware/upload-handler';
import { validateRequest } from './middleware/validate-request';
import { errorHandler } from './middleware/error-handler';
import { authenticateToken } from './middleware/auth.middleware';
import { optionalAuthenticateToken } from './middleware/optional-auth.middleware';
import { requireRole } from './middleware/role.middleware';
import { generateImageSchema, generateStickerPackSchema, generateVideoStickerPackSchema } from './utils/validators';
import { GenerateController } from './controllers/generate.controller';
import { GridController } from './controllers/grid.controller';
import { BackgroundController } from './controllers/background.controller';
import { AuthController } from './controllers/auth.controller';
import { StickerController } from './controllers/sticker.controller';
import { StickerPackController } from './controllers/sticker-pack.controller';
import { UploadController } from './controllers/upload.controller';
import { SyncController } from './controllers/sync.controller';
import { AdminController } from './controllers/admin.controller';
import { ProcessingHistoryController } from './controllers/processing-history.controller';
import { ShareController } from './controllers/share.controller';
import { SocialController } from './controllers/social.controller';
import { LegalController } from './controllers/legal.controller';
import { moderationController } from './controllers/moderation.controller';
import { AiUsageController } from './controllers/ai-usage.controller';
import { AiQuotaController } from './controllers/ai-quota.controller';
import { UserProfileController } from './controllers/user-profile.controller';
import { NotificationController } from './controllers/notification.controller';
import { FeaturedController } from './controllers/featured.controller';
import { PromptPresetController } from './controllers/prompt-preset.controller';
import { billingController } from './controllers/billing.controller';
import { requireAiQuota } from './middleware/ai-quota.middleware';
import { asyncHandler } from './utils/async-handler';

interface RequestWithId extends Request {
  id?: string;
}

const app = express();

// Trust proxy in production (for nginx)
if (config.nodeEnv === 'production') {
  app.set('trust proxy', 1);
}

// Request ID tracking middleware
app.use((req: RequestWithId, res: Response, next: NextFunction) => {
  const requestId = randomUUID();
  req.id = requestId;
  res.setHeader('X-Request-Id', requestId);
  next();
});

// Request logging middleware
app.use((req: RequestWithId, res: Response, next: NextFunction) => {
  const start = Date.now();
  const requestId = req.id;

  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info(
      {
        requestId,
        method: req.method,
        url: req.url,
        status: res.statusCode,
        duration: `${duration}ms`,
        userAgent: req.get('user-agent'),
        ip: req.ip,
      },
      `${req.method} ${req.url} ${res.statusCode} ${duration}ms`
    );
  });

  next();
});

/** Inline spec so Scalar does not fetch /openapi.json (avoids mistaken https + ERR_SSL_PROTOCOL_ERROR on LAN HTTP). */
const openApiSpecPath = path.join(process.cwd(), 'docs', 'openapi.json');
const openApiSpec: Record<string, unknown> = JSON.parse(
  fs.readFileSync(openApiSpecPath, 'utf-8')
) as Record<string, unknown>;

app.use(
  helmet({
    // HTTP on a LAN IP is not a "trustworthy" document; COOP adds noise and is ignored by the browser.
    crossOriginOpenerPolicy: false,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdn.jsdelivr.net", "data:"],
        imgSrc: ["'self'", "data:", "https://cdn.jsdelivr.net"],
        connectSrc: ["'self'", "https://cdn.jsdelivr.net"],
      },
    },
  })
);
app.use(cors({ origin: config.corsOrigin, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use('/uploads', express.static(config.uploadDir));

const generateController = new GenerateController();
const gridController = new GridController();
const backgroundController = new BackgroundController();
const authController = new AuthController();
const stickerController = new StickerController();
const stickerPackController = new StickerPackController();
const uploadController = new UploadController();
const syncController = new SyncController();
const adminController = new AdminController();
const processingHistoryController = new ProcessingHistoryController();
const shareController = new ShareController();
const socialController = new SocialController();
const legalController = new LegalController();
const aiUsageController = new AiUsageController();
const aiQuotaController = new AiQuotaController();
const userProfileController = new UserProfileController();
const notificationController = new NotificationController();
const featuredController = new FeaturedController();
const promptPresetController = new PromptPresetController();

// Legal routes (public)
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.get('/privacy', (req, res, next) => legalController.getPrivacyHtml(req, res, next));
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.get('/terms', (req, res, next) => legalController.getTermsHtml(req, res, next));
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.get('/retention', (req, res, next) => legalController.getRetentionHtml(req, res, next));
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.get('/account-deletion', (req, res, next) => legalController.getAccountDeletionHtml(req, res, next));
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.get('/api/v1/legal', (req, res, next) => legalController.getSummary(req, res, next));
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.get('/api/v1/legal/privacy', (req, res, next) => legalController.getPrivacy(req, res, next));
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.get('/api/v1/legal/terms', (req, res, next) => legalController.getTerms(req, res, next));
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.get('/api/v1/legal/account-deletion', (req, res, next) => legalController.getAccountDeletion(req, res, next));
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.get('/api/v1/legal/retention', (req, res, next) => legalController.getRetention(req, res, next));
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.post('/api/v1/legal/account-deletion/request', asyncHandler((req, res, next) => moderationController.submitAccountDeletionRequest(req, res, next)));

// Moderation & safety routes
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.post('/api/v1/sticker-packs/:id/report', authenticateToken, asyncHandler((req, res, next) => moderationController.reportPack(req, res, next)));
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.post('/api/v1/processing-history/:id/report', authenticateToken, asyncHandler((req, res, next) => moderationController.reportProcessingHistory(req, res, next)));
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.post('/api/v1/users/:id/block', authenticateToken, asyncHandler((req, res, next) => moderationController.blockUser(req, res, next)));
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.delete('/api/v1/users/:id/block', authenticateToken, asyncHandler((req, res, next) => moderationController.unblockUser(req, res, next)));
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.get('/api/v1/users/blocked', authenticateToken, asyncHandler((req, res, next) => moderationController.listBlockedUsers(req, res, next)));
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.get('/api/v1/admin/content-reports', authenticateToken, requireRole('admin'), asyncHandler((req, res, next) => moderationController.listContentReports(req, res, next)));
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.patch('/api/v1/admin/content-reports/:id', authenticateToken, requireRole('admin'), asyncHandler((req, res, next) => moderationController.reviewContentReport(req, res, next)));
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.get('/api/v1/admin/account-deletion-requests', authenticateToken, requireRole('admin'), asyncHandler((req, res, next) => moderationController.listAccountDeletionRequests(req, res, next)));
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.patch('/api/v1/admin/account-deletion-requests/:id', authenticateToken, requireRole('admin'), asyncHandler((req, res, next) => moderationController.processAccountDeletionRequest(req, res, next)));

// Auth routes (public)
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.post('/api/v1/auth/register', asyncHandler((req, res, next) => authController.register(req, res, next)));
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.post('/api/v1/auth/login', asyncHandler((req, res, next) => authController.login(req, res, next)));
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.post('/api/v1/auth/google', asyncHandler((req, res, next) => authController.loginWithGoogle(req, res, next)));
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.post('/api/v1/auth/google/link-with-password', asyncHandler((req, res, next) => authController.linkGoogleWithPassword(req, res, next)));
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.post('/api/v1/auth/refresh', asyncHandler((req, res, next) => authController.refresh(req, res, next)));

// Auth routes (protected)
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.post('/api/v1/auth/logout', authenticateToken, asyncHandler((req, res, next) => authController.logout(req, res, next)));
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.get('/api/v1/auth/me', authenticateToken, asyncHandler((req, res, next) => authController.getMe(req, res, next)));
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.put('/api/v1/auth/me', authenticateToken, asyncHandler((req, res, next) => authController.updateMe(req, res, next)));
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.post('/api/v1/auth/change-password', authenticateToken, asyncHandler((req, res, next) => authController.changePassword(req, res, next)));
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.post('/api/v1/auth/set-password', authenticateToken, asyncHandler((req, res, next) => authController.setPassword(req, res, next)));
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.post('/api/v1/auth/google/link', authenticateToken, asyncHandler((req, res, next) => authController.linkGoogle(req, res, next)));
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.delete('/api/v1/auth/google', authenticateToken, asyncHandler((req, res, next) => authController.unlinkGoogle(req, res, next)));
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.delete('/api/v1/auth/me', authenticateToken, asyncHandler((req, res, next) => authController.deleteMe(req, res, next)));

// AI usage & quota (protected)
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.get('/api/v1/ai/usage', authenticateToken, asyncHandler((req, res, next) => aiUsageController.getUsage(req, res, next)));
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.post('/api/v1/ai/quota/reserve', authenticateToken, asyncHandler((req, res, next) => aiQuotaController.reserve(req, res, next)));
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.post('/api/v1/ai/quota/finalize', authenticateToken, asyncHandler((req, res, next) => aiQuotaController.finalize(req, res, next)));

// Billing (store-compliant IAP)
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.get('/api/v1/billing/products', optionalAuthenticateToken, asyncHandler((req, res, next) => billingController.listProducts(req, res, next)));
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.post('/api/v1/billing/google-play/verify', authenticateToken, asyncHandler((req, res, next) => billingController.verifyGooglePlay(req, res, next)));
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.post('/api/v1/billing/apple/verify', authenticateToken, asyncHandler((req, res, next) => billingController.verifyApple(req, res, next)));
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.get('/api/v1/billing/purchases', authenticateToken, asyncHandler((req, res, next) => billingController.listPurchases(req, res, next)));
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.get('/api/v1/billing/subscription/me', authenticateToken, asyncHandler((req, res, next) => billingController.getSubscription(req, res, next)));
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.post('/api/v1/billing/restore', authenticateToken, asyncHandler((req, res, next) => billingController.restore(req, res, next)));
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.post('/api/v1/billing/google-play/rtdn', asyncHandler((req, res, next) => billingController.googlePlayRtdn(req, res, next)));
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.post('/api/v1/billing/apple/notifications', asyncHandler((req, res, next) => billingController.appleNotifications(req, res, next)));
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.post('/api/v1/billing/xendit/checkout', authenticateToken, asyncHandler((req, res, next) => billingController.xenditCheckout(req, res, next)));
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.post('/api/v1/billing/xendit/webhook', asyncHandler((req, res, next) => billingController.xenditWebhook(req, res, next)));

// Sticker routes (public)
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.get('/api/v1/stickers/public', asyncHandler((req, res, next) => stickerController.getPublicStickers(req, res, next)));

// Sticker routes (protected)
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.get('/api/v1/stickers', authenticateToken, asyncHandler((req, res, next) => stickerController.getMyStickers(req, res, next)));
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.get('/api/v1/stickers/:id', authenticateToken, asyncHandler((req, res, next) => stickerController.getSticker(req, res, next)));
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.put('/api/v1/stickers/:id', authenticateToken, asyncHandler((req, res, next) => stickerController.updateSticker(req, res, next)));
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.delete('/api/v1/stickers/:id', authenticateToken, asyncHandler((req, res, next) => stickerController.deleteSticker(req, res, next)));
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.post('/api/v1/stickers/:id/share', authenticateToken, asyncHandler((req, res, next) => stickerController.shareWithUser(req, res, next)));
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.get('/api/v1/stickers/:id/collaborators', authenticateToken, asyncHandler((req, res, next) => stickerController.listCollaborators(req, res, next)));
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.delete('/api/v1/stickers/:id/share', authenticateToken, asyncHandler((req, res, next) => stickerController.removeUserShare(req, res, next)));
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.post('/api/v1/stickers/:id/link', authenticateToken, asyncHandler((req, res, next) => stickerController.createShareLink(req, res, next)));
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.get('/api/v1/stickers/:id/links', authenticateToken, asyncHandler((req, res, next) => stickerController.listShareLinks(req, res, next)));
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.delete('/api/v1/stickers/:id/link/:linkId', authenticateToken, asyncHandler((req, res, next) => stickerController.revokeShareLink(req, res, next)));

// Featured (public)
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.get('/api/v1/featured/today', optionalAuthenticateToken, asyncHandler((req, res, next) => featuredController.getToday(req, res, next)));

// Prompt presets (public read; admin CRUD)
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.get('/api/v1/prompt-presets', asyncHandler((req, res, next) => promptPresetController.list(req, res, next)));
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.get('/api/v1/admin/prompt-presets', authenticateToken, requireRole('admin'), asyncHandler((req, res, next) => promptPresetController.listAll(req, res, next)));
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.post('/api/v1/admin/prompt-presets', authenticateToken, requireRole('admin'), asyncHandler((req, res, next) => promptPresetController.create(req, res, next)));
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.put('/api/v1/admin/prompt-presets/:slug', authenticateToken, requireRole('admin'), asyncHandler((req, res, next) => promptPresetController.update(req, res, next)));
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.delete('/api/v1/admin/prompt-presets/:slug', authenticateToken, requireRole('admin'), asyncHandler((req, res, next) => promptPresetController.remove(req, res, next)));

// User profile (public + search)
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.get('/api/v1/users/search', authenticateToken, asyncHandler((req, res, next) => userProfileController.searchUsers(req, res, next)));
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.get('/api/v1/users/:id/public', optionalAuthenticateToken, asyncHandler((req, res, next) => userProfileController.getPublicProfile(req, res, next)));
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.get('/api/v1/users/:id/packs/public', optionalAuthenticateToken, asyncHandler((req, res, next) => userProfileController.getPublicPacks(req, res, next)));

// Notifications (protected)
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.get('/api/v1/notifications', authenticateToken, asyncHandler((req, res, next) => notificationController.list(req, res, next)));
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.patch('/api/v1/notifications/:id/read', authenticateToken, asyncHandler((req, res, next) => notificationController.markRead(req, res, next)));
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.post('/api/v1/notifications/read-all', authenticateToken, asyncHandler((req, res, next) => notificationController.markAllRead(req, res, next)));

// Sticker Pack routes (public)
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.get('/api/v1/sticker-packs/public', optionalAuthenticateToken, asyncHandler((req, res, next) => stickerPackController.getPublicStickerPacks(req, res, next)));
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.get('/api/v1/sticker-packs/public/:id', optionalAuthenticateToken, asyncHandler((req, res, next) => stickerPackController.getPublicStickerPack(req, res, next)));

// Sticker Pack routes (protected)
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.get('/api/v1/sticker-packs/saved', authenticateToken, asyncHandler((req, res, next) => stickerPackController.getSavedStickerPacks(req, res, next)));
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.get('/api/v1/sticker-packs/following', authenticateToken, asyncHandler((req, res, next) => stickerPackController.getFollowingStickerPacks(req, res, next)));
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.get('/api/v1/sticker-packs/shared-with-me', authenticateToken, asyncHandler((req, res, next) => stickerPackController.getSharedWithMeStickerPacks(req, res, next)));
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.get('/api/v1/sticker-packs', authenticateToken, asyncHandler((req, res, next) => stickerPackController.getMyStickerPacks(req, res, next)));
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.post('/api/v1/sticker-packs', authenticateToken, asyncHandler((req, res, next) => stickerPackController.create(req, res, next)));
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.get('/api/v1/sticker-packs/:id', authenticateToken, asyncHandler((req, res, next) => stickerPackController.getStickerPack(req, res, next)));
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.put('/api/v1/sticker-packs/:id', authenticateToken, asyncHandler((req, res, next) => stickerPackController.updateStickerPack(req, res, next)));
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.delete('/api/v1/sticker-packs/:id', authenticateToken, asyncHandler((req, res, next) => stickerPackController.deleteStickerPack(req, res, next)));
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.post('/api/v1/sticker-packs/:id/import', authenticateToken, asyncHandler((req, res, next) => stickerPackController.importPublicPack(req, res, next)));
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.post('/api/v1/sticker-packs/:id/like', authenticateToken, asyncHandler((req, res, next) => socialController.likePack(req, res, next)));
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.delete('/api/v1/sticker-packs/:id/like', authenticateToken, asyncHandler((req, res, next) => socialController.unlikePack(req, res, next)));
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.post('/api/v1/sticker-packs/:id/save', authenticateToken, asyncHandler((req, res, next) => socialController.savePack(req, res, next)));
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.delete('/api/v1/sticker-packs/:id/save', authenticateToken, asyncHandler((req, res, next) => socialController.unsavePack(req, res, next)));
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.post('/api/v1/sticker-packs/:id/download', authenticateToken, asyncHandler((req, res, next) => socialController.downloadPack(req, res, next)));
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.post('/api/v1/sticker-packs/:id/stickers', authenticateToken, asyncHandler((req, res, next) => stickerPackController.addSticker(req, res, next)));
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.delete('/api/v1/sticker-packs/:id/stickers/:stickerId', authenticateToken, asyncHandler((req, res, next) => stickerPackController.removeSticker(req, res, next)));
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.put('/api/v1/sticker-packs/:id/reorder', authenticateToken, asyncHandler((req, res, next) => stickerPackController.reorderStickers(req, res, next)));
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.post('/api/v1/sticker-packs/:id/share', authenticateToken, asyncHandler((req, res, next) => stickerPackController.shareWithUser(req, res, next)));
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.delete('/api/v1/sticker-packs/:id/share', authenticateToken, asyncHandler((req, res, next) => stickerPackController.removeUserShare(req, res, next)));
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.post('/api/v1/sticker-packs/:id/link', authenticateToken, asyncHandler((req, res, next) => stickerPackController.createShareLink(req, res, next)));
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.get('/api/v1/sticker-packs/:id/collaborators', authenticateToken, asyncHandler((req, res, next) => stickerPackController.listCollaborators(req, res, next)));
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.get('/api/v1/sticker-packs/:id/links', authenticateToken, asyncHandler((req, res, next) => stickerPackController.listShareLinks(req, res, next)));
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.delete('/api/v1/sticker-packs/:id/link/:linkId', authenticateToken, asyncHandler((req, res, next) => stickerPackController.revokeShareLink(req, res, next)));

// Share routes (public preview + protected accept)
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.get('/api/v1/share/pack/:token', asyncHandler((req, res, next) => shareController.previewPack(req, res, next)));
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.post('/api/v1/share/pack/:token/accept', authenticateToken, asyncHandler((req, res, next) => shareController.acceptPack(req, res, next)));
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.get('/api/v1/share/sticker/:token', asyncHandler((req, res, next) => shareController.previewSticker(req, res, next)));
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.post('/api/v1/share/sticker/:token/accept', authenticateToken, asyncHandler((req, res, next) => shareController.acceptSticker(req, res, next)));

// Processing history routes (protected)
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.get('/api/v1/processing-history', authenticateToken, asyncHandler((req, res, next) => processingHistoryController.list(req, res, next)));
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.delete('/api/v1/processing-history', authenticateToken, asyncHandler((req, res, next) => processingHistoryController.clear(req, res, next)));
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.delete('/api/v1/processing-history/:id', authenticateToken, asyncHandler((req, res, next) => processingHistoryController.deleteOne(req, res, next)));

// Upload routes (protected)
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.post(
  '/api/v1/upload',
  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  authenticateToken,
  upload.array('images', 30),
  asyncHandler((req, res, next) => uploadController.upload(req, res, next))
);

// Sync routes (protected)
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.get('/api/v1/sync', authenticateToken, asyncHandler((req, res, next) => syncController.sync(req, res, next)));

// Admin routes (protected + admin only)
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.post('/api/v1/users/:id/follow', authenticateToken, asyncHandler((req, res, next) => socialController.followUser(req, res, next)));
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.delete('/api/v1/users/:id/follow', authenticateToken, asyncHandler((req, res, next) => socialController.unfollowUser(req, res, next)));
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.get('/api/v1/users', authenticateToken, requireRole('admin'), asyncHandler((req, res, next) => adminController.getUsers(req, res, next)));
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.get('/api/v1/users/:id', authenticateToken, requireRole('admin'), asyncHandler((req, res, next) => adminController.getUser(req, res, next)));
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.put('/api/v1/users/:id', authenticateToken, requireRole('admin'), asyncHandler((req, res, next) => adminController.updateUser(req, res, next)));
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.delete('/api/v1/users/:id', authenticateToken, requireRole('admin'), asyncHandler((req, res, next) => adminController.deleteUser(req, res, next)));
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.put('/api/v1/users/:id/role', authenticateToken, requireRole('admin'), asyncHandler((req, res, next) => adminController.changeUserRole(req, res, next)));

// Protected existing routes
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.post(
  '/api/v1/generate',
  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  authenticateToken,
  requireAiQuota('generate'),
  upload.single('image'),
  validateRequest(generateImageSchema),
  asyncHandler((req, res, next) => generateController.generate(req, res, next))
);
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.post(
  '/api/v1/generate/sticker-pack',
  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  authenticateToken,
  requireAiQuota('generate'),
  upload.single('image'),
  validateRequest(generateStickerPackSchema),
  asyncHandler((req, res, next) => generateController.generateStickerPack(req, res, next))
);
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.post(
  '/api/v1/generate/video-sticker-pack',
  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  authenticateToken,
  requireAiQuota('videoStickerPack'),
  upload.array('candidate_grids', 2),
  validateRequest(generateVideoStickerPackSchema),
  asyncHandler((req, res, next) => generateController.generateVideoStickerPack(req, res, next))
);
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.post(
  '/api/v1/generate/improvement',
  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  authenticateToken,
  requireAiQuota('improve'),
  upload.array('images', 64),
  asyncHandler((req, res, next) => generateController.improve(req, res, next))
);
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.post(
  '/api/v1/grid/split',
  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  authenticateToken,
  requireAiQuota('gridSplit'),
  upload.single('image'),
  asyncHandler((req, res, next) => gridController.split(req, res, next))
);
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.post(
  '/api/v1/grid/split/text-assets',
  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  authenticateToken,
  requireAiQuota('gridSplit'),
  upload.array('images', 64),
  asyncHandler((req, res, next) => gridController.extractTextAssets(req, res, next))
);
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.post(
  '/api/v1/background/remove',
  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  authenticateToken,
  requireAiQuota('backgroundRemove'),
  upload.single('image'),
  asyncHandler((req, res, next) => backgroundController.remove(req, res, next))
);

app.get(
  '/docs',
  apiReference({
    spec: {
      content: openApiSpec,
    },
  })
);

app.get('/openapi.json', (_req, res) => {
  res.sendFile('openapi.json', { root: './docs' });
});

app.get('/health', asyncHandler(async (_req, res) => {
  const health = await getHealthStatus();
  const statusCode = health.status === 'healthy' ? 200 : 503;
  res.status(statusCode).json(health);
}));

app.use(errorHandler);

export default app;
