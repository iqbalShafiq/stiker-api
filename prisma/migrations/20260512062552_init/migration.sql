-- CreateEnum
CREATE TYPE "StickerVisibility" AS ENUM ('PUBLIC', 'PRIVATE', 'UNLISTED');

-- CreateEnum
CREATE TYPE "SharePermission" AS ENUM ('VIEW', 'EDIT');

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "resource" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "id" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "displayName" TEXT,
    "roleId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sticker" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "visibility" "StickerVisibility" NOT NULL DEFAULT 'PRIVATE',
    "width" INTEGER,
    "height" INTEGER,
    "fileSize" INTEGER,
    "mimeType" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Sticker_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StickerShare" (
    "id" TEXT NOT NULL,
    "stickerId" TEXT NOT NULL,
    "sharedWithId" TEXT NOT NULL,
    "permission" "SharePermission" NOT NULL DEFAULT 'VIEW',
    "grantedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "StickerShare_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StickerShareLink" (
    "id" TEXT NOT NULL,
    "stickerId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "permission" "SharePermission" NOT NULL DEFAULT 'VIEW',
    "createdBy" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "maxUses" INTEGER,
    "usesCount" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StickerShareLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Role_name_key" ON "Role"("name");

-- CreateIndex
CREATE INDEX "Role_name_idx" ON "Role"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_name_key" ON "Permission"("name");

-- CreateIndex
CREATE INDEX "Permission_name_idx" ON "Permission"("name");

-- CreateIndex
CREATE INDEX "Permission_resource_action_idx" ON "Permission"("resource", "action");

-- CreateIndex
CREATE INDEX "RolePermission_roleId_idx" ON "RolePermission"("roleId");

-- CreateIndex
CREATE INDEX "RolePermission_permissionId_idx" ON "RolePermission"("permissionId");

-- CreateIndex
CREATE UNIQUE INDEX "RolePermission_roleId_permissionId_key" ON "RolePermission"("roleId", "permissionId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_username_idx" ON "User"("username");

-- CreateIndex
CREATE INDEX "User_roleId_idx" ON "User"("roleId");

-- CreateIndex
CREATE INDEX "Sticker_ownerId_idx" ON "Sticker"("ownerId");

-- CreateIndex
CREATE INDEX "Sticker_visibility_idx" ON "Sticker"("visibility");

-- CreateIndex
CREATE INDEX "Sticker_createdAt_idx" ON "Sticker"("createdAt");

-- CreateIndex
CREATE INDEX "Sticker_deletedAt_idx" ON "Sticker"("deletedAt");

-- CreateIndex
CREATE INDEX "StickerShare_stickerId_idx" ON "StickerShare"("stickerId");

-- CreateIndex
CREATE INDEX "StickerShare_sharedWithId_idx" ON "StickerShare"("sharedWithId");

-- CreateIndex
CREATE INDEX "StickerShare_grantedBy_idx" ON "StickerShare"("grantedBy");

-- CreateIndex
CREATE INDEX "StickerShare_expiresAt_idx" ON "StickerShare"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "StickerShare_stickerId_sharedWithId_key" ON "StickerShare"("stickerId", "sharedWithId");

-- CreateIndex
CREATE UNIQUE INDEX "StickerShareLink_token_key" ON "StickerShareLink"("token");

-- CreateIndex
CREATE INDEX "StickerShareLink_stickerId_idx" ON "StickerShareLink"("stickerId");

-- CreateIndex
CREATE INDEX "StickerShareLink_token_idx" ON "StickerShareLink"("token");

-- CreateIndex
CREATE INDEX "StickerShareLink_createdBy_idx" ON "StickerShareLink"("createdBy");

-- CreateIndex
CREATE INDEX "StickerShareLink_expiresAt_idx" ON "StickerShareLink"("expiresAt");

-- CreateIndex
CREATE INDEX "StickerShareLink_isActive_idx" ON "StickerShareLink"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_token_key" ON "RefreshToken"("token");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

-- CreateIndex
CREATE INDEX "RefreshToken_token_idx" ON "RefreshToken"("token");

-- CreateIndex
CREATE INDEX "RefreshToken_expiresAt_idx" ON "RefreshToken"("expiresAt");

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sticker" ADD CONSTRAINT "Sticker_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StickerShare" ADD CONSTRAINT "StickerShare_stickerId_fkey" FOREIGN KEY ("stickerId") REFERENCES "Sticker"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StickerShare" ADD CONSTRAINT "StickerShare_sharedWithId_fkey" FOREIGN KEY ("sharedWithId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StickerShare" ADD CONSTRAINT "StickerShare_grantedBy_fkey" FOREIGN KEY ("grantedBy") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StickerShareLink" ADD CONSTRAINT "StickerShareLink_stickerId_fkey" FOREIGN KEY ("stickerId") REFERENCES "Sticker"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StickerShareLink" ADD CONSTRAINT "StickerShareLink_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
