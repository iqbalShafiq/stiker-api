import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcrypt';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  const roles = [
    { name: 'user', description: 'Standard user with basic permissions' },
    { name: 'admin', description: 'Administrator with full access' },
  ];

  const permissions = [
    { name: 'sticker:read', description: 'Read stickers', resource: 'sticker', action: 'read' },
    { name: 'sticker:write', description: 'Create and update stickers', resource: 'sticker', action: 'write' },
    { name: 'sticker:delete', description: 'Delete stickers', resource: 'sticker', action: 'delete' },
    { name: 'sticker:share', description: 'Share stickers with others', resource: 'sticker', action: 'share' },
    { name: 'user:read', description: 'Read user profiles', resource: 'user', action: 'read' },
    { name: 'user:write', description: 'Update user profiles', resource: 'user', action: 'write' },
    { name: 'user:delete', description: 'Delete users', resource: 'user', action: 'delete' },
    { name: 'admin:access', description: 'Access admin panel', resource: 'admin', action: 'access' },
  ];

  // Seed roles
  for (const role of roles) {
    await prisma.role.upsert({
      where: { name: role.name },
      update: {},
      create: role,
    });
  }

  // Seed permissions
  for (const permission of permissions) {
    await prisma.permission.upsert({
      where: { name: permission.name },
      update: {},
      create: permission,
    });
  }

  // Get created roles and permissions
  const userRole = await prisma.role.findUnique({ where: { name: 'user' } });
  const adminRole = await prisma.role.findUnique({ where: { name: 'admin' } });

  const allPermissions = await prisma.permission.findMany();

  const userPermissionNames = ['sticker:read', 'sticker:write', 'sticker:delete', 'sticker:share', 'user:read', 'user:write'];
  const userPermissions = allPermissions.filter(p => userPermissionNames.includes(p.name));

  // Assign permissions to user role
  for (const permission of userPermissions) {
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: {
          roleId: userRole!.id,
          permissionId: permission.id,
        },
      },
      update: {},
      create: {
        roleId: userRole!.id,
        permissionId: permission.id,
      },
    });
  }

  // Assign all permissions to admin role
  for (const permission of allPermissions) {
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: {
          roleId: adminRole!.id,
          permissionId: permission.id,
        },
      },
      update: {},
      create: {
        roleId: adminRole!.id,
        permissionId: permission.id,
      },
    });
  }

  // Create default admin user
  const passwordHash = await bcrypt.hash('Admin123!', 12);

  await prisma.user.upsert({
    where: { email: 'admin@example.com' },
    update: {},
    create: {
      email: 'admin@example.com',
      username: 'admin',
      passwordHash,
      displayName: 'Administrator',
      roleId: adminRole!.id,
      isActive: true,
      emailVerified: true,
    },
  });

  console.log('Seed completed successfully');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
