CREATE TYPE "NotificationScenario" AS ENUM (
  'BOOKING_SUCCESS',
  'SCHEDULE_CHANGE',
  'CANCELLATION',
  'WAITLIST_PROMOTION',
  'CLASS_REMINDER'
);

ALTER TABLE "Notification"
  ADD COLUMN "scenario" "NotificationScenario" NOT NULL DEFAULT 'BOOKING_SUCCESS';

CREATE INDEX "Notification_scenario_createdAt_idx"
ON "Notification"("scenario", "createdAt");

CREATE TABLE "UserNotificationPreference" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "globalMuted" BOOLEAN NOT NULL DEFAULT FALSE,
  "mutedCategories" "NotificationScenario"[] DEFAULT ARRAY[]::"NotificationScenario"[],
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UserNotificationPreference_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserNotificationPreference_userId_key"
ON "UserNotificationPreference"("userId");

ALTER TABLE "UserNotificationPreference"
  ADD CONSTRAINT "UserNotificationPreference_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
