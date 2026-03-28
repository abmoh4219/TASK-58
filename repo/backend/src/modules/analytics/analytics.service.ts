import { prisma } from '../../lib/prisma';
import { AuthError } from '../auth/auth.service';
import { RecipeDifficulty, WorkflowRunEventType, WorkflowRunStatus } from '../../../prisma/generated';

type ViewEventInput = {
  recipeId: string;
  actorUserId?: string;
  sessionId?: string;
  viewedAt?: string;
};

type DateRangeInput = {
  from?: string;
  to?: string;
  limit?: number;
};

type WorkflowDateRangeInput = DateRangeInput & {
  userId?: string;
};

function parseDate(raw: string | undefined, name: string): Date | undefined {
  if (!raw) {
    return undefined;
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new AuthError(`${name} must be a valid ISO datetime`, 400);
  }

  return parsed;
}

function parseLimit(raw: number | undefined, fallback: number): number {
  if (raw === undefined) {
    return fallback;
  }

  if (!Number.isInteger(raw) || raw <= 0) {
    throw new AuthError('limit must be a positive integer', 400);
  }

  return Math.min(raw, 200);
}

function utcDayKey(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function utcWeekStart(date: Date): Date {
  const value = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = value.getUTCDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  value.setUTCDate(value.getUTCDate() + diffToMonday);
  return value;
}

function utcWeekKey(date: Date): string {
  return utcDayKey(utcWeekStart(date));
}

function addUtcWeeks(date: Date, weeks: number): Date {
  const value = new Date(date);
  value.setUTCDate(value.getUTCDate() + weeks * 7);
  return value;
}

function difficultyScore(difficulty: RecipeDifficulty): number {
  if (difficulty === RecipeDifficulty.EASY) {
    return 1;
  }
  if (difficulty === RecipeDifficulty.MEDIUM) {
    return 2;
  }
  if (difficulty === RecipeDifficulty.HARD) {
    return 3;
  }
  return 4;
}

function resolvePrimaryDifficulty(counts: Record<RecipeDifficulty, number>): RecipeDifficulty | null {
  const entries = Object.entries(counts) as Array<[RecipeDifficulty, number]>;
  const sorted = entries.sort((a, b) => b[1] - a[1]);
  if (sorted[0][1] <= 0) {
    return null;
  }

  return sorted[0][0];
}

function resolveRange(input: DateRangeInput): { from: Date; to: Date } {
  // Timezone policy:
  // All analytics date-range filtering uses UTC instants for `from` and `to`.
  // Daily drill-down buckets are also computed in UTC calendar days.
  const to = parseDate(input.to, 'to') ?? new Date();
  const from =
    parseDate(input.from, 'from') ?? new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);

  if (to <= from) {
    throw new AuthError('to must be after from', 400);
  }

  return { from, to };
}

export async function trackRecipeView(input: ViewEventInput) {
  const viewedAt = parseDate(input.viewedAt, 'viewedAt') ?? new Date();

  const recipe = await prisma.recipe.findUnique({
    where: {
      id: input.recipeId
    },
    select: {
      id: true
    }
  });

  if (!recipe) {
    throw new AuthError('Recipe not found', 404);
  }

  return prisma.recipeViewEvent.create({
    data: {
      recipeId: input.recipeId,
      userId: input.actorUserId ?? null,
      sessionId: input.sessionId ?? null,
      viewedAt
    },
    select: {
      id: true,
      recipeId: true,
      userId: true,
      sessionId: true,
      viewedAt: true,
      createdAt: true
    }
  });
}

