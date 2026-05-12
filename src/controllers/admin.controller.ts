import type { Response, NextFunction } from 'express';
import { prisma } from '../prisma/client';
import type { AuthRequest } from '../middleware/auth.middleware';
import { buildSuccessResponse } from '../utils/response-builder';
import { ValidationError, ForbiddenError, NotFoundError } from '../errors';

export class AdminController {
  async getUsers(_req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const users = await prisma.user.findMany({
        include: {
          role: true,
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      res.status(200).json(buildSuccessResponse(users));
    } catch (err) {
      next(err);
    }
  }

  async getUser(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;

      if (!id) {
        throw new ValidationError('User ID is required');
      }

      const user = await prisma.user.findUnique({
        where: { id },
        include: {
          role: true,
        },
      });

      if (!user) {
        throw new NotFoundError('User not found');
      }

      res.status(200).json(buildSuccessResponse(user));
    } catch (err) {
      next(err);
    }
  }

  async updateUser(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const { displayName, isActive } = req.body as Record<string, unknown>;

      if (!id) {
        throw new ValidationError('User ID is required');
      }

      const existingUser = await prisma.user.findUnique({
        where: { id },
      });

      if (!existingUser) {
        throw new NotFoundError('User not found');
      }

      const updateData: { displayName?: string; isActive?: boolean } = {};

      if (displayName !== undefined) {
        updateData.displayName = String(displayName);
      }

      if (isActive !== undefined) {
        updateData.isActive = Boolean(isActive);
      }

      const user = await prisma.user.update({
        where: { id },
        data: updateData,
        include: {
          role: true,
        },
      });

      res.status(200).json(buildSuccessResponse(user));
    } catch (err) {
      next(err);
    }
  }

  async deleteUser(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const currentUserId = req.user?.id;

      if (!id) {
        throw new ValidationError('User ID is required');
      }

      if (id === currentUserId) {
        throw new ForbiddenError('Cannot delete your own account');
      }

      const existingUser = await prisma.user.findUnique({
        where: { id },
      });

      if (!existingUser) {
        throw new NotFoundError('User not found');
      }

      await prisma.user.delete({
        where: { id },
      });

      res.status(200).json(buildSuccessResponse({ message: 'User deleted successfully' }));
    } catch (err) {
      next(err);
    }
  }

  async changeUserRole(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const { roleId } = req.body as Record<string, unknown>;

      if (!id) {
        throw new ValidationError('User ID is required');
      }

      if (!roleId) {
        throw new ValidationError('Role ID is required');
      }

      const existingUser = await prisma.user.findUnique({
        where: { id },
      });

      if (!existingUser) {
        throw new NotFoundError('User not found');
      }

      const role = await prisma.role.findUnique({
        where: { id: String(roleId) },
      });

      if (!role) {
        throw new NotFoundError('Role not found');
      }

      const user = await prisma.user.update({
        where: { id },
        data: { roleId: String(roleId) },
        include: {
          role: true,
        },
      });

      res.status(200).json(buildSuccessResponse(user));
    } catch (err) {
      next(err);
    }
  }
}
