-- Мессенджер Max: аккаунт участника и куда слать напоминания
ALTER TABLE "User" ADD COLUMN "maxId" BIGINT;
ALTER TABLE "User" ADD COLUMN "maxBlocked" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "lastPlatform" TEXT;
CREATE UNIQUE INDEX "User_maxId_key" ON "User"("maxId");