export async function getRecipeViewVolume(input: DateRangeInput) {
  const { from, to } = resolveRange(input);
  const topLimit = parseLimit(input.limit, 20);

  const events = await prisma.recipeViewEvent.findMany({
    where: {
      viewedAt: {
        gte: from,
        lt: to
      }
    },
    select: {
      recipeId: true,
      userId: true,
      sessionId: true,
      viewedAt: true,
      recipe: {
        select: {
          code: true,
          name: true,
          cuisineTags: true
        }
      }
    }
  });

  const dailyTotal = new Map<string, number>();
  const byRecipe = new Map<
    string,
    {
      recipeId: string;
      recipeCode: string;
      recipeName: string;
      cuisineTags: string[];
      views: number;
      uniqueUsers: Set<string>;
      uniqueSessions: Set<string>;
      dailyViews: Map<string, number>;
    }
  >();

  for (const event of events) {
    const dayKey = utcDayKey(event.viewedAt);
    dailyTotal.set(dayKey, (dailyTotal.get(dayKey) ?? 0) + 1);

    if (!byRecipe.has(event.recipeId)) {
      byRecipe.set(event.recipeId, {
        recipeId: event.recipeId,
        recipeCode: event.recipe.code,
        recipeName: event.recipe.name,
        cuisineTags: event.recipe.cuisineTags,
        views: 0,
        uniqueUsers: new Set<string>(),
        uniqueSessions: new Set<string>(),
        dailyViews: new Map<string, number>()
      });
    }

    const row = byRecipe.get(event.recipeId)!;
    row.views += 1;
    if (event.userId) {
      row.uniqueUsers.add(event.userId);
    }
    if (event.sessionId) {
      row.uniqueSessions.add(event.sessionId);
    }
    row.dailyViews.set(dayKey, (row.dailyViews.get(dayKey) ?? 0) + 1);
  }

  const topRecipes = [...byRecipe.values()]
    .sort((a, b) => b.views - a.views)
    .slice(0, topLimit)
    .map((row) => ({
      recipeId: row.recipeId,
      recipeCode: row.recipeCode,
      recipeName: row.recipeName,
      cuisineTags: row.cuisineTags,
      views: row.views,
      uniqueUsers: row.uniqueUsers.size,
      uniqueSessions: row.uniqueSessions.size,
      dailyViews: [...row.dailyViews.entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([day, count]) => ({ day, views: count }))
    }));

  const dailyDrilldown = [...dailyTotal.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([day, count]) => ({ day, views: count }));

  return {
    timezone: 'UTC',
    range: {
      from,
      to
    },
    totals: {
      views: events.length,
      uniqueRecipes: byRecipe.size
    },
    topRecipes,
    dailyDrilldown
  };
}

export async function getCuisineInterestDistribution(input: DateRangeInput) {
  const { from, to } = resolveRange(input);

  const events = await prisma.recipeViewEvent.findMany({
    where: {
      viewedAt: {
        gte: from,
        lt: to
      }
    },
    select: {
      viewedAt: true,
      recipe: {
        select: {
          cuisineTags: true
        }
      }
    }
  });

  // Dimension definition:
  // Distribution is view-weighted across cuisine tags.
  // A single view contributes 1.0 total weight split equally across the recipe's tags.
  // Recipes with no tags contribute to `uncategorized`.
  const distribution = new Map<string, number>();
  const daily = new Map<string, Map<string, number>>();

  for (const event of events) {
    const tags = event.recipe.cuisineTags.length > 0 ? event.recipe.cuisineTags : ['uncategorized'];
    const weight = 1 / tags.length;
    const dayKey = utcDayKey(event.viewedAt);

    if (!daily.has(dayKey)) {
      daily.set(dayKey, new Map<string, number>());
    }

    const dailyMap = daily.get(dayKey)!;

    for (const tag of tags) {
      distribution.set(tag, (distribution.get(tag) ?? 0) + weight);
      dailyMap.set(tag, (dailyMap.get(tag) ?? 0) + weight);
    }
  }

  const totalWeight = [...distribution.values()].reduce((sum, value) => sum + value, 0);

  const byCuisine = [...distribution.entries()]
    .map(([tag, weight]) => ({
      cuisineTag: tag,
      weightedViews: Number(weight.toFixed(4)),
      percentage: totalWeight > 0 ? Number(((weight / totalWeight) * 100).toFixed(2)) : 0
    }))
    .sort((a, b) => b.weightedViews - a.weightedViews);

  const dailyDrilldown = [...daily.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([day, map]) => ({
      day,
      cuisines: [...map.entries()]
        .map(([cuisineTag, weightedViews]) => ({
          cuisineTag,
          weightedViews: Number(weightedViews.toFixed(4))
        }))
        .sort((a, b) => b.weightedViews - a.weightedViews)
    }));

  return {
    timezone: 'UTC',
    range: {
      from,
      to
    },
    totals: {
      views: events.length,
      weightedViews: Number(totalWeight.toFixed(4))
    },
    distribution: byCuisine,
    dailyDrilldown
  };
}

