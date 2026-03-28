ALTER TABLE "WorkflowRunStep"
  ADD COLUMN "timerTargetAt" TIMESTAMP(3),
  ADD COLUMN "pausedRemainingSeconds" INTEGER;

ALTER TABLE "WorkflowRunStep"
  ADD CONSTRAINT "WorkflowRunStep_pausedRemainingSeconds_check"
  CHECK ("pausedRemainingSeconds" IS NULL OR "pausedRemainingSeconds" >= 0);

CREATE INDEX "WorkflowRunStep_timerTargetAt_idx"
ON "WorkflowRunStep"("timerTargetAt");
