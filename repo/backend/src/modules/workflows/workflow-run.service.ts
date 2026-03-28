import {
  Prisma,
  WorkflowRunEventType,
  WorkflowRunStatus,
  WorkflowRunStepStatus
} from '../../../prisma/generated';
import { prisma } from '../../lib/prisma';
import { AuthError } from '../auth/auth.service';

type CreateRunInput = {
  actorUserId: string;
  actorRoles: string[];
  recipeId: string;
  bookingId?: string;
  contextJson?: Prisma.InputJsonValue;
};

type RunActionInput = {
  runId: string;
  actorUserId: string;
  actorRoles: string[];
};

type StepActionInput = RunActionInput & {
  runStepId: string;
};

type RollbackStepInput = StepActionInput & {
  reason?: string;
};

type WorkflowEventQueryInput = {
  actorUserId: string;
  actorRoles: string[];
  runId?: string;
  userId?: string;
  stepId?: string;
  eventTypes?: WorkflowRunEventType[];
  from?: string;
  to?: string;
  limit?: number;
};

function isAdmin(roles: string[]): boolean {
  return roles.includes('ADMIN');
}

function toPositiveIntOrZero(value: number | null | undefined): number {
  if (!value) {
    return 0;
  }

  if (!Number.isInteger(value) || value < 0) {
    throw new AuthError('Invalid workflow step timing values', 409);
  }

  return value;
}

function isTerminalStep(status: WorkflowRunStepStatus): boolean {
  return (
    status === WorkflowRunStepStatus.COMPLETED ||
    status === WorkflowRunStepStatus.SKIPPED ||
    status === WorkflowRunStepStatus.CANCELED ||
    status === WorkflowRunStepStatus.FAILED
  );
}

function runIsActive(status: WorkflowRunStatus): boolean {
  return status === WorkflowRunStatus.RUNNING || status === WorkflowRunStatus.PAUSED;
}

function ensureRunAccess(run: { operatorUserId: string | null }, actorUserId: string, actorRoles: string[]): void {
  const allowed = run.operatorUserId === actorUserId || isAdmin(actorRoles);
  if (!allowed) {
    throw new AuthError('Not allowed to operate this workflow run', 403);
  }
}

function stepOrderValue(step: { phaseNumber: number; positionInPhase: number }): number {
  return step.phaseNumber * 10_000 + step.positionInPhase;
}

async function appendWorkflowRunEvent(
  tx: Prisma.TransactionClient,
  input: {
    runId: string;
    runStepId?: string;
    actorUserId?: string;
    eventType: WorkflowRunEventType;
    eventData?: Prisma.InputJsonValue;
  }
): Promise<void> {
  await tx.workflowRunEvent.create({
    data: {
      workflowRunId: input.runId,
      workflowRunStepId: input.runStepId,
      actorUserId: input.actorUserId,
      eventType: input.eventType,
      eventData: input.eventData
    }
  });
}

async function activatePhase(
  tx: Prisma.TransactionClient,
  runId: string,
  phaseNumber: number,
  now: Date
): Promise<void> {
  const phaseSteps = await tx.workflowRunStep.findMany({
    where: {
      workflowRunId: runId,
      phaseNumber,
      status: WorkflowRunStepStatus.PENDING
    },
    orderBy: {
      positionInPhase: 'asc'
    },
    select: {
      id: true,
      durationSeconds: true,
      waitSeconds: true
    }
  });

  for (const step of phaseSteps) {
    const duration = toPositiveIntOrZero(step.durationSeconds);
    const wait = toPositiveIntOrZero(step.waitSeconds);
    const total = duration + wait;

    if (total <= 0) {
      await tx.workflowRunStep.update({
        where: {
          id: step.id
        },
        data: {
          status: WorkflowRunStepStatus.COMPLETED,
          readyAt: now,
          startedAt: now,
          completedAt: now,
          timerTargetAt: null,
          pausedRemainingSeconds: null
        }
      });

      await appendWorkflowRunEvent(tx, {
        runId,
        runStepId: step.id,
        eventType: WorkflowRunEventType.STEP_COMPLETED,
        eventData: {
          source: 'instant'
        }
      });
    } else {
      const timerTargetAt = new Date(now.getTime() + total * 1000);

      await tx.workflowRunStep.update({
        where: {
          id: step.id
        },
        data: {
          status: WorkflowRunStepStatus.RUNNING,
          readyAt: now,
          startedAt: now,
          timerTargetAt,
          pausedRemainingSeconds: null
        }
      });
    }
  }

  await tx.workflowRun.update({
    where: {
      id: runId
    },
    data: {
      currentPhaseNumber: phaseNumber,
      status: WorkflowRunStatus.RUNNING,
      startedAt: now
    }
  });
}

