-- CreateTable
CREATE TABLE "PromptPreset" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "referenceHint" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromptPreset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PromptPreset_slug_key" ON "PromptPreset"("slug");

-- CreateIndex
CREATE INDEX "PromptPreset_category_idx" ON "PromptPreset"("category");

-- CreateIndex
CREATE INDEX "PromptPreset_isActive_sortOrder_idx" ON "PromptPreset"("isActive", "sortOrder");

-- Seed default presets (editable via admin API / DB later)
INSERT INTO "PromptPreset" ("id", "slug", "title", "category", "prompt", "referenceHint", "sortOrder", "isActive", "createdAt", "updatedAt")
VALUES
    ('00000000-0000-4000-8000-000000000001', 'meme', 'Meme', 'Fun', 'Funny meme sticker with bold outline and expressive face', NULL, 0, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('00000000-0000-4000-8000-000000000002', 'chibi', 'Chibi', 'Cute', 'Cute chibi character sticker with thick line art and pastel colors', NULL, 1, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('00000000-0000-4000-8000-000000000003', 'minimal', 'Minimal', 'Style', 'Minimal line-art sticker with flat colors and clean silhouette', NULL, 2, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('00000000-0000-4000-8000-000000000004', 'quote', 'Quote bubble', 'Text', 'Sticker with speech bubble and short witty caption text', NULL, 3, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
