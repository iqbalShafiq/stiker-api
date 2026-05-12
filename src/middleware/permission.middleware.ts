import type { Response, NextFunction } from 'express';
import { AuthRequest } from './auth.middleware';
import { ForbiddenError } from '../errors';
import { RoleService } from '../services/role.service';

const roleService = new RoleService();

export function requirePermission(...requiredPermissions: string[]) {
  return async (req: AuthRequest, _res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      return next(new ForbiddenError('Access denied'));
    }

    const hasPermissions = await roleService.hasAllPermissions(req.user.id, requiredPermissions);

    if (!hasPermissions) {
      return next(new ForbiddenError('Access denied'));
    }

    next();
  };
}
