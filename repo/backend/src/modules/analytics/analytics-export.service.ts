import { Readable } from 'node:stream';

import { AuditAction } from '../../../prisma/generated';
import { prisma } from '../../lib/prisma';
import { AuthError } from '../auth/auth.service';

import {
  getCompletionAccuracy,
  getCuisineInterestDistribution,
  getDifficultyProgression,
  getRecipeViewVolume,
  getWeeklyConsistencyStreaks
} from './analytics.service';

export type AnalyticsExportDataset =
  | 'recipe_view_volume'
  | 'cuisine_interest'
  | 'weekly_streaks'
  | 'difficulty_progression'
  | 'completion_accuracy';

type ExportRequestInput = {
  actorUserId: string;
  actorRoles: string[];
  dataset: string;
  from?: string;
  to?: string;
  userId?: string;
  requestId?: string;
};

type ExportResult = {
  fileName: string;
  stream: Readable;
  rowCount: number;
  contentType: string;
};

function isAdmin(roles: string[]): boolean {
  return roles.includes('ADMIN');
}

function parseDataset(raw: string): AnalyticsExportDataset {
  const normalized = raw.trim().toLowerCase();

  const allowed: AnalyticsExportDataset[] = [
    'recipe_view_volume',
    'cuisine_interest',
    'weekly_streaks',
    'difficulty_progression',
    'completion_accuracy'
  ];

  if (!allowed.includes(normalized as AnalyticsExportDataset)) {
    throw new AuthError(`Unsupported analytics dataset: ${raw}`, 400);
  }

  return normalized as AnalyticsExportDataset;
}

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  const raw = String(value);
  if (raw.includes(',') || raw.includes('"') || raw.includes('\n')) {
    return `"${raw.replace(/"/g, '""')}"`;
  }

  return raw;
}

function csvLine(values: unknown[]): string {
  return `${values.map(csvEscape).join(',')}\n`;
}

function streamCsv(header: string[], rows: Array<Array<unknown>>): Readable {
  return Readable.from([
    csvLine(header),
    ...rows.map((row) => csvLine(row))
  ]);
}

function dateStamp(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  const hh = String(now.getUTCHours()).padStart(2, '0');
  const mm = String(now.getUTCMinutes()).padStart(2, '0');
  const ss = String(now.getUTCSeconds()).padStart(2, '0');
  return `${y}${m}${d}-${hh}${mm}${ss}`;
}

async function exportRecipeViewVolume(input: ExportRequestInput): Promise<ExportResult> {
  const metric = await getRecipeViewVolume({
    from: input.from,
    to: input.to,
    limit: 200
  });

  const rows = metric.topRecipes.map((row) => [
    row.recipeId,
    row.recipeCode,
    row.recipeName,
    row.cuisineTags.join('|'),
    row.views,
    row.uniqueUsers,
    row.uniqueSessions
  ]);

  return {
    fileName: `analytics-${input.dataset}-${dateStamp()}.csv`,
    stream: streamCsv(
      ['recipe_id', 'recipe_code', 'recipe_name', 'cuisine_tags', 'views', 'unique_users', 'unique_sessions'],
      rows
    ),
    rowCount: rows.length,
    contentType: 'text/csv; charset=utf-8'
  };
}

async function exportCuisineInterest(input: ExportRequestInput): Promise<ExportResult> {
  const metric = await getCuisineInterestDistribution({
    from: input.from,
    to: input.to
  });

  const rows = metric.distribution.map((row) => [
    row.cuisineTag,
    row.weightedViews,
    row.percentage
  ]);

  return {
    fileName: `analytics-${input.dataset}-${dateStamp()}.csv`,
    stream: streamCsv(['cuisine_tag', 'weighted_views', 'percentage'], rows),
    rowCount: rows.length,
    contentType: 'text/csv; charset=utf-8'
  };
}

async function exportWeeklyStreaks(input: ExportRequestInput): Promise<ExportResult> {
  const metric = await getWeeklyConsistencyStreaks({
    from: input.from,
    to: input.to,
    userId: input.userId
  });

  const rows = metric.weeklyDrilldown.map((row) => [
    row.weekStartUtc,
    row.hasCompletion
  ]);

  return {
    fileName: `analytics-${input.dataset}-${dateStamp()}.csv`,
    stream: streamCsv(['week_start_utc', 'has_completion'], rows),
    rowCount: rows.length,
    contentType: 'text/csv; charset=utf-8'
  };
}

