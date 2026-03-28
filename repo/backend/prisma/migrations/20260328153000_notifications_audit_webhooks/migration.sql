-- New enums
CREATE TYPE "NotificationChannel" AS ENUM ('EMAIL', 'SMS', 'PUSH', 'WEBHOOK', 'INTERNAL');
CREATE TYPE "NotificationStatus" AS ENUM ('QUEUED', 'SENT', 'FAILED', 'CANCELED');
CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT', 'EXPORT', 'MANUAL');
CREATE TYPE "WebhookStatus" AS ENUM ('ACTIVE', 'PAUSED', 'DISABLED');
CREATE TYPE "WebhookDeliveryStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'DEAD_LETTER');

-- Notifications
CREATE TABLE "Notification" (
  "id" UUID NOT NULL,
  "userId" UUID,
  "channel" "NotificationChannel" NOT NULL,
  "status" "NotificationStatus" NOT NULL DEFAULT 'QUEUED',
  "templateKey" VARCHAR(80),
  "subject" VARCHAR(200),
  "payloadJson" JSONB,
  "bodyCiphertext" TEXT,
  "bodyIv" VARCHAR(64),
  "destinationHash" VARCHAR(128),
  "destinationCiphertext" TEXT,
  "destinationIv" VARCHAR(64),
  "scheduledFor" TIMESTAMP(3),
  "sentAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3),
  "failureReason" VARCHAR(255),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- Audit logs (append-only)
CREATE TABLE "AuditLog" (
  "id" UUID NOT NULL,
  "actorUserId" UUID,
  "action" "AuditAction" NOT NULL,
  "entityType" VARCHAR(80) NOT NULL,
  "entityId" UUID,
  "entityLabel" VARCHAR(140),
  "requestId" VARCHAR(100),
  "ipHash" VARCHAR(128),
  "userAgentCiphertext" TEXT,
  "userAgentIv" VARCHAR(64),
  "beforeJson" JSONB,
  "afterJson" JSONB,
  "sensitiveCiphertext" TEXT,
  "sensitiveIv" VARCHAR(64),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- Webhook configuration
CREATE TABLE "WebhookConfig" (
  "id" UUID NOT NULL,
  "createdByUserId" UUID,
  "name" VARCHAR(120) NOT NULL,
  "eventKey" VARCHAR(80) NOT NULL,
  "status" "WebhookStatus" NOT NULL DEFAULT 'ACTIVE',
  "endpointHash" VARCHAR(128) NOT NULL,
  "endpointCiphertext" TEXT NOT NULL,
  "endpointIv" VARCHAR(64),
  "signingSecretCiphertext" TEXT,
  "signingSecretIv" VARCHAR(64),
  "timeoutSeconds" INTEGER NOT NULL DEFAULT 10,
  "maxRetries" INTEGER NOT NULL DEFAULT 5,
  "headersJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WebhookConfig_pkey" PRIMARY KEY ("id")
);

-- Webhook delivery logs
CREATE TABLE "WebhookLog" (
  "id" UUID NOT NULL,
  "webhookConfigId" UUID NOT NULL,
  "deliveryStatus" "WebhookDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "eventKey" VARCHAR(80) NOT NULL,
  "attemptNumber" INTEGER NOT NULL DEFAULT 1,
  "requestHeadersJson" JSONB,
  "requestBodyCiphertext" TEXT,
  "requestBodyIv" VARCHAR(64),
  "responseHeadersJson" JSONB,
  "responseBodyCiphertext" TEXT,
  "responseBodyIv" VARCHAR(64),
  "responseStatusCode" INTEGER,
  "errorMessage" VARCHAR(255),
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "respondedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WebhookLog_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");
CREATE INDEX "Notification_status_scheduledFor_idx" ON "Notification"("status", "scheduledFor");
CREATE INDEX "Notification_channel_status_createdAt_idx" ON "Notification"("channel", "status", "createdAt");

CREATE INDEX "AuditLog_entityType_entityId_createdAt_idx" ON "AuditLog"("entityType", "entityId", "createdAt");
CREATE INDEX "AuditLog_actorUserId_createdAt_idx" ON "AuditLog"("actorUserId", "createdAt");
CREATE INDEX "AuditLog_requestId_idx" ON "AuditLog"("requestId");

CREATE INDEX "WebhookConfig_eventKey_status_idx" ON "WebhookConfig"("eventKey", "status");
CREATE INDEX "WebhookConfig_endpointHash_idx" ON "WebhookConfig"("endpointHash");

CREATE INDEX "WebhookLog_webhookConfigId_requestedAt_idx" ON "WebhookLog"("webhookConfigId", "requestedAt");
CREATE INDEX "WebhookLog_deliveryStatus_requestedAt_idx" ON "WebhookLog"("deliveryStatus", "requestedAt");
CREATE INDEX "WebhookLog_eventKey_deliveryStatus_requestedAt_idx" ON "WebhookLog"("eventKey", "deliveryStatus", "requestedAt");

-- Foreign keys
ALTER TABLE "Notification"
  ADD CONSTRAINT "Notification_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AuditLog"
  ADD CONSTRAINT "AuditLog_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "WebhookConfig"
  ADD CONSTRAINT "WebhookConfig_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "WebhookLog"
  ADD CONSTRAINT "WebhookLog_webhookConfigId_fkey"
  FOREIGN KEY ("webhookConfigId") REFERENCES "WebhookConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Data integrity checks
ALTER TABLE "WebhookConfig"
  ADD CONSTRAINT "WebhookConfig_timeoutSeconds_check"
  CHECK ("timeoutSeconds" > 0 AND "timeoutSeconds" <= 120);

ALTER TABLE "WebhookConfig"
  ADD CONSTRAINT "WebhookConfig_maxRetries_check"
  CHECK ("maxRetries" >= 0 AND "maxRetries" <= 25);

ALTER TABLE "WebhookLog"
  ADD CONSTRAINT "WebhookLog_attemptNumber_check"
  CHECK ("attemptNumber" > 0);

ALTER TABLE "WebhookLog"
  ADD CONSTRAINT "WebhookLog_responseStatusCode_check"
  CHECK ("responseStatusCode" IS NULL OR ("responseStatusCode" >= 100 AND "responseStatusCode" <= 599));

-- Audit log append-only immutability
CREATE OR REPLACE FUNCTION prevent_audit_log_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AuditLog is append-only; updates and deletes are not allowed';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_log_no_update
BEFORE UPDATE ON "AuditLog"
FOR EACH ROW
EXECUTE FUNCTION prevent_audit_log_mutation();

CREATE TRIGGER trg_audit_log_no_delete
BEFORE DELETE ON "AuditLog"
FOR EACH ROW
EXECUTE FUNCTION prevent_audit_log_mutation();
