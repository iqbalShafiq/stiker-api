-- CreateEnum
CREATE TYPE "AiModelRole" AS ENUM ('agent', 'vision', 'improvement', 'image');

-- CreateTable
CREATE TABLE "AiModel" (
    "id" TEXT NOT NULL,
    "role" "AiModelRole" NOT NULL,
    "modelId" TEXT NOT NULL,
    "reasoningEfforts" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "defaultReasoningEffort" TEXT,
    "temperature" DOUBLE PRECISION,
    "maxTokens" INTEGER,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiModel_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiModel_role_key" ON "AiModel"("role");