async function exportDifficultyProgression(input: ExportRequestInput): Promise<ExportResult> {
  const metric = await getDifficultyProgression({
    from: input.from,
    to: input.to,
    userId: input.userId
  });

  const rows = metric.dailyDrilldown.map((row) => [
    row.day,
    row.completedRuns,
    row.averageDifficultyScore,
    row.primaryDifficulty,
    row.distribution.EASY,
    row.distribution.MEDIUM,
    row.distribution.HARD,
    row.distribution.EXPERT
  ]);

  return {
    fileName: `analytics-${input.dataset}-${dateStamp()}.csv`,
    stream: streamCsv(
      [
        'day_utc',
        'completed_runs',
        'avg_difficulty_score',
        'primary_difficulty',
        'easy_count',
        'medium_count',
        'hard_count',
        'expert_count'
      ],
      rows
    ),
    rowCount: rows.length,
    contentType: 'text/csv; charset=utf-8'
  };
}

async function exportCompletionAccuracy(input: ExportRequestInput): Promise<ExportResult> {
  const metric = await getCompletionAccuracy({
    from: input.from,
    to: input.to,
    userId: input.userId
  });

  const rows = metric.dailyDrilldown.map((row) => [
    row.day,
    row.completed,
    row.skipped,
    row.rolledBack,
    row.percentages.completed,
    row.percentages.skipped,
    row.percentages.rolledBack
  ]);

  return {
    fileName: `analytics-${input.dataset}-${dateStamp()}.csv`,
    stream: streamCsv(
      [
        'day_utc',
        'completed',
        'skipped',
        'rolled_back',
        'completed_pct',
        'skipped_pct',
        'rolled_back_pct'
      ],
      rows
    ),
    rowCount: rows.length,
    contentType: 'text/csv; charset=utf-8'
  };
}

async function auditAnalyticsExport(input: {
  actorUserId: string;
  dataset: AnalyticsExportDataset;
  from?: string;
  to?: string;
  userId?: string;
  rowCount: number;
  requestId?: string;
}): Promise<void> {
  await prisma.auditLog.create({
    data: {
      actorUserId: input.actorUserId,
      action: AuditAction.EXPORT,
      entityType: 'analytics_export',
      entityLabel: input.dataset,
      requestId: input.requestId ?? null,
      afterJson: {
        dataset: input.dataset,
        from: input.from ?? null,
        to: input.to ?? null,
        targetUserId: input.userId ?? null,
        format: 'csv',
        rowCount: input.rowCount,
        timezone: 'UTC'
      }
    }
  });
}

export async function exportAnalyticsCsv(input: ExportRequestInput): Promise<ExportResult> {
  if (!isAdmin(input.actorRoles)) {
    throw new AuthError('Admin role required for analytics export', 403);
  }

  if (input.userId && !isAdmin(input.actorRoles)) {
    throw new AuthError('Not allowed to export another user scope', 403);
  }

  const dataset = parseDataset(input.dataset);

  const normalizedInput: ExportRequestInput = {
    ...input,
    dataset
  };

  let result: ExportResult;
  if (dataset === 'recipe_view_volume') {
    result = await exportRecipeViewVolume(normalizedInput);
  } else if (dataset === 'cuisine_interest') {
    result = await exportCuisineInterest(normalizedInput);
  } else if (dataset === 'weekly_streaks') {
    result = await exportWeeklyStreaks(normalizedInput);
  } else if (dataset === 'difficulty_progression') {
    result = await exportDifficultyProgression(normalizedInput);
  } else {
    result = await exportCompletionAccuracy(normalizedInput);
  }

  await auditAnalyticsExport({
    actorUserId: input.actorUserId,
    dataset,
    from: input.from,
    to: input.to,
    userId: input.userId,
    rowCount: result.rowCount,
    requestId: input.requestId
  });

  return result;
}
