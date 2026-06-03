import type { Response, NextFunction } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware';
import { featuredService } from '../services/featured.service';
import { buildSuccessResponse } from '../utils/response-builder';
import { loadViewerSocialState, mapPackWithSocial } from '../utils/pack-query';

export class FeaturedController {
  async getToday(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const featured = await featuredService.getTodayFeatured();
      if (!featured) {
        res.status(200).json(buildSuccessResponse(null));
        return;
      }
      const social = await loadViewerSocialState(featured.pack, req.user?.id);
      res.status(200).json(
        buildSuccessResponse({
          pack: mapPackWithSocial(featured.pack, social),
          score: featured.score,
          windowStart: featured.windowStart,
          windowEnd: featured.windowEnd,
        })
      );
    } catch (error) {
      next(error);
    }
  }
}
