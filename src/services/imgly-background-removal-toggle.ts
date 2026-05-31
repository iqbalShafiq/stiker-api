import { config } from '../config';

export function shouldUseImglyBackgroundRemoval(): boolean {
  if (process.env.NODE_ENV === 'test' || process.env.VITEST === 'true') {
    return false;
  }

  return config.imglyBackgroundRemoval.enabled;
}
