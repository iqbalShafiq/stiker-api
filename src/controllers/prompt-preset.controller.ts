import type { Response, NextFunction } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware';
import { promptPresetService } from '../services/prompt-preset.service';
import { buildSuccessResponse } from '../utils/response-builder';
import { ValidationError } from '../errors';

export class PromptPresetController {
  /** Public list for mobile app generate flows */
  async list(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const category =
        typeof req.query.category === 'string' ? req.query.category : undefined;
      const presets = await promptPresetService.listActive(category);
      res.status(200).json(buildSuccessResponse(presets));
    } catch (error) {
      next(error);
    }
  }

  async listAll(_req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const presets = await promptPresetService.listAll();
      res.status(200).json(buildSuccessResponse(presets));
    } catch (error) {
      next(error);
    }
  }

  async create(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = req.body as Record<string, unknown>;
      const slug = typeof body.slug === 'string' ? body.slug : '';
      const title = typeof body.title === 'string' ? body.title : '';
      const category = typeof body.category === 'string' ? body.category : '';
      const prompt = typeof body.prompt === 'string' ? body.prompt : '';
      if (!slug || !title || !category || !prompt) {
        throw new ValidationError('slug, title, category, and prompt are required');
      }
      const preset = await promptPresetService.create({
        slug,
        title,
        category,
        prompt,
        referenceHint: typeof body.referenceHint === 'string' ? body.referenceHint : null,
        sortOrder: typeof body.sortOrder === 'number' ? body.sortOrder : undefined,
        isActive: typeof body.isActive === 'boolean' ? body.isActive : undefined,
      });
      res.status(201).json(buildSuccessResponse(preset));
    } catch (error) {
      next(error);
    }
  }

  async update(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const slug = req.params.slug;
      if (!slug) {
        throw new ValidationError('slug is required');
      }
      const body = req.body as Record<string, unknown>;
      const preset = await promptPresetService.update(slug, {
        title: typeof body.title === 'string' ? body.title : undefined,
        category: typeof body.category === 'string' ? body.category : undefined,
        prompt: typeof body.prompt === 'string' ? body.prompt : undefined,
        referenceHint:
          body.referenceHint === null
            ? null
            : typeof body.referenceHint === 'string'
              ? body.referenceHint
              : undefined,
        sortOrder: typeof body.sortOrder === 'number' ? body.sortOrder : undefined,
        isActive: typeof body.isActive === 'boolean' ? body.isActive : undefined,
      });
      res.status(200).json(buildSuccessResponse(preset));
    } catch (error) {
      next(error);
    }
  }

  async remove(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const slug = req.params.slug;
      if (!slug) {
        throw new ValidationError('slug is required');
      }
      await promptPresetService.delete(slug);
      res.status(200).json(buildSuccessResponse({ deleted: true }));
    } catch (error) {
      next(error);
    }
  }
}
