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
app.post('/api/v1/auth/register', (req, res, next) => {
  authController.register(req, res, next).catch(next);
});

app.post('/api/v1/auth/login', (req, res, next) => {
  authController.login(req, res, next).catch(next);
});

app.post('/api/v1/auth/refresh', (req, res, next) => {
  authController.refresh(req, res, next).catch(next);
});

// Auth routes (protected)
app.post('/api/v1/auth/logout', authenticateToken, (req, res, next) => {
  authController.logout(req, res, next).catch(next);
});

app.get('/api/v1/auth/me', authenticateToken, (req, res, next) => {
  authController.getMe(req, res, next).catch(next);
});

app.put('/api/v1/auth/me', authenticateToken, (req, res, next) => {
  authController.updateMe(req, res, next).catch(next);
});

app.post('/api/v1/auth/change-password', authenticateToken, (req, res, next) => {
  authController.changePassword(req, res, next).catch(next);
});

// Sticker routes (public)
app.get('/api/v1/stickers/public', (req, res, next) => {
  stickerController.getPublicStickers(req, res, next).catch(next);
});

// Sticker routes (protected)
app.get('/api/v1/stickers', authenticateToken, (req, res, next) => {
  stickerController.getMyStickers(req, res, next).catch(next);
});

app.get('/api/v1/stickers/:id', authenticateToken, (req, res, next) => {
  stickerController.getSticker(req, res, next).catch(next);
});

app.put('/api/v1/stickers/:id', authenticateToken, (req, res, next) => {
  stickerController.updateSticker(req, res, next).catch(next);
});

app.delete('/api/v1/stickers/:id', authenticateToken, (req, res, next) => {
  stickerController.deleteSticker(req, res, next).catch(next);
});

app.post('/api/v1/stickers/:id/share', authenticateToken, (req, res, next) => {
  stickerController.shareWithUser(req, res, next).catch(next);
});

app.delete('/api/v1/stickers/:id/share', authenticateToken, (req, res, next) => {
  stickerController.removeUserShare(req, res, next).catch(next);
});

app.post('/api/v1/stickers/:id/link', authenticateToken, (req, res, next) => {
  stickerController.createShareLink(req, res, next).catch(next);
});

app.delete('/api/v1/stickers/:id/link', authenticateToken, (req, res, next) => {
  stickerController.revokeShareLink(req, res, next).catch(next);
});

// Admin routes (protected + admin only)
app.get('/api/v1/users', authenticateToken, requireRole('admin'), (req, res, next) => {
  adminController.getUsers(req, res, next).catch(next);
});

app.get('/api/v1/users/:id', authenticateToken, requireRole('admin'), (req, res, next) => {
  adminController.getUser(req, res, next).catch(next);
});

app.put('/api/v1/users/:id', authenticateToken, requireRole('admin'), (req, res, next) => {
  adminController.updateUser(req, res, next).catch(next);
});

app.delete('/api/v1/users/:id', authenticateToken, requireRole('admin'), (req, res, next) => {
  adminController.deleteUser(req, res, next).catch(next);
});

app.put('/api/v1/users/:id/role', authenticateToken, requireRole('admin'), (req, res, next) => {
  adminController.changeUserRole(req, res, next).catch(next);
});

// Protected existing routes
app.post(
  '/api/v1/generate',
  authenticateToken,
  upload.single('image'),
  validateRequest(generateImageSchema),
  (req, res, next) => {
    generateController.generate(req, res, next).catch(next);
  }
);

app.post(
  '/api/v1/grid/split',
  authenticateToken,
  upload.single('image'),
  (req, res, next) => {
    gridController.split(req, res, next).catch(next);
  }
);

app.post(
  '/api/v1/background/remove',
  authenticateToken,
  upload.single('image'),
  (req, res, next) => {
    backgroundController.remove(req, res, next).catch(next);
  }
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
