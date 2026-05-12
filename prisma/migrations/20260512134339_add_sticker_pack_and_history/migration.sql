-- CreateTable
CREATE TABLE "StickerPack" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "visibility" "StickerVisibility" NOT NULL DEFAULT 'PRIVATE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "StickerPack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StickerPackSticker" (
    "id" TEXT NOT NULL,
    "stickerPackId" TEXT NOT NULL,
    "stickerId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StickerPackSticker_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StickerPackShare" (
    "id" TEXT NOT NULL,
    "stickerPackId" TEXT NOT NULL,
    "sharedWithId" TEXT NOT NULL,
    "permission" "SharePermission" NOT NULL DEFAULT 'VIEW',
    "grantedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "StickerPackShare_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StickerPackShareLink" (
    "id" TEXT NOT NULL,
    "stickerPackId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "permission" "SharePermission" NOT NULL DEFAULT 'VIEW',
    "createdBy" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "maxUses" INTEGER,
    "usesCount" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StickerPackShareLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessingHistory" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "inputData" JSONB,
    "outputFiles" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessingHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StickerPack_ownerId_idx" ON "StickerPack"("ownerId");

-- CreateIndex
CREATE INDEX "StickerPack_visibility_idx" ON "StickerPack"("visibility");

-- CreateIndex
CREATE INDEX "StickerPack_deletedAt_idx" ON "StickerPack"("deletedAt");

-- CreateIndex
CREATE INDEX "StickerPack_updatedAt_idx" ON "StickerPack"("updatedAt");

-- CreateIndex
CREATE INDEX "StickerPackSticker_stickerPackId_idx" ON "StickerPackSticker"("stickerPackId");

-- CreateIndex
CREATE INDEX "StickerPackSticker_stickerId_idx" ON "StickerPackSticker"("stickerId");

-- CreateIndex
CREATE UNIQUE INDEX "StickerPackSticker_stickerPackId_stickerId_key" ON "StickerPackSticker"("stickerPackId", "stickerId");

-- CreateIndex
CREATE INDEX "StickerPackShare_stickerPackId_idx" ON "StickerPackShare"("stickerPackId");

-- CreateIndex
CREATE INDEX "StickerPackShare_sharedWithId_idx" ON "StickerPackShare"("sharedWithId");

-- CreateIndex
CREATE INDEX "StickerPackShare_grantedBy_idx" ON "StickerPackShare"("grantedBy");

-- CreateIndex
CREATE INDEX "StickerPackShare_expiresAt_idx" ON "StickerPackShare"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "StickerPackShare_stickerPackId_sharedWithId_key" ON "StickerPackShare"("stickerPackId", "sharedWithId");

-- CreateIndex
CREATE UNIQUE INDEX "StickerPackShareLink_token_key" ON "StickerPackShareLink"("token");

-- CreateIndex
CREATE INDEX "StickerPackShareLink_stickerPackId_idx" ON "StickerPackShareLink"("stickerPackId");

-- CreateIndex
CREATE INDEX "StickerPackShareLink_token_idx" ON "StickerPackShareLink"("token");

-- CreateIndex
CREATE INDEX "StickerPackShareLink_createdBy_idx" ON "StickerPackShareLink"("createdBy");

-- CreateIndex
CREATE INDEX "StickerPackShareLink_expiresAt_idx" ON "StickerPackShareLink"("expiresAt");

-- CreateIndex
CREATE INDEX "StickerPackShareLink_isActive_idx" ON "StickerPackShareLink"("isActive");

-- CreateIndex
CREATE INDEX "ProcessingHistory_userId_idx" ON "ProcessingHistory"("userId");

-- CreateIndex
CREATE INDEX "ProcessingHistory_type_idx" ON "ProcessingHistory"("type");

-- CreateIndex
CREATE INDEX "ProcessingHistory_expiresAt_idx" ON "ProcessingHistory"("expiresAt");

-- CreateIndex
CREATE INDEX "ProcessingHistory_createdAt_idx" ON "ProcessingHistory"("createdAt");

-- AddForeignKey
ALTER TABLE "StickerPack" ADD CONSTRAINT "StickerPack_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StickerPackSticker" ADD CONSTRAINT "StickerPackSticker_stickerPackId_fkey" FOREIGN KEY ("stickerPackId") REFERENCES "StickerPack"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StickerPackSticker" ADD CONSTRAINT "StickerPackSticker_stickerId_fkey" FOREIGN KEY ("stickerId") REFERENCES "Sticker"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StickerPackShare" ADD CONSTRAINT "StickerPackShare_stickerPackId_fkey" FOREIGN KEY ("stickerPackId") REFERENCES "StickerPack"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StickerPackShare" ADD CONSTRAINT "StickerPackShare_sharedWithId_fkey" FOREIGN KEY ("sharedWithId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StickerPackShare" ADD CONSTRAINT "StickerPackShare_grantedBy_fkey" FOREIGN KEY ("grantedBy") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StickerPackShareLink" ADD CONSTRAINT "StickerPackShareLink_stickerPackId_fkey" FOREIGN KEY ("stickerPackId") REFERENCES "StickerPack"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StickerPackShareLink" ADD CONSTRAINT "StickerPackShareLink_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessingHistory" ADD CONSTRAINT "ProcessingHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
