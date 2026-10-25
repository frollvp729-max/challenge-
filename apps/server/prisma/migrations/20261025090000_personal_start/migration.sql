-- Бессрочный вход: у каждого участия свой день старта, у челленджа — дата открытия.

ALTER TABLE "Challenge" ADD COLUMN "startDate" TEXT;
-- Все челленджи открываются 1 ноября 2026 (решение владельца, 2026-10-25)
UPDATE "Challenge" SET "startDate" = '2026-11-01';

ALTER TABLE "Enrollment" ADD COLUMN "startDate" TEXT;
-- Уже записанные сохраняют дату старта своего потока
UPDATE "Enrollment" e SET "startDate" = s."startDate" FROM "Stream" s WHERE s.id = e."streamId";
ALTER TABLE "Enrollment" ALTER COLUMN "startDate" SET NOT NULL;

DROP INDEX "Enrollment_userId_streamId_key";
CREATE UNIQUE INDEX "Enrollment_userId_streamId_startDate_key" ON "Enrollment"("userId", "streamId", "startDate");
