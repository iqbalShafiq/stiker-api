import fs from 'fs';
import path from 'path';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { apiReference } from '@scalar/express-api-reference';
import { config } from './config';
import { upload } from './middleware/upload-handler';
import { validateRequest } from './middleware/validate-request';
import { errorHandler } from './middleware/error-handler';
import { generateImageSchema } from './utils/validators';
import { GenerateController } from './controllers/generate.controller';
import { GridController } from './controllers/grid.controller';
import { BackgroundController } from './controllers/background.controller';

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
app.use(cors({ origin: config.corsOrigin }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(config.uploadDir));

const generateController = new GenerateController();
const gridController = new GridController();
const backgroundController = new BackgroundController();

app.post(
  '/api/v1/generate',
  upload.single('image'),
  validateRequest(generateImageSchema),
  (req, res, next) => {
    generateController.generate(req, res, next).catch(next);
  }
);

app.post(
  '/api/v1/grid/split',
  upload.single('image'),
  (req, res, next) => {
    gridController.split(req, res, next).catch(next);
  }
);

app.post(
  '/api/v1/background/remove',
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