async function advanceRunState(tx: Prisma.TransactionClient, runId: string, now: Date): Promise<void> {
  const run = await tx.workflowRun.findUnique({
    where: {
      id: runId
    },
    select: {
      id: true,
      status: true
    }
  });

  if (!run) {
    throw new AuthError('Workflow run not found', 404);
  }

  if (run.status !== WorkflowRunStatus.RUNNING) {
    return;
  }

  const runningSteps = await tx.workflowRunStep.findMany({
    where: {
      workflowRunId: runId,
      status: WorkflowRunStepStatus.RUNNING,
      timerTargetAt: {
        lte: now
      }
    },
    select: {
      id: true
    }
  });

  for (const step of runningSteps) {
    await tx.workflowRunStep.update({
      where: { id: step.id },
      data: {
        status: WorkflowRunStepStatus.COMPLETED,
        completedAt: now,
        timerTargetAt: null,
        pausedRemainingSeconds: null
      }
    });

    await appendWorkflowRunEvent(tx, {
      runId,
      runStepId: step.id,
      eventType: WorkflowRunEventType.STEP_COMPLETED,
      eventData: {
        source: 'timer'
      }
    });
  }

  const allSteps = await tx.workflowRunStep.findMany({
    where: {
      workflowRunId: runId
    },
    select: {
      id: true,
      phaseNumber: true,
      status: true
    }
  });

  const hasOpenRunning = allSteps.some((step) => step.status === WorkflowRunStepStatus.RUNNING);
  if (hasOpenRunning) {
    return;
  }

  const pendingByPhase = allSteps
    .filter((step) => step.status === WorkflowRunStepStatus.PENDING)
    .sort((a, b) => a.phaseNumber - b.phaseNumber);

  if (pendingByPhase.length === 0) {
    await tx.workflowRun.update({
      where: { id: runId },
      data: {
        status: WorkflowRunStatus.COMPLETED,
        completedAt: now
      }
    });
    return;
  }

  const nextPhase = pendingByPhase[0].phaseNumber;
  await activatePhase(tx, runId, nextPhase, now);
}

export async function createWorkflowRun(input: CreateRunInput) {
  const recipe = await prisma.recipe.findUnique({
    where: {
      id: input.recipeId
    },
    select: {
      id: true,
      version: true,
      steps: {
        orderBy: [{ phaseNumber: 'asc' }, { positionInPhase: 'asc' }],
        select: {
          id: true,
          phaseNumber: true,
          positionInPhase: true,
          title: true,
          durationSeconds: true,
          waitSeconds: true
        }
      }
    }
  });

  if (!recipe) {
    throw new AuthError('Recipe not found', 404);
  }

  if (recipe.steps.length === 0) {
    throw new AuthError('Recipe has no steps to execute', 409);
  }

  const runId = await prisma.$transaction(async (tx) => {
    const now = new Date();

    const run = await tx.workflowRun.create({
      data: {
        recipeId: recipe.id,
        bookingId: input.bookingId,
        operatorUserId: input.actorUserId,
        status: WorkflowRunStatus.RUNNING,
        recipeVersionSnapshot: recipe.version,
        contextJson: input.contextJson ?? undefined,
        startedAt: now
      },
      select: {
        id: true,
        recipeId: true,
        bookingId: true,
        operatorUserId: true,
        status: true,
        currentPhaseNumber: true,
        recipeVersionSnapshot: true,
        startedAt: true,
        createdAt: true
      }
    });

    for (const step of recipe.steps) {
      await tx.workflowRunStep.create({
        data: {
          workflowRunId: run.id,
          recipeStepId: step.id,
          phaseNumber: step.phaseNumber,
          positionInPhase: step.positionInPhase,
          titleSnapshot: step.title,
          durationSeconds: step.durationSeconds,
          waitSeconds: step.waitSeconds,
          status: WorkflowRunStepStatus.PENDING
        }
      });
    }

    const firstPhase = recipe.steps[0].phaseNumber;
    await activatePhase(tx, run.id, firstPhase, now);
    await advanceRunState(tx, run.id, now);

    return run.id;
  });

  return getWorkflowRunState(runId, input.actorUserId, input.actorRoles);
}

