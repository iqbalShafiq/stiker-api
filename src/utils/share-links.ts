import { config } from '../config';

export type ShareResourceType = 'pack' | 'sticker';

export interface ShareLinkUrls {
  shareUrl: string;
  deepLinkUrl: string;
  webFallbackUrl: string;
}

export function buildShareLinkUrls(type: ShareResourceType, token: string): ShareLinkUrls {
  const apiBase = config.appUrl.replace(/\/$/, '');
  const webBase = config.publicWebBaseUrl.replace(/\/$/, '');
  const scheme = config.appDeepLinkScheme;
  return {
    shareUrl: `${apiBase}/api/v1/share/${type}/${token}`,
    deepLinkUrl: `${scheme}://share/${type}/${token}`,
    webFallbackUrl: `${webBase}/share/${type}/${token}`,
  };
}

export function withShareLinkUrls<T extends Record<string, unknown>>(
  type: ShareResourceType,
  token: string,
  link: T
): T & ShareLinkUrls {
  return {
    ...link,
    ...buildShareLinkUrls(type, token),
  };
}
