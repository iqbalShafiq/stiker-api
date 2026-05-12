import { prisma } from '../prisma/client';

export class RoleService {
  async getUserPermissions(userId: string): Promise<string[]> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        role: {
          include: {
            permissions: {
              include: {
                permission: true,
              },
            },
          },
        },
      },
    });

    if (!user) {
      return [];
    }

    return user.role.permissions.map((rp) => rp.permission.name);
  }

  async hasPermission(userId: string, permissionName: string): Promise<boolean> {
    const permissions = await this.getUserPermissions(userId);
    return permissions.includes('*') || permissions.includes(permissionName);
  }

  async hasAnyPermission(userId: string, permissionNames: string[]): Promise<boolean> {
    const permissions = await this.getUserPermissions(userId);

    if (permissions.includes('*')) {
      return true;
    }

    return permissionNames.some((name) => permissions.includes(name));
  }

  async hasAllPermissions(userId: string, permissionNames: string[]): Promise<boolean> {
    const permissions = await this.getUserPermissions(userId);

    if (permissions.includes('*')) {
      return true;
    }

    return permissionNames.every((name) => permissions.includes(name));
  }

  async isAdmin(userId: string): Promise<boolean> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { role: true },
    });

    if (!user) {
      return false;
    }

    return user.role.name === 'admin';
  }
}
