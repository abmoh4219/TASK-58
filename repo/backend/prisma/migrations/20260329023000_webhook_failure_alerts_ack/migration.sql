ALTER TYPE "NotificationScenario" ADD VALUE IF NOT EXISTS 'WEBHOOK_FAILURE';

CREATE TYPE "WebhookFailureAlertStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED');
CREATE TYPE "WebhookFailureTriggerType" AS ENUM ('RETRY_THRESHOLD', 'DEAD_LETTER');

CREATE TABLE "WebhookFailureAlert" (
  "id" UUID NOT NULL,
  "webhookConfigId" UUID NOT NULL,
  "latestWebhookLogId" UUID,
  "eventKey" VARCHAR(80) NOT NULL,
  "status" "WebhookFailureAlertStatus" NOT NULL DEFAULT 'OPEN',
  "triggerType" "WebhookFailureTriggerType" NOT NULL,
  "failureCount" INTEGER NOT NULL DEFAULT 1,
  "firstFailedAt" TIMESTAMP(3) NOT NULL,
  "lastFailedAt" TIMESTAMP(3) NOT NULL,
  "lastErrorMessage" VARCHAR(255),
  "acknowledgedByUserId" UUID,
  "acknowledgedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WebhookFailureAlert_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WebhookFailureAlert_status_updatedAt_idx"
ON "WebhookFailureAlert"("status", "updatedAt");

CREATE INDEX "WebhookFailureAlert_webhookConfigId_status_idx"
ON "WebhookFailureAlert"("webhookConfigId", "status");

CREATE INDEX "WebhookFailureAlert_eventKey_status_idx"
ON "WebhookFailureAlert"("eventKey", "status");

ALTER TABLE "WebhookFailureAlert"
  ADD CONSTRAINT "WebhookFailureAlert_webhookConfigId_fkey"
  FOREIGN KEY ("webhookConfigId") REFERENCES "WebhookConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WebhookFailureAlert"
  ADD CONSTRAINT "WebhookFailureAlert_latestWebhookLogId_fkey"
  FOREIGN KEY ("latestWebhookLogId") REFERENCES "WebhookLog"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "WebhookFailureAlert"
  ADD CONSTRAINT "WebhookFailureAlert_acknowledgedByUserId_fkey"
  FOREIGN KEY ("acknowledgedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "WebhookFailureAlert"
  ADD CONSTRAINT "WebhookFailureAlert_failureCount_check"
  CHECK ("failureCount" > 0);
