-- AlterTable
ALTER TABLE "User" ADD COLUMN "followerCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "followingCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "StickerPack" ADD COLUMN "likeCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "StickerPack" ADD COLUMN "saveCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "StickerPack" ADD COLUMN "downloadCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "StickerPackLike" (
    "id" TEXT NOT NULL,
    "stickerPackId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StickerPackLike_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StickerPackSave" (
    "id" TEXT NOT NULL,
    "stickerPackId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StickerPackSave_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StickerPackDownload" (
    "id" TEXT NOT NULL,
    "stickerPackId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StickerPackDownload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserFollow" (
    "id" TEXT NOT NULL,
    "followerId" TEXT NOT NULL,
    "followingId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserFollow_pkey" PRIMARY KEY ("id")
);

-- Backfill counters from any pre-existing relation rows if this migration is applied after manual data inserts.
UPDATE "StickerPack" sp
SET "likeCount" = COALESCE(l.count, 0)
FROM (
    SELECT "stickerPackId", COUNT(*)::INTEGER AS count
    FROM "StickerPackLike"
    GROUP BY "stickerPackId"
) l
WHERE sp.id = l."stickerPackId";

UPDATE "StickerPack" sp
SET "saveCount" = COALESCE(s.count, 0)
FROM (
    SELECT "stickerPackId", COUNT(*)::INTEGER AS count
    FROM "StickerPackSave"
    GROUP BY "stickerPackId"
) s
WHERE sp.id = s."stickerPackId";

UPDATE "StickerPack" sp
SET "downloadCount" = COALESCE(d.count, 0)
FROM (
    SELECT "stickerPackId", COUNT(*)::INTEGER AS count
    FROM "StickerPackDownload"
    GROUP BY "stickerPackId"
) d
WHERE sp.id = d."stickerPackId";

UPDATE "User" u
SET "followerCount" = COALESCE(f.count, 0)
FROM (
    SELECT "followingId", COUNT(*)::INTEGER AS count
    FROM "UserFollow"
    GROUP BY "followingId"
) f
WHERE u.id = f."followingId";

UPDATE "User" u
SET "followingCount" = COALESCE(f.count, 0)
FROM (
    SELECT "followerId", COUNT(*)::INTEGER AS count
    FROM "UserFollow"
    GROUP BY "followerId"
) f
WHERE u.id = f."followerId";

-- CreateIndex
CREATE INDEX "StickerPackLike_stickerPackId_idx" ON "StickerPackLike"("stickerPackId");
CREATE INDEX "StickerPackLike_userId_idx" ON "StickerPackLike"("userId");
CREATE INDEX "StickerPackLike_createdAt_idx" ON "StickerPackLike"("createdAt");
CREATE UNIQUE INDEX "StickerPackLike_stickerPackId_userId_key" ON "StickerPackLike"("stickerPackId", "userId");

CREATE INDEX "StickerPackSave_stickerPackId_idx" ON "StickerPackSave"("stickerPackId");
CREATE INDEX "StickerPackSave_userId_idx" ON "StickerPackSave"("userId");
CREATE INDEX "StickerPackSave_createdAt_idx" ON "StickerPackSave"("createdAt");
CREATE UNIQUE INDEX "StickerPackSave_stickerPackId_userId_key" ON "StickerPackSave"("stickerPackId", "userId");

CREATE INDEX "StickerPackDownload_stickerPackId_idx" ON "StickerPackDownload"("stickerPackId");
CREATE INDEX "StickerPackDownload_userId_idx" ON "StickerPackDownload"("userId");
CREATE INDEX "StickerPackDownload_createdAt_idx" ON "StickerPackDownload"("createdAt");

CREATE INDEX "UserFollow_followerId_idx" ON "UserFollow"("followerId");
CREATE INDEX "UserFollow_followingId_idx" ON "UserFollow"("followingId");
CREATE INDEX "UserFollow_createdAt_idx" ON "UserFollow"("createdAt");
CREATE UNIQUE INDEX "UserFollow_followerId_followingId_key" ON "UserFollow"("followerId", "followingId");

-- AddForeignKey
ALTER TABLE "StickerPackLike" ADD CONSTRAINT "StickerPackLike_stickerPackId_fkey" FOREIGN KEY ("stickerPackId") REFERENCES "StickerPack"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StickerPackLike" ADD CONSTRAINT "StickerPackLike_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StickerPackSave" ADD CONSTRAINT "StickerPackSave_stickerPackId_fkey" FOREIGN KEY ("stickerPackId") REFERENCES "StickerPack"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StickerPackSave" ADD CONSTRAINT "StickerPackSave_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StickerPackDownload" ADD CONSTRAINT "StickerPackDownload_stickerPackId_fkey" FOREIGN KEY ("stickerPackId") REFERENCES "StickerPack"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StickerPackDownload" ADD CONSTRAINT "StickerPackDownload_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserFollow" ADD CONSTRAINT "UserFollow_followerId_fkey" FOREIGN KEY ("followerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserFollow" ADD CONSTRAINT "UserFollow_followingId_fkey" FOREIGN KEY ("followingId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
