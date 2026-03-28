-- Extend existing enum for booking-priced invoice lines
ALTER TYPE "InvoiceLineType" ADD VALUE IF NOT EXISTS 'BOOKING';

-- New enums
CREATE TYPE "BookingStatus" AS ENUM ('PENDING', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELED', 'NO_SHOW');
CREATE TYPE "BookingSource" AS ENUM ('STAFF', 'WEB', 'PHONE', 'IMPORT');
CREATE TYPE "WaitlistStatus" AS ENUM ('WAITING', 'OFFERED', 'CONVERTED', 'EXPIRED', 'REMOVED');
CREATE TYPE "RecipeStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');
CREATE TYPE "WorkflowRunStatus" AS ENUM ('PLANNED', 'RUNNING', 'PAUSED', 'COMPLETED', 'FAILED', 'CANCELED');
CREATE TYPE "WorkflowRunStepStatus" AS ENUM ('PENDING', 'READY', 'RUNNING', 'COMPLETED', 'SKIPPED', 'FAILED', 'CANCELED');

-- Required for exclusion constraints combining text + range
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Bookings
CREATE TABLE "Booking" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "createdByUserId" UUID,
  "invoiceId" UUID,
  "priceBookId" UUID,
  "priceBookItemId" UUID,
  "resourceKey" VARCHAR(100) NOT NULL,
  "startAt" TIMESTAMPTZ(6) NOT NULL,
  "endAt" TIMESTAMPTZ(6) NOT NULL,
  "status" "BookingStatus" NOT NULL DEFAULT 'PENDING',
  "source" "BookingSource" NOT NULL DEFAULT 'STAFF',
  "partySize" INTEGER NOT NULL DEFAULT 1,
  "notesCiphertext" TEXT,
  "notesIv" VARCHAR(64),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Booking_pkey" PRIMARY KEY ("id")
);

-- Waitlists
CREATE TABLE "Waitlist" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "bookingId" UUID,
  "resourceKey" VARCHAR(100) NOT NULL,
  "desiredStartAt" TIMESTAMPTZ(6) NOT NULL,
  "desiredEndAt" TIMESTAMPTZ(6) NOT NULL,
  "queueDate" DATE NOT NULL,
  "queuePosition" INTEGER NOT NULL DEFAULT 0,
  "status" "WaitlistStatus" NOT NULL DEFAULT 'WAITING',
  "contactCiphertext" TEXT,
  "contactIv" VARCHAR(64),
  "notesCiphertext" TEXT,
  "notesIv" VARCHAR(64),
  "offeredAt" TIMESTAMP(3),
  "convertedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Waitlist_pkey" PRIMARY KEY ("id")
);

-- Recipes and steps
CREATE TABLE "Recipe" (
  "id" UUID NOT NULL,
  "authorId" UUID,
  "code" VARCHAR(50) NOT NULL,
  "name" VARCHAR(140) NOT NULL,
  "description" TEXT,
  "yieldAmount" DECIMAL(10,2),
  "yieldUnit" VARCHAR(30),
  "prepTimeSeconds" INTEGER,
  "cookTimeSeconds" INTEGER,
  "holdTimeSeconds" INTEGER,
  "status" "RecipeStatus" NOT NULL DEFAULT 'DRAFT',
  "version" INTEGER NOT NULL DEFAULT 1,
  "internalNotesCiphertext" TEXT,
  "internalNotesIv" VARCHAR(64),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Recipe_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RecipeStep" (
  "id" UUID NOT NULL,
  "recipeId" UUID NOT NULL,
  "phaseNumber" INTEGER NOT NULL,
  "positionInPhase" INTEGER NOT NULL,
  "title" VARCHAR(140) NOT NULL,
  "instructionCiphertext" TEXT,
  "instructionIv" VARCHAR(64),
  "durationSeconds" INTEGER,
  "waitSeconds" INTEGER,
  "isBlocking" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RecipeStep_pkey" PRIMARY KEY ("id")
);