export async function getWeeklyConsistencyStreaks(input: WorkflowDateRangeInput) {
  const { from, to } = resolveRange(input);

  // Streak rule definition:
  // A week is considered consistent if there is at least one workflow run with
  // status COMPLETED and completedAt in that UTC calendar week.
  const runs = await prisma.workflowRun.findMany({
    where: {
      status: WorkflowRunStatus.COMPLETED,
      completedAt: {
        gte: from,
        lt: to
      },
      ...(input.userId ? { operatorUserId: input.userId } : {})
    },
    select: {
      completedAt: true
    }
  });

  const activeWeeks = new Set<string>();
  for (const run of runs) {
    if (run.completedAt) {
      activeWeeks.add(utcWeekKey(run.completedAt));
    }
  }

  const rangeStartWeek = utcWeekStart(from);
  const rangeEndWeek = utcWeekStart(new Date(to.getTime() - 1));

  const weekSeries: Array<{ weekStartUtc: string; hasCompletion: boolean }> = [];
  for (let cursor = rangeStartWeek; cursor <= rangeEndWeek; cursor = addUtcWeeks(cursor, 1)) {
    const key = utcDayKey(cursor);
    weekSeries.push({
      weekStartUtc: key,
      hasCompletion: activeWeeks.has(key)
    });
  }

  let longest = 0;
  let running = 0;
  for (const week of weekSeries) {
    if (week.hasCompletion) {
      running += 1;
      longest = Math.max(longest, running);
    } else {
      running = 0;
    }
  }

  let current = 0;
  for (let idx = weekSeries.length - 1; idx >= 0; idx -= 1) {
    if (weekSeries[idx].hasCompletion) {
      current += 1;
    } else {
      break;
    }
  }

  return {
    timezone: 'UTC',
    range: {
      from,
      to
    },
    userId: input.userId ?? null,
    rule: 'At least one COMPLETED workflow run in a UTC calendar week.',
    totals: {
      weeksInRange: weekSeries.length,
      activeWeeks: weekSeries.filter((week) => week.hasCompletion).length,
      currentStreakWeeks: current,
      longestStreakWeeks: longest
    },
    weeklyDrilldown: weekSeries
  };
}

export async function getDifficultyProgression(input: WorkflowDateRangeInput) {
  const { from, to } = resolveRange(input);

  const runs = await prisma.workflowRun.findMany({
    where: {
      status: WorkflowRunStatus.COMPLETED,
      completedAt: {
        gte: from,
        lt: to
      },
      ...(input.userId ? { operatorUserId: input.userId } : {})
    },
    select: {
      completedAt: true,
      recipe: {
        select: {
          id: true,
          code: true,
          name: true,
          difficulty: true
        }
      }
    }
  });

  const daily = new Map<
    string,
    {
      counts: Record<RecipeDifficulty, number>;
      scoreSum: number;
      completedRuns: number;
    }
  >();

  const overallCounts: Record<RecipeDifficulty, number> = {
    EASY: 0,
    MEDIUM: 0,
    HARD: 0,
    EXPERT: 0
  };

  for (const run of runs) {
    if (!run.completedAt) {
      continue;
    }

    const day = utcDayKey(run.completedAt);
    if (!daily.has(day)) {
      daily.set(day, {
        counts: {
          EASY: 0,
          MEDIUM: 0,
          HARD: 0,
          EXPERT: 0
        },
        scoreSum: 0,
        completedRuns: 0
      });
    }

    const bucket = daily.get(day)!;
    const difficulty = run.recipe.difficulty;
    bucket.counts[difficulty] += 1;
    bucket.scoreSum += difficultyScore(difficulty);
    bucket.completedRuns += 1;
    overallCounts[difficulty] += 1;
  }

  const totalRuns = Object.values(overallCounts).reduce((sum, value) => sum + value, 0);
  const overallScore =
    totalRuns > 0
      ? Number(
          (
            (overallCounts.EASY * 1 +
              overallCounts.MEDIUM * 2 +
              overallCounts.HARD * 3 +
              overallCounts.EXPERT * 4) /
            totalRuns
          ).toFixed(3)
        )
      : 0;

  const dailyDrilldown = [...daily.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([day, bucket]) => ({
      day,
      completedRuns: bucket.completedRuns,
      averageDifficultyScore:
        bucket.completedRuns > 0 ? Number((bucket.scoreSum / bucket.completedRuns).toFixed(3)) : 0,
      primaryDifficulty: resolvePrimaryDifficulty(bucket.counts),
      distribution: bucket.counts
    }));

  return {
    timezone: 'UTC',
    range: {
      from,
      to
    },
    userId: input.userId ?? null,
    scoreScale: {
      EASY: 1,
      MEDIUM: 2,
      HARD: 3,
      EXPERT: 4
    },
    totals: {
      completedRuns: totalRuns,
      averageDifficultyScore: overallScore,
      distribution: overallCounts
    },
    dailyDrilldown
  };
}

