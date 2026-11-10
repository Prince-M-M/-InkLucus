-- AlterTable
ALTER TABLE "Appeal" ADD COLUMN     "reinstated" BOOLEAN,
ADD COLUMN     "resolution" TEXT,
ADD COLUMN     "resolvedAt" TIMESTAMP(3),
ADD COLUMN     "resolvedById" TEXT;

-- AlterTable
ALTER TABLE "Flag" ADD COLUMN     "commentId" TEXT;

-- CreateIndex
CREATE INDEX "Appeal_resolved_createdAt_idx" ON "Appeal"("resolved", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Flag_targetId_reporterId_key" ON "Flag"("targetId", "reporterId");

-- CreateIndex
CREATE UNIQUE INDEX "HomepageSlot_list_bookId_startsAt_key" ON "HomepageSlot"("list", "bookId", "startsAt");

