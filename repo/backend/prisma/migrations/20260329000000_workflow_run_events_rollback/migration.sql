CREATE TYPE "WorkflowRunEventType" AS ENUM ('STEP_COMPLETED', 'STEP_SKIPPED', 'STEP_ROLLBACK');

CREATE TABLE "WorkflowRunEvent" (
  "id" UUID NOT NULL,
  "workflowRunId" UUID NOT NULL,
  "workflowRunStepId" UUID,
  "actorUserId" UUID,
  "eventType" "WorkflowRunEventType" NOT NULL,
  "eventData" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkflowRunEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WorkflowRunEvent_workflowRunId_createdAt_idx"
ON "WorkflowRunEvent"("workflowRunId", "createdAt");

CREATE INDEX "WorkflowRunEvent_actorUserId_createdAt_idx"
ON "WorkflowRunEvent"("actorUserId", "createdAt");

CREATE INDEX "WorkflowRunEvent_workflowRunStepId_createdAt_idx"
ON "WorkflowRunEvent"("workflowRunStepId", "createdAt");

CREATE INDEX "WorkflowRunEvent_eventType_createdAt_idx"
ON "WorkflowRunEvent"("eventType", "createdAt");

ALTER TABLE "WorkflowRunEvent"
  ADD CONSTRAINT "WorkflowRunEvent_workflowRunId_fkey"
  FOREIGN KEY ("workflowRunId") REFERENCES "WorkflowRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WorkflowRunEvent"
  ADD CONSTRAINT "WorkflowRunEvent_workflowRunStepId_fkey"
  FOREIGN KEY ("workflowRunStepId") REFERENCES "WorkflowRunStep"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "WorkflowRunEvent"
  ADD CONSTRAINT "WorkflowRunEvent_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