export async function getCompletionAccuracy(input: WorkflowDateRangeInput) {
  const { from, to } = resolveRange(input);

  const events = await prisma.workflowRunEvent.findMany({
    where: {
      createdAt: {
        gte: from,
        lt: to
      },
      eventType: {
        in: [
          WorkflowRunEventType.STEP_COMPLETED,
          WorkflowRunEventType.STEP_SKIPPED,
          WorkflowRunEventType.STEP_ROLLBACK
        ]
      },
      workflowRun: {
        ...(input.userId ? { operatorUserId: input.userId } : {})
      }
    },
    select: {
      eventType: true,
      createdAt: true
    }
  });

  const totals = {
    completed: 0,
    skipped: 0,
    rolledBack: 0
  };

  const daily = new Map<string, { completed: number; skipped: number; rolledBack: number }>();

  for (const event of events) {
    const day = utcDayKey(event.createdAt);
    if (!daily.has(day)) {
      daily.set(day, { completed: 0, skipped: 0, rolledBack: 0 });
    }
    const row = daily.get(day)!;

    if (event.eventType === WorkflowRunEventType.STEP_COMPLETED) {
      totals.completed += 1;
      row.completed += 1;
    }
    if (event.eventType === WorkflowRunEventType.STEP_SKIPPED) {
      totals.skipped += 1;
      row.skipped += 1;
    }
    if (event.eventType === WorkflowRunEventType.STEP_ROLLBACK) {
      totals.rolledBack += 1;
      row.rolledBack += 1;
    }
  }

  const denominator = totals.completed + totals.skipped + totals.rolledBack;

  const percentages = {
    completed: denominator > 0 ? Number(((totals.completed / denominator) * 100).toFixed(2)) : 0,
    skipped: denominator > 0 ? Number(((totals.skipped / denominator) * 100).toFixed(2)) : 0,
    rolledBack: denominator > 0 ? Number(((totals.rolledBack / denominator) * 100).toFixed(2)) : 0
  };

  const dailyDrilldown = [...daily.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([day, row]) => {
      const dayTotal = row.completed + row.skipped + row.rolledBack;
      return {
        day,
        ...row,
        percentages: {
          completed: dayTotal > 0 ? Number(((row.completed / dayTotal) * 100).toFixed(2)) : 0,
          skipped: dayTotal > 0 ? Number(((row.skipped / dayTotal) * 100).toFixed(2)) : 0,
          rolledBack: dayTotal > 0 ? Number(((row.rolledBack / dayTotal) * 100).toFixed(2)) : 0
        }
      };
    });

  return {
    timezone: 'UTC',
    range: {
      from,
      to
    },
    userId: input.userId ?? null,
    totals,
    percentages,
    dailyDrilldown
  };
}
