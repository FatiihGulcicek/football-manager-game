-- CreateEnum
CREATE TYPE "ClubStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ClubBoardExpectation" AS ENUM ('AVOID_RELEGATION', 'STABLE_SEASON', 'TOP_HALF', 'TITLE_CHALLENGE', 'PROMOTION_PUSH', 'DEVELOP_PLAYERS');

-- DropForeignKey
ALTER TABLE "Club" DROP CONSTRAINT IF EXISTS "Club_ownerId_fkey";

-- AlterTable
ALTER TABLE "Club"
  ALTER COLUMN "ownerId" DROP NOT NULL,
  ADD COLUMN "threeLetterCode" TEXT,
  ADD COLUMN "primaryColor" TEXT NOT NULL DEFAULT '#1F4E79',
  ADD COLUMN "secondaryColor" TEXT NOT NULL DEFAULT '#FFFFFF',
  ADD COLUMN "logoAssetKey" TEXT,
  ADD COLUMN "countryCode" TEXT NOT NULL DEFAULT 'TR',
  ADD COLUMN "city" TEXT NOT NULL DEFAULT 'Unknown',
  ADD COLUMN "status" "ClubStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "transferBudget" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN "wageBudget" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN "currencyCode" TEXT NOT NULL DEFAULT 'EUR',
  ADD COLUMN "fanBase" INTEGER NOT NULL DEFAULT 1000,
  ADD COLUMN "foundedYear" INTEGER,
  ADD COLUMN "managerAssignedAt" TIMESTAMP(3),
  ADD COLUMN "stadiumName" TEXT NOT NULL DEFAULT 'Main Stadium',
  ADD COLUMN "stadiumCapacity" INTEGER NOT NULL DEFAULT 10000,
  ADD COLUMN "trainingFacilityLevel" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "youthFacilityLevel" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "currentLeagueId" TEXT,
  ADD COLUMN "divisionLevel" INTEGER,
  ADD COLUMN "boardExpectation" "ClubBoardExpectation" NOT NULL DEFAULT 'STABLE_SEASON';

-- Backfill legacy User-owned Club rows to the user's ManagerProfile.
-- The physical column name remains ownerId for compatibility with the existing index,
-- but Prisma now maps it as currentManagerProfileId.
UPDATE "Club"
SET
  "ownerId" = "ManagerProfile"."id",
  "managerAssignedAt" = COALESCE("Club"."managerAssignedAt", "Club"."createdAt")
FROM "ManagerProfile"
WHERE "Club"."ownerId" = "ManagerProfile"."userId";

-- If a legacy Club has no ManagerProfile, preserve the Club as managerless AI/NPC data.
UPDATE "Club"
SET "ownerId" = NULL
WHERE "ownerId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "ManagerProfile"
    WHERE "ManagerProfile"."id" = "Club"."ownerId"
  );

-- CreateIndex
CREATE UNIQUE INDEX "Club_threeLetterCode_key" ON "Club"("threeLetterCode");

-- CreateIndex
CREATE INDEX "Club_status_name_id_idx" ON "Club"("status", "name", "id");

-- CreateIndex
CREATE INDEX "Club_countryCode_status_idx" ON "Club"("countryCode", "status");

-- AddForeignKey
ALTER TABLE "Club" ADD CONSTRAINT "Club_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "ManagerProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Check constraints
ALTER TABLE "Club" ADD CONSTRAINT "Club_name_length_chk" CHECK (char_length("name") BETWEEN 2 AND 100);
ALTER TABLE "Club" ADD CONSTRAINT "Club_shortName_length_chk" CHECK (char_length("shortName") BETWEEN 2 AND 30);
ALTER TABLE "Club" ADD CONSTRAINT "Club_slug_format_chk" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
ALTER TABLE "Club" ADD CONSTRAINT "Club_threeLetterCode_format_chk" CHECK ("threeLetterCode" IS NULL OR "threeLetterCode" ~ '^[A-Z]{3}$');
ALTER TABLE "Club" ADD CONSTRAINT "Club_primaryColor_format_chk" CHECK ("primaryColor" ~ '^#[0-9A-F]{6}$');
ALTER TABLE "Club" ADD CONSTRAINT "Club_secondaryColor_format_chk" CHECK ("secondaryColor" ~ '^#[0-9A-F]{6}$');
ALTER TABLE "Club" ADD CONSTRAINT "Club_countryCode_format_chk" CHECK ("countryCode" ~ '^[A-Z]{2}$');
ALTER TABLE "Club" ADD CONSTRAINT "Club_currencyCode_format_chk" CHECK ("currencyCode" ~ '^[A-Z]{3}$');
ALTER TABLE "Club" ADD CONSTRAINT "Club_reputation_range_chk" CHECK ("reputation" BETWEEN 0 AND 10000);
ALTER TABLE "Club" ADD CONSTRAINT "Club_fanBase_nonnegative_chk" CHECK ("fanBase" >= 0);
ALTER TABLE "Club" ADD CONSTRAINT "Club_transferBudget_nonnegative_chk" CHECK ("transferBudget" >= 0);
ALTER TABLE "Club" ADD CONSTRAINT "Club_wageBudget_nonnegative_chk" CHECK ("wageBudget" >= 0);
ALTER TABLE "Club" ADD CONSTRAINT "Club_stadiumCapacity_nonnegative_chk" CHECK ("stadiumCapacity" >= 0);
ALTER TABLE "Club" ADD CONSTRAINT "Club_trainingFacilityLevel_range_chk" CHECK ("trainingFacilityLevel" BETWEEN 1 AND 20);
ALTER TABLE "Club" ADD CONSTRAINT "Club_youthFacilityLevel_range_chk" CHECK ("youthFacilityLevel" BETWEEN 1 AND 20);
ALTER TABLE "Club" ADD CONSTRAINT "Club_foundedYear_range_chk" CHECK ("foundedYear" IS NULL OR "foundedYear" BETWEEN 1800 AND 2100);
ALTER TABLE "Club" ADD CONSTRAINT "Club_divisionLevel_range_chk" CHECK ("divisionLevel" IS NULL OR "divisionLevel" >= 1);