export async function pauseWorkflowRun(input: RunActionInput) {
  const runId = await prisma.$transaction(async (tx) => {
    const run = await tx.workflowRun.findUnique({
      where: { id: input.runId },
      select: {
        id: true,
        status: true,
        operatorUserId: true
      }
    });

    if (!run) {
      throw new AuthError('Workflow run not found', 404);
    }

    ensureRunAccess(run, input.actorUserId, input.actorRoles);

    if (run.status !== WorkflowRunStatus.RUNNING) {
      throw new AuthError('Only RUNNING workflow runs can be paused', 409);
    }

    const now = new Date();
    const runningSteps = await tx.workflowRunStep.findMany({
      where: {
        workflowRunId: run.id,
        status: WorkflowRunStepStatus.RUNNING
      },
      select: {
        id: true,
        timerTargetAt: true
      }
    });

    for (const step of runningSteps) {
      const remainingSeconds = step.timerTargetAt
        ? Math.max(0, Math.ceil((step.timerTargetAt.getTime() - now.getTime()) / 1000))
        : 0;

      await tx.workflowRunStep.update({
        where: {
          id: step.id
        },
        data: {
          status: WorkflowRunStepStatus.READY,
          pausedRemainingSeconds: remainingSeconds,
          timerTargetAt: null
        }
      });
    }

    await tx.workflowRun.update({
      where: {
        id: run.id
      },
      data: {
        status: WorkflowRunStatus.PAUSED
      }
    });

    return run.id;
  });

  return getWorkflowRunState(runId, input.actorUserId, input.actorRoles);
}

export async function resumeWorkflowRun(input: RunActionInput) {
  const runId = await prisma.$transaction(async (tx) => {
    const run = await tx.workflowRun.findUnique({
      where: { id: input.runId },
      select: {
        id: true,
        status: true,
        operatorUserId: true
      }
    });

    if (!run) {
      throw new AuthError('Workflow run not found', 404);
    }

    ensureRunAccess(run, input.actorUserId, input.actorRoles);

    if (run.status !== WorkflowRunStatus.PAUSED) {
      throw new AuthError('Only PAUSED workflow runs can be resumed', 409);
    }

    const now = new Date();
    const readySteps = await tx.workflowRunStep.findMany({
      where: {
        workflowRunId: run.id,
        status: WorkflowRunStepStatus.READY
      },
      select: {
        id: true,
        pausedRemainingSeconds: true,
        startedAt: true
      }
    });

    for (const step of readySteps) {
      const remaining = step.pausedRemainingSeconds ?? 0;
      const timerTargetAt = new Date(now.getTime() + remaining * 1000);

      await tx.workflowRunStep.update({
        where: {
          id: step.id
        },
        data: {
          status: remaining > 0 ? WorkflowRunStepStatus.RUNNING : WorkflowRunStepStatus.COMPLETED,
          startedAt: step.startedAt ?? now,
          completedAt: remaining > 0 ? null : now,
          timerTargetAt: remaining > 0 ? timerTargetAt : null,
          pausedRemainingSeconds: null
        }
      });

      if (remaining <= 0) {
        await appendWorkflowRunEvent(tx, {
          runId: run.id,
          runStepId: step.id,
          actorUserId: input.actorUserId,
          eventType: WorkflowRunEventType.STEP_COMPLETED,
          eventData: {
            source: 'resume_elapsed'
          }
        });
      }
    }

    await tx.workflowRun.update({
      where: {
        id: run.id
      },
      data: {
        status: WorkflowRunStatus.RUNNING
      }
    });

    await advanceRunState(tx, run.id, now);

    return run.id;
  });

  return getWorkflowRunState(runId, input.actorUserId, input.actorRoles);
}

