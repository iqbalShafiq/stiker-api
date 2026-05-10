import path from 'path';
import multer from 'multer';
import { config } from '../config';

const ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'];

const EXTENSION_TO_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

const storage = multer.memoryStorage();

export const upload = multer({
  storage,
  limits: {
    fileSize: config.maxFileSize,
  },
  fileFilter: (_req, file, cb) => {
    let effectiveMime = file.mimetype;
    if (!ALLOWED_MIME_TYPES.includes(effectiveMime)) {
      const ext = path.extname(file.originalname).toLowerCase();
      const inferred = EXTENSION_TO_MIME[ext];
      if (inferred) {
        effectiveMime = inferred;
        file.mimetype = inferred;
      }
    }

    if (ALLOWED_MIME_TYPES.includes(effectiveMime)) {
      cb(null, true);
    } else {
      cb(new Error('INVALID_FILE_TYPE: Only PNG, JPG, JPEG, WebP, and GIF are allowed'));
    }
  },
});
