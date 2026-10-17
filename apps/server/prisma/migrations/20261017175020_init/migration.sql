-- CreateEnum
CREATE TYPE "ChallengeStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "PaymentMode" AS ENUM ('SUBSCRIPTION', 'ONE_TIME', 'FREE');

-- CreateEnum
CREATE TYPE "StreamStatus" AS ENUM ('UPCOMING', 'RUNNING', 'FINISHED');

-- CreateEnum
CREATE TYPE "EnrollmentStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('DONE', 'VIOLATED');

-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "telegramId" BIGINT NOT NULL,
    "username" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "photoUrl" TEXT,
    "displayName" TEXT,
    "age" INTEGER,
    "country" TEXT,
    "goal" TEXT,
    "goalOther" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Moscow',
    "botBlocked" BOOLEAN NOT NULL DEFAULT false,
    "onboarded" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Challenge" (
    "id" SERIAL NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "tagline" TEXT NOT NULL DEFAULT '',
    "intro" TEXT NOT NULL DEFAULT '',
    "rules" TEXT NOT NULL DEFAULT '',
    "coverUrl" TEXT,
    "status" "ChallengeStatus" NOT NULL DEFAULT 'DRAFT',
    "durationDays" INTEGER NOT NULL DEFAULT 30,
    "priceRub" INTEGER NOT NULL DEFAULT 490,
    "paymentMode" "PaymentMode" NOT NULL DEFAULT 'SUBSCRIPTION',
    "tributeLink" TEXT,
    "tributeSubscriptionId" INTEGER,
    "tributeProductId" INTEGER,
    "chatLink" TEXT,
    "morningHour" INTEGER NOT NULL DEFAULT 8,
    "eveningHour" INTEGER NOT NULL DEFAULT 22,
    "pointsDone" INTEGER NOT NULL DEFAULT 10,
    "pointsProof" INTEGER NOT NULL DEFAULT 5,
    "pointsViolation" INTEGER NOT NULL DEFAULT -10,
    "streakSaveCost" INTEGER NOT NULL DEFAULT 50,
    "streakSavesAllowed" INTEGER NOT NULL DEFAULT 1,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Challenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChallengeDay" (
    "id" SERIAL NOT NULL,
    "challengeId" INTEGER NOT NULL,
    "dayNumber" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "task" TEXT NOT NULL DEFAULT '',
    "hint" TEXT NOT NULL DEFAULT '',
    "imageUrl" TEXT,
    "points" INTEGER,
    "proofType" TEXT NOT NULL DEFAULT 'photo_or_text',
    "proofPrompt" TEXT NOT NULL DEFAULT 'Что сегодня было самым сложным?',
    "proofRequired" BOOLEAN NOT NULL DEFAULT false,
    "checklist" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "ChallengeDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Stream" (
    "id" SERIAL NOT NULL,
    "challengeId" INTEGER NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "startDate" TEXT NOT NULL,
    "enrollmentOpen" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Stream_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Enrollment" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "streamId" INTEGER NOT NULL,
    "status" "EnrollmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "source" TEXT NOT NULL DEFAULT 'admin',
    "points" INTEGER NOT NULL DEFAULT 0,
    "currentStreak" INTEGER NOT NULL DEFAULT 0,
    "bestStreak" INTEGER NOT NULL DEFAULT 0,
    "doneCount" INTEGER NOT NULL DEFAULT 0,
    "violatedCount" INTEGER NOT NULL DEFAULT 0,
    "missedCount" INTEGER NOT NULL DEFAULT 0,
    "streakSavesUsed" INTEGER NOT NULL DEFAULT 0,
    "savedDays" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "lastMorningDate" TEXT,
    "lastEveningDate" TEXT,
    "finishedNotified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Enrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Report" (
    "id" SERIAL NOT NULL,
    "enrollmentId" INTEGER NOT NULL,
    "dayNumber" INTEGER NOT NULL,
    "status" "ReportStatus" NOT NULL,
    "proofPhoto" TEXT,
    "proofText" TEXT,
    "checklistDone" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "proofRejected" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "tributeSubscriptionId" INTEGER NOT NULL,
    "periodId" INTEGER,
    "period" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER,
    "event" TEXT NOT NULL,
    "dedupKey" TEXT NOT NULL,
    "amount" INTEGER,
    "currency" TEXT,
    "challengeId" INTEGER,
    "raw" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Broadcast" (
    "id" SERIAL NOT NULL,
    "text" TEXT NOT NULL,
    "audience" TEXT NOT NULL DEFAULT 'all',
    "challengeId" INTEGER,
    "streamId" INTEGER,
    "buttonText" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "Broadcast_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_telegramId_key" ON "User"("telegramId");

-- CreateIndex
CREATE UNIQUE INDEX "Challenge_slug_key" ON "Challenge"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Challenge_tributeSubscriptionId_key" ON "Challenge"("tributeSubscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "Challenge_tributeProductId_key" ON "Challenge"("tributeProductId");

-- CreateIndex
CREATE UNIQUE INDEX "ChallengeDay_challengeId_dayNumber_key" ON "ChallengeDay"("challengeId", "dayNumber");

-- CreateIndex
CREATE INDEX "Stream_challengeId_startDate_idx" ON "Stream"("challengeId", "startDate");

-- CreateIndex
CREATE INDEX "Enrollment_streamId_points_idx" ON "Enrollment"("streamId", "points");

-- CreateIndex
CREATE UNIQUE INDEX "Enrollment_userId_streamId_key" ON "Enrollment"("userId", "streamId");

-- CreateIndex
CREATE UNIQUE INDEX "Report_enrollmentId_dayNumber_key" ON "Report"("enrollmentId", "dayNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_userId_tributeSubscriptionId_key" ON "Subscription"("userId", "tributeSubscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_dedupKey_key" ON "Payment"("dedupKey");

-- AddForeignKey
ALTER TABLE "ChallengeDay" ADD CONSTRAINT "ChallengeDay_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES "Challenge"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Stream" ADD CONSTRAINT "Stream_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES "Challenge"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_streamId_fkey" FOREIGN KEY ("streamId") REFERENCES "Stream"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "Enrollment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