export async function completeWorkflowStep(input: StepActionInput) {
  const runId = await prisma.$transaction(async (tx) => {
    const run = await tx.workflowRun.findUnique({
      where: { id: input.runId },
      select: {
        id: true,
        status: true,
        operatorUserId: true
      }
    });

    if (!run) {
      throw new AuthError('Workflow run not found', 404);
    }

    ensureRunAccess(run, input.actorUserId, input.actorRoles);

    if (!runIsActive(run.status)) {
      throw new AuthError('Workflow run is not active', 409);
    }

    const step = await tx.workflowRunStep.findFirst({
      where: {
        id: input.runStepId,
        workflowRunId: run.id
      },
      select: {
        id: true,
        status: true,
        startedAt: true
      }
    });

    if (!step) {
      throw new AuthError('Workflow step not found', 404);
    }

    if (isTerminalStep(step.status)) {
      return run.id;
    }

    const now = new Date();

    await tx.workflowRunStep.update({
      where: {
        id: step.id
      },
      data: {
        status: WorkflowRunStepStatus.COMPLETED,
        startedAt: step.startedAt ?? now,
        completedAt: now,
        timerTargetAt: null,
        pausedRemainingSeconds: null
      }
    });

    await appendWorkflowRunEvent(tx, {
      runId: run.id,
      runStepId: step.id,
      actorUserId: input.actorUserId,
      eventType: WorkflowRunEventType.STEP_COMPLETED,
      eventData: {
        source: 'manual'
      }
    });

    await advanceRunState(tx, run.id, now);
    return run.id;
  });

  return getWorkflowRunState(runId, input.actorUserId, input.actorRoles);
}

export async function skipWorkflowStep(input: StepActionInput) {
  const runId = await prisma.$transaction(async (tx) => {
    const run = await tx.workflowRun.findUnique({
      where: { id: input.runId },
      select: {
        id: true,
        status: true,
        operatorUserId: true
      }
    });

    if (!run) {
      throw new AuthError('Workflow run not found', 404);
    }

    ensureRunAccess(run, input.actorUserId, input.actorRoles);

    if (!runIsActive(run.status)) {
      throw new AuthError('Workflow run is not active', 409);
    }

    const step = await tx.workflowRunStep.findFirst({
      where: {
        id: input.runStepId,
        workflowRunId: run.id
      },
      select: {
        id: true,
        status: true
      }
    });

    if (!step) {
      throw new AuthError('Workflow step not found', 404);
    }

    if (isTerminalStep(step.status)) {
      return run.id;
    }

    const now = new Date();

    await tx.workflowRunStep.update({
      where: {
        id: step.id
      },
      data: {
        status: WorkflowRunStepStatus.SKIPPED,
        completedAt: now,
        timerTargetAt: null,
        pausedRemainingSeconds: null
      }
    });

    await appendWorkflowRunEvent(tx, {
      runId: run.id,
      runStepId: step.id,
      actorUserId: input.actorUserId,
      eventType: WorkflowRunEventType.STEP_SKIPPED,
      eventData: {
        source: 'manual'
      }
    });

    await advanceRunState(tx, run.id, now);
    return run.id;
  });

  return getWorkflowRunState(runId, input.actorUserId, input.actorRoles);
}

