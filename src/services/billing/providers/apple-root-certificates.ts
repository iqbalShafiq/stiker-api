import fs from 'fs';
import path from 'path';
import { logger } from '../../../utils/logger';

const APPLE_ROOT_CERT_URLS = [
  'https://www.apple.com/certificateauthority/AppleRootCA-G3.cer',
  'https://www.apple.com/appleca/AppleIncRootCertificate.cer',
] as const;

let cachedCertificates: Buffer[] | null = null;

function loadBundledCertificates(): Buffer[] | null {
  const certDir = path.join(__dirname, 'certs');
  if (!fs.existsSync(certDir)) {
    return null;
  }
  const files = fs.readdirSync(certDir).filter((name) => name.endsWith('.cer'));
  if (files.length === 0) {
    return null;
  }
  return files.map((name) => fs.readFileSync(path.join(certDir, name)));
}

async function fetchAppleRootCertificates(): Promise<Buffer[]> {
  const bundled = loadBundledCertificates();
  if (bundled) {
    return bundled;
  }

  const certificates: Buffer[] = [];
  for (const url of APPLE_ROOT_CERT_URLS) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to download Apple root certificate from ${url}`);
    }
    certificates.push(Buffer.from(await response.arrayBuffer()));
  }
  return certificates;
}

export async function getAppleRootCertificates(): Promise<Buffer[]> {
  if (cachedCertificates) {
    return cachedCertificates;
  }
  cachedCertificates = await fetchAppleRootCertificates();
  logger.info({ count: cachedCertificates.length }, 'Loaded Apple root certificates');
  return cachedCertificates;
}
