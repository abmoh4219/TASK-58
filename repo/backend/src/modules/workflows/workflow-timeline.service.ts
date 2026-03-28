import { prisma } from '../../lib/prisma';
import { AuthError } from '../auth/auth.service';

type MaterializeWorkflowInput = {
  recipeId: string;
  version?: number;
};

type TimelineNode = {
  type: 'STEP' | 'WAIT';
  label: string;
  startsAtSeconds: number;
  durationSeconds: number;
  endsAtSeconds: number;
  cue?: {
    text?: string;
    targetTempC?: number;
    heatLevel?: string;
  };
  blocking?: boolean;
};

type TimelineBranch = {
  branchIndex: number;
  stepId: string;
  title: string;
  positionInPhase: number;
  isBlocking: boolean;
  totalDurationSeconds: number;
  blockingDurationSeconds: number;
  nodes: TimelineNode[];
};

type TimelineSegment = {
  segmentIndex: number;
  type: 'PHASE';
  phaseNumber: number;
  startsAtSeconds: number;
  durationSeconds: number;
  endsAtSeconds: number;
  branches: TimelineBranch[];
};

function parseOptionalVersion(raw: string | undefined): number | undefined {
  if (!raw) {
    return undefined;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new AuthError('version must be a positive integer', 400);
  }

  return parsed;
}

function ensureNonNegative(value: number | null | undefined): number {
  if (value === null || value === undefined) {
    return 0;
  }

  if (!Number.isInteger(value) || value < 0) {
    throw new AuthError('Recipe step duration values must be non-negative integers', 409);
  }

  return value;
}

function normalizeCue(step: {
  cueText: string | null;
  targetTempC: number | null;
  heatLevel: string | null;
}) {
  const cue = {
    text: step.cueText ?? undefined,
    targetTempC: step.targetTempC ?? undefined,
    heatLevel: step.heatLevel ?? undefined
  };

  if (!cue.text && cue.targetTempC === undefined && !cue.heatLevel) {
    return undefined;
  }

  return cue;
}

export async function materializeWorkflowFromRecipe(input: MaterializeWorkflowInput) {
  const recipe = await prisma.recipe.findUnique({
    where: {
      id: input.recipeId
    },
    select: {
      id: true,
      code: true,
      name: true,
      version: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      steps: {
        orderBy: [{ phaseNumber: 'asc' }, { positionInPhase: 'asc' }],
        select: {
          id: true,
          phaseNumber: true,
          positionInPhase: true,
          title: true,
          durationSeconds: true,
          waitSeconds: true,
          isBlocking: true,
          cueText: true,
          targetTempC: true,
          heatLevel: true
        }
      }
    }
  });

  if (!recipe) {
    throw new AuthError('Recipe not found', 404);
  }

  if (input.version !== undefined && input.version !== recipe.version) {
    throw new AuthError(
      `Recipe version mismatch. Requested ${input.version}, available ${recipe.version}`,
      409
    );
  }

  if (recipe.steps.length === 0) {
    return {
      recipe: {
        id: recipe.id,
        code: recipe.code,
        name: recipe.name,
        version: recipe.version,
        status: recipe.status,
        createdAt: recipe.createdAt,
        updatedAt: recipe.updatedAt
      },
      timeline: {
        model: 'unified_timeline_v1',
        units: 'seconds',
        totalDurationSeconds: 0,
        segments: [] as TimelineSegment[]
      }
    };
  }

  const phaseMap = new Map<number, typeof recipe.steps>();
  for (const step of recipe.steps) {
    if (!phaseMap.has(step.phaseNumber)) {
      phaseMap.set(step.phaseNumber, []);
    }
    phaseMap.get(step.phaseNumber)?.push(step);
  }

  const phaseNumbers = [...phaseMap.keys()].sort((a, b) => a - b);

  const segments: TimelineSegment[] = [];
  let cursorSeconds = 0;

  for (let phaseIdx = 0; phaseIdx < phaseNumbers.length; phaseIdx += 1) {
    const phaseNumber = phaseNumbers[phaseIdx];
    const phaseSteps = phaseMap.get(phaseNumber) ?? [];

    const branches: TimelineBranch[] = phaseSteps.map((step, branchIndex) => {
      const stepDuration = ensureNonNegative(step.durationSeconds);
      const waitDuration = ensureNonNegative(step.waitSeconds);
      const cue = normalizeCue(step);

      const nodes: TimelineNode[] = [
        {
          type: 'STEP',
          label: step.title,
          startsAtSeconds: 0,
          durationSeconds: stepDuration,
          endsAtSeconds: stepDuration,
          cue,
          blocking: true
        }
      ];

      if (waitDuration > 0) {
        nodes.push({
          type: 'WAIT',
          label: `${step.title} wait`,
          startsAtSeconds: stepDuration,
          durationSeconds: waitDuration,
          endsAtSeconds: stepDuration + waitDuration,
          cue,
          blocking: step.isBlocking
        });
      }

      const totalDurationSeconds = stepDuration + waitDuration;
      const blockingDurationSeconds = stepDuration + (step.isBlocking ? waitDuration : 0);

      return {
        branchIndex,
        stepId: step.id,
        title: step.title,
        positionInPhase: step.positionInPhase,
        isBlocking: step.isBlocking,
        totalDurationSeconds,
        blockingDurationSeconds,
        nodes
      };
    });

    const phaseDuration = branches.reduce(
      (max, branch) => Math.max(max, branch.blockingDurationSeconds),
      0
    );

    const startsAtSeconds = cursorSeconds;
    const endsAtSeconds = startsAtSeconds + phaseDuration;

    segments.push({
      segmentIndex: phaseIdx,
      type: 'PHASE',
      phaseNumber,
      startsAtSeconds,
      durationSeconds: phaseDuration,
      endsAtSeconds,
      branches
    });

    cursorSeconds = endsAtSeconds;
  }

  return {
    recipe: {
      id: recipe.id,
      code: recipe.code,
      name: recipe.name,
      version: recipe.version,
      status: recipe.status,
      createdAt: recipe.createdAt,
      updatedAt: recipe.updatedAt
    },
    timeline: {
      model: 'unified_timeline_v1',
      units: 'seconds',
      phaseExecutionRule:
        'Phases execute sequentially; steps inside a phase execute in parallel branches; wait nodes can be non-blocking when step.isBlocking=false.',
      totalDurationSeconds: cursorSeconds,
      segments
    }
  };
}

export function parseWorkflowVersionParam(raw: string | undefined): number | undefined {
  return parseOptionalVersion(raw);
}