export async function rollbackWorkflowStep(input: RollbackStepInput) {
  const runId = await prisma.$transaction(async (tx) => {
    const run = await tx.workflowRun.findUnique({
      where: { id: input.runId },
      select: {
        id: true,
        status: true,
        operatorUserId: true
      }
    });

    if (!run) {
      throw new AuthError('Workflow run not found', 404);
    }

    ensureRunAccess(run, input.actorUserId, input.actorRoles);

    if (
      run.status !== WorkflowRunStatus.RUNNING &&
      run.status !== WorkflowRunStatus.PAUSED &&
      run.status !== WorkflowRunStatus.COMPLETED
    ) {
      throw new AuthError('Rollback is only allowed for running, paused, or completed runs', 409);
    }

    const targetStep = await tx.workflowRunStep.findFirst({
      where: {
        id: input.runStepId,
        workflowRunId: run.id
      },
      select: {
        id: true,
        phaseNumber: true,
        positionInPhase: true,
        durationSeconds: true,
        waitSeconds: true,
        status: true
      }
    });

    if (!targetStep) {
      throw new AuthError('Workflow step not found', 404);
    }

    if (targetStep.status !== WorkflowRunStepStatus.COMPLETED) {
      throw new AuthError('Rollback target must be a previously completed step', 409);
    }

    const allSteps = await tx.workflowRunStep.findMany({
      where: {
        workflowRunId: run.id
      },
      select: {
        id: true,
        phaseNumber: true,
        positionInPhase: true,
        status: true
      }
    });

    const targetOrder = stepOrderValue(targetStep);
    const supersededSteps = allSteps.filter((step) => {
      const order = stepOrderValue(step);
      if (order <= targetOrder) {
        return false;
      }

      return (
        step.status === WorkflowRunStepStatus.COMPLETED ||
        step.status === WorkflowRunStepStatus.SKIPPED ||
        step.status === WorkflowRunStepStatus.RUNNING ||
        step.status === WorkflowRunStepStatus.READY
      );
    });

    for (const step of supersededSteps) {
      await tx.workflowRunStep.update({
        where: {
          id: step.id
        },
        data: {
          status: WorkflowRunStepStatus.PENDING,
          readyAt: null,
          startedAt: null,
          completedAt: null,
          timerTargetAt: null,
          pausedRemainingSeconds: null
        }
      });
    }

    const now = new Date();
    const duration = toPositiveIntOrZero(targetStep.durationSeconds);
    const wait = toPositiveIntOrZero(targetStep.waitSeconds);
    const total = duration + wait;

    await tx.workflowRunStep.update({
      where: {
        id: targetStep.id
      },
      data: {
        status: total > 0 ? WorkflowRunStepStatus.RUNNING : WorkflowRunStepStatus.COMPLETED,
        readyAt: now,
        startedAt: now,
        completedAt: total > 0 ? null : now,
        timerTargetAt: total > 0 ? new Date(now.getTime() + total * 1000) : null,
        pausedRemainingSeconds: null
      }
    });

    await tx.workflowRun.update({
      where: {
        id: run.id
      },
      data: {
        status: WorkflowRunStatus.RUNNING,
        currentPhaseNumber: targetStep.phaseNumber,
        completedAt: null
      }
    });

    await appendWorkflowRunEvent(tx, {
      runId: run.id,
      runStepId: targetStep.id,
      actorUserId: input.actorUserId,
      eventType: WorkflowRunEventType.STEP_ROLLBACK,
      eventData: {
        reason: input.reason?.trim() || null,
        supersededStepIds: supersededSteps.map((step) => step.id),
        supersededCount: supersededSteps.length
      }
    });

    await advanceRunState(tx, run.id, now);

    return run.id;
  });

  return getWorkflowRunState(runId, input.actorUserId, input.actorRoles);
}

export async function tickWorkflowRun(input: RunActionInput) {
  const runId = await prisma.$transaction(async (tx) => {
    const run = await tx.workflowRun.findUnique({
      where: {
        id: input.runId
      },
      select: {
        id: true,
        status: true,
        operatorUserId: true
      }
    });

    if (!run) {
      throw new AuthError('Workflow run not found', 404);
    }

    ensureRunAccess(run, input.actorUserId, input.actorRoles);

    if (run.status !== WorkflowRunStatus.RUNNING) {
      return run.id;
    }

    await advanceRunState(tx, run.id, new Date());

    return run.id;
  });

  return getWorkflowRunState(runId, input.actorUserId, input.actorRoles);
}

function parseDateOrUndefined(raw: string | undefined, name: string): Date | undefined {
  if (!raw) {
    return undefined;
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new AuthError(`${name} must be an ISO datetime string`, 400);
  }

  return parsed;
}

function parseLimit(raw: number | undefined): number {
  if (!raw) {
    return 100;
  }

  if (!Number.isInteger(raw) || raw <= 0) {
    throw new AuthError('limit must be a positive integer', 400);
  }

  return Math.min(raw, 500);
}