-- Timed workflow execution
CREATE TABLE "WorkflowRun" (
  "id" UUID NOT NULL,
  "recipeId" UUID NOT NULL,
  "bookingId" UUID,
  "operatorUserId" UUID,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "scheduledStartAt" TIMESTAMP(3),
  "status" "WorkflowRunStatus" NOT NULL DEFAULT 'PLANNED',
  "currentPhaseNumber" INTEGER,
  "recipeVersionSnapshot" INTEGER NOT NULL,
  "contextJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WorkflowRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WorkflowRunStep" (
  "id" UUID NOT NULL,
  "workflowRunId" UUID NOT NULL,
  "recipeStepId" UUID,
  "phaseNumber" INTEGER NOT NULL,
  "positionInPhase" INTEGER NOT NULL,
  "titleSnapshot" VARCHAR(140) NOT NULL,
  "durationSeconds" INTEGER,
  "waitSeconds" INTEGER,
  "status" "WorkflowRunStepStatus" NOT NULL DEFAULT 'PENDING',
  "readyAt" TIMESTAMP(3),
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WorkflowRunStep_pkey" PRIMARY KEY ("id")
);

-- Unique constraints
CREATE UNIQUE INDEX "Waitlist_resourceKey_queueDate_queuePosition_key"
ON "Waitlist"("resourceKey", "queueDate", "queuePosition");

CREATE UNIQUE INDEX "Recipe_code_key" ON "Recipe"("code");

CREATE UNIQUE INDEX "RecipeStep_recipeId_phaseNumber_positionInPhase_key"
ON "RecipeStep"("recipeId", "phaseNumber", "positionInPhase");

CREATE UNIQUE INDEX "WorkflowRunStep_workflowRunId_phaseNumber_positionInPhase_key"
ON "WorkflowRunStep"("workflowRunId", "phaseNumber", "positionInPhase");

-- Standard indexes
CREATE INDEX "Booking_userId_startAt_idx" ON "Booking"("userId", "startAt");
CREATE INDEX "Booking_resourceKey_startAt_endAt_idx" ON "Booking"("resourceKey", "startAt", "endAt");
CREATE INDEX "Booking_status_startAt_idx" ON "Booking"("status", "startAt");
CREATE INDEX "Booking_invoiceId_idx" ON "Booking"("invoiceId");

CREATE INDEX "Waitlist_resourceKey_queueDate_status_queuePosition_idx"
ON "Waitlist"("resourceKey", "queueDate", "status", "queuePosition");
CREATE INDEX "Waitlist_userId_status_idx" ON "Waitlist"("userId", "status");

CREATE INDEX "Recipe_status_idx" ON "Recipe"("status");
CREATE INDEX "RecipeStep_recipeId_phaseNumber_idx" ON "RecipeStep"("recipeId", "phaseNumber");

CREATE INDEX "WorkflowRun_recipeId_status_idx" ON "WorkflowRun"("recipeId", "status");
CREATE INDEX "WorkflowRun_bookingId_idx" ON "WorkflowRun"("bookingId");
CREATE INDEX "WorkflowRun_status_scheduledStartAt_idx" ON "WorkflowRun"("status", "scheduledStartAt");
CREATE INDEX "WorkflowRunStep_workflowRunId_status_phaseNumber_idx"
ON "WorkflowRunStep"("workflowRunId", "status", "phaseNumber");

-- Foreign keys
ALTER TABLE "Booking"
  ADD CONSTRAINT "Booking_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Booking"
  ADD CONSTRAINT "Booking_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Booking"
  ADD CONSTRAINT "Booking_invoiceId_fkey"
  FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Booking"
  ADD CONSTRAINT "Booking_priceBookId_fkey"
  FOREIGN KEY ("priceBookId") REFERENCES "PriceBook"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Booking"
  ADD CONSTRAINT "Booking_priceBookItemId_fkey"
  FOREIGN KEY ("priceBookItemId") REFERENCES "PriceBookItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Waitlist"
  ADD CONSTRAINT "Waitlist_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Waitlist"
  ADD CONSTRAINT "Waitlist_bookingId_fkey"
  FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Recipe"
  ADD CONSTRAINT "Recipe_authorId_fkey"
  FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "RecipeStep"
  ADD CONSTRAINT "RecipeStep_recipeId_fkey"
  FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WorkflowRun"
  ADD CONSTRAINT "WorkflowRun_recipeId_fkey"
  FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WorkflowRun"
  ADD CONSTRAINT "WorkflowRun_bookingId_fkey"
  FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "WorkflowRun"
  ADD CONSTRAINT "WorkflowRun_operatorUserId_fkey"
  FOREIGN KEY ("operatorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "WorkflowRunStep"
  ADD CONSTRAINT "WorkflowRunStep_workflowRunId_fkey"
  FOREIGN KEY ("workflowRunId") REFERENCES "WorkflowRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WorkflowRunStep"
  ADD CONSTRAINT "WorkflowRunStep_recipeStepId_fkey"
  FOREIGN KEY ("recipeStepId") REFERENCES "RecipeStep"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Data integrity checks
ALTER TABLE "Booking"
  ADD CONSTRAINT "Booking_time_range_check"
  CHECK ("endAt" > "startAt");

ALTER TABLE "Booking"
  ADD CONSTRAINT "Booking_partySize_check"
  CHECK ("partySize" > 0);

ALTER TABLE "Waitlist"
  ADD CONSTRAINT "Waitlist_time_range_check"
  CHECK ("desiredEndAt" > "desiredStartAt");

ALTER TABLE "Waitlist"
  ADD CONSTRAINT "Waitlist_queuePosition_positive_check"
  CHECK ("queuePosition" > 0);

ALTER TABLE "Recipe"
  ADD CONSTRAINT "Recipe_version_positive_check"
  CHECK ("version" > 0);

ALTER TABLE "RecipeStep"
  ADD CONSTRAINT "RecipeStep_phase_position_positive_check"
  CHECK ("phaseNumber" > 0 AND "positionInPhase" > 0);

ALTER TABLE "WorkflowRun"
  ADD CONSTRAINT "WorkflowRun_recipeVersionSnapshot_positive_check"
  CHECK ("recipeVersionSnapshot" > 0);

ALTER TABLE "WorkflowRunStep"
  ADD CONSTRAINT "WorkflowRunStep_phase_position_positive_check"
  CHECK ("phaseNumber" > 0 AND "positionInPhase" > 0);

-- Booking conflict prevention (no overlapping active bookings per resource)
ALTER TABLE "Booking"
  ADD CONSTRAINT "Booking_no_overlap_active"
  EXCLUDE USING gist (
    "resourceKey" WITH =,
    tstzrange("startAt", "endAt", '[)') WITH &&
  )
  WHERE ("status" IN ('PENDING', 'CONFIRMED', 'IN_PROGRESS'));

-- Waitlist FIFO assignment for queuePosition
CREATE OR REPLACE FUNCTION assign_waitlist_fifo_position()
RETURNS trigger AS $$
DECLARE
  next_position INTEGER;
BEGIN
  IF NEW."queuePosition" IS NULL OR NEW."queuePosition" <= 0 THEN
    PERFORM pg_advisory_xact_lock(hashtext(NEW."resourceKey" || ':' || NEW."queueDate"::text));

    SELECT COALESCE(MAX("queuePosition"), 0) + 1
    INTO next_position
    FROM "Waitlist"
    WHERE "resourceKey" = NEW."resourceKey"
      AND "queueDate" = NEW."queueDate";

    NEW."queuePosition" := next_position;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_waitlist_fifo_position
BEFORE INSERT ON "Waitlist"
FOR EACH ROW
EXECUTE FUNCTION assign_waitlist_fifo_position();
