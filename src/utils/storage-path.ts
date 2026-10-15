import path from 'path';

/**
 * Canonical storage-relative form of a stored file reference.
 * Accepts both the URL form ('/uploads/users/x/a.png') and the relative form
 * ('users/x/a.png'); legacy records may hold either.
 */
export function toStorageRelativePath(storedPath: string): string {
  return storedPath
    .split('\\')
    .join('/')
    .replace(/^\/+/, '')
    .replace(/^uploads\//, '');
}

/** Absolute filesystem path for a stored file reference (legacy-prefix safe). */
export function resolveStoragePath(storedPath: string, uploadDir: string): string {
  return path.join(process.cwd(), uploadDir, toStorageRelativePath(storedPath));
}
