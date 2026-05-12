import fs from 'fs';
import path from 'path';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { apiReference } from '@scalar/express-api-reference';
import { config } from './config';
import { upload } from './middleware/upload-handler';
import { validateRequest } from './middleware/validate-request';
import { errorHandler } from './middleware/error-handler';
import { authenticateToken } from './middleware/auth.middleware';
import { requireRole } from './middleware/role.middleware';
import { generateImageSchema } from './utils/validators';
import { GenerateController } from './controllers/generate.controller';
import { GridController } from './controllers/grid.controller';
import { BackgroundController } from './controllers/background.controller';
import { AuthController } from './controllers/auth.controller';
import { StickerController } from './controllers/sticker.controller';
import { AdminController } from './controllers/admin.controller';
import { asyncHandler } from './utils/async-handler';

const app = express();

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
const adminController = new AdminController();

// Auth routes (public)
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.post('/api/v1/auth/register', asyncHandler((req, res, next) => authController.register(req, res, next)));
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.post('/api/v1/auth/login', asyncHandler((req, res, next) => authController.login(req, res, next)));
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.post('/api/v1/auth/refresh', asyncHandler((req, res, next) => authController.refresh(req, res, next)));

// Auth routes (protected)
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.post('/api/v1/auth/logout', authenticateToken, asyncHandler((req, res, next) => authController.logout(req, res, next)));
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.get('/api/v1/auth/me', authenticateToken, asyncHandler((req, res, next) => authController.getMe(req, res, next)));
app.put('/api/v1/auth/me', authenticateToken, (req, res, next) => {
  authController.updateMe(req, res, next);
});
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.post('/api/v1/auth/change-password', authenticateToken, asyncHandler((req, res, next) => authController.changePassword(req, res, next)));

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
app.delete('/api/v1/stickers/:id/share', authenticateToken, asyncHandler((req, res, next) => stickerController.removeUserShare(req, res, next)));
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.post('/api/v1/stickers/:id/link', authenticateToken, asyncHandler((req, res, next) => stickerController.createShareLink(req, res, next)));
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.delete('/api/v1/stickers/:id/link/:linkId', authenticateToken, asyncHandler((req, res, next) => stickerController.revokeShareLink(req, res, next)));

// Admin routes (protected + admin only)
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
  upload.single('image'),
  validateRequest(generateImageSchema),
  asyncHandler((req, res, next) => generateController.generate(req, res, next))
);
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.post(
  '/api/v1/grid/split',
  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  authenticateToken,
  upload.single('image'),
  asyncHandler((req, res, next) => gridController.split(req, res, next))
);
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.post(
  '/api/v1/background/remove',
  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  authenticateToken,
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

app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use(errorHandler);

export default app;