export async function getWorkflowRunEvents(input: WorkflowEventQueryInput) {
  const from = parseDateOrUndefined(input.from, 'from');
  const to = parseDateOrUndefined(input.to, 'to');
  const limit = parseLimit(input.limit);

  if (from && to && to < from) {
    throw new AuthError('to must be after from', 400);
  }

  const targetUserId = input.userId ?? input.actorUserId;
  if (targetUserId !== input.actorUserId && !isAdmin(input.actorRoles)) {
    throw new AuthError('Not allowed to query events for another user', 403);
  }

  const where: Prisma.WorkflowRunEventWhereInput = {
    ...(input.runId ? { workflowRunId: input.runId } : {}),
    ...(input.stepId ? { workflowRunStepId: input.stepId } : {}),
    ...(input.eventTypes && input.eventTypes.length > 0
      ? {
          eventType: {
            in: input.eventTypes
          }
        }
      : {}),
    createdAt: {
      ...(from ? { gte: from } : {}),
      ...(to ? { lte: to } : {})
    },
    workflowRun: isAdmin(input.actorRoles)
      ? {
          ...(input.userId
            ? {
                operatorUserId: targetUserId
              }
            : {})
        }
      : {
          operatorUserId: input.actorUserId
        }
  };

  const events = await prisma.workflowRunEvent.findMany({
    where,
    orderBy: {
      createdAt: 'desc'
    },
    take: limit,
    select: {
      id: true,
      workflowRunId: true,
      workflowRunStepId: true,
      actorUserId: true,
      eventType: true,
      eventData: true,
      createdAt: true
    }
  });

  return {
    filters: {
      runId: input.runId ?? null,
      userId: targetUserId,
      stepId: input.stepId ?? null,
      eventTypes: input.eventTypes ?? null,
      from: from ?? null,
      to: to ?? null,
      limit
    },
    events
  };
}

export async function getWorkflowRunState(runId: string, actorUserId: string, actorRoles: string[]) {
  const run = await prisma.workflowRun.findUnique({
    where: {
      id: runId
    },
    select: {
      id: true,
      recipeId: true,
      bookingId: true,
      operatorUserId: true,
      status: true,
      startedAt: true,
      completedAt: true,
      scheduledStartAt: true,
      currentPhaseNumber: true,
      recipeVersionSnapshot: true,
      createdAt: true,
      updatedAt: true,
      steps: {
        orderBy: [{ phaseNumber: 'asc' }, { positionInPhase: 'asc' }],
        select: {
          id: true,
          recipeStepId: true,
          phaseNumber: true,
          positionInPhase: true,
          titleSnapshot: true,
          durationSeconds: true,
          waitSeconds: true,
          status: true,
          readyAt: true,
          timerTargetAt: true,
          pausedRemainingSeconds: true,
          startedAt: true,
          completedAt: true,
          createdAt: true,
          updatedAt: true
        }
      }
    }
  });

  if (!run) {
    throw new AuthError('Workflow run not found', 404);
  }

  ensureRunAccess(run, actorUserId, actorRoles);

  const nextTimerAt = run.steps
    .filter((step) => step.status === WorkflowRunStepStatus.RUNNING && step.timerTargetAt)
    .map((step) => step.timerTargetAt as Date)
    .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;

  const completedCount = run.steps.filter(
    (step) => step.status === WorkflowRunStepStatus.COMPLETED
  ).length;
  const skippedCount = run.steps.filter((step) => step.status === WorkflowRunStepStatus.SKIPPED).length;

  return {
    run,
    progress: {
      totalSteps: run.steps.length,
      completedSteps: completedCount,
      skippedSteps: skippedCount,
      terminalSteps: completedCount + skippedCount,
      nextTimerAt
    }
  };
}

export async function getActiveWorkflowRuns(actorUserId: string, actorRoles: string[]) {
  const where: Prisma.WorkflowRunWhereInput = isAdmin(actorRoles)
    ? {
        status: {
          in: [WorkflowRunStatus.RUNNING, WorkflowRunStatus.PAUSED]
        }
      }
    : {
        operatorUserId: actorUserId,
        status: {
          in: [WorkflowRunStatus.RUNNING, WorkflowRunStatus.PAUSED]
        }
      };

  return prisma.workflowRun.findMany({
    where,
    orderBy: [{ updatedAt: 'desc' }],
    select: {
      id: true,
      recipeId: true,
      bookingId: true,
      operatorUserId: true,
      status: true,
      currentPhaseNumber: true,
      startedAt: true,
      completedAt: true,
      createdAt: true,
      updatedAt: true
    }
  });
}
