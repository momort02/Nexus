import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { ApiError } from '../../http/api-error.js';
import type { AuthRepository } from '../auth/types.js';
import {
  createRequireGuildAccess,
  createRequireSameOrigin,
  createRequireSession,
} from '../auth/session.js';
import type { AuthorizationService } from '../permissions/authorization.service.js';
import { requirePermission } from '../permissions/permission.middleware.js';
import type { AnalyticsRepository } from './types.js';
import {
  addCalendarDays,
  dateBucket,
  localDateAt,
  localMidnightUtc,
  parseCalendarDate,
} from './time.js';

const pageSchema = z.coerce.number().int().min(1).max(10_000).default(1);
const pageSizeSchema = z.coerce.number().int().min(1).max(100).default(25);
const channelIdSchema = z
  .string()
  .regex(/^\d{17,20}$/)
  .optional();
const timezoneSchema = z.string().min(1).max(64);

function queryString(value: unknown, field: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new ApiError(400, 'invalid_analytics_filter', `${field} is invalid.`);
  }
  return value;
}

function validateTimezone(value: string): string {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return value;
  } catch {
    throw new ApiError(
      400,
      'invalid_timezone',
      'The timezone must be a valid IANA timezone.',
    );
  }
}

function getGuildId(value: string | string[] | undefined): string {
  if (typeof value !== 'string' || !/^\d{17,20}$/.test(value)) {
    throw new ApiError(
      400,
      'invalid_guild_id',
      'The server identifier is invalid.',
    );
  }
  return value;
}

function getRange(
  fromValue: unknown,
  toValue: unknown,
  timezone: string,
): { from: string; to: string; startAt: Date; endAt: Date } {
  const today = localDateAt(new Date(), timezone);
  const to = parseCalendarDate(queryString(toValue, 'to') ?? today, 'to');
  const from = parseCalendarDate(
    queryString(fromValue, 'from') ?? addCalendarDays(to, -29),
    'from',
  );
  const days =
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
      86_400_000 +
    1;
  if (days < 1 || days > 366) {
    throw new ApiError(
      400,
      'invalid_analytics_range',
      'The selected period must contain between 1 and 366 days.',
    );
  }
  return {
    from,
    to,
    startAt: localMidnightUtc(from, timezone),
    endAt: localMidnightUtc(addCalendarDays(to, 1), timezone),
  };
}

function parsePage<T extends z.ZodTypeAny>(
  value: unknown,
  schema: T,
  field: string,
): z.infer<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ApiError(
      400,
      'invalid_analytics_pagination',
      `${field} is invalid.`,
    );
  }
  return parsed.data;
}

function csvCell(value: string | number): string {
  return `"${String(value).replaceAll('"', '""')}"`;
}

export function createAnalyticsRouter(dependencies: {
  authRepository: AuthRepository;
  authorization: AuthorizationService;
  repository: AnalyticsRepository;
  appOrigin: string;
}): Router {
  const router = Router();
  const requireSession = createRequireSession(dependencies.authRepository);
  const requireGuildAccess = createRequireGuildAccess(
    dependencies.authRepository,
  );
  const requireSameOrigin = createRequireSameOrigin(dependencies.appOrigin);
  const analyticsLimit = rateLimit({
    windowMs: 60_000,
    limit: 60,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
  });

  router.use(
    '/guilds/:guildId/dashboard',
    createRequireSession(dependencies.authRepository),
    createRequireGuildAccess(dependencies.authRepository),
  );
  router.get(
    '/guilds/:guildId/dashboard',
    analyticsLimit,
    requirePermission(dependencies.authorization, 'dashboard.view'),
    async (request, response) => {
      const guildId = getGuildId(request.params.guildId);
      const timezone = await dependencies.repository.getTimezone(guildId);
      if (!timezone) {
        throw new ApiError(404, 'guild_not_found', 'The server was not found.');
      }
      const to = localDateAt(new Date(), timezone);
      const range = getRange(addCalendarDays(to, -6), to, timezone);
      response.json({
        summary: await dependencies.repository.getSummary({
          guildId,
          ...range,
          timezone,
        }),
      });
    },
  );

  router.use(
    '/guilds/:guildId/settings',
    createRequireSession(dependencies.authRepository),
    createRequireGuildAccess(dependencies.authRepository),
  );
  router.get(
    '/guilds/:guildId/settings',
    analyticsLimit,
    requirePermission(dependencies.authorization, 'settings.view'),
    async (request, response) => {
      const timezone = await dependencies.repository.getTimezone(
        getGuildId(request.params.guildId),
      );
      if (!timezone) {
        throw new ApiError(404, 'guild_not_found', 'The server was not found.');
      }
      response.json({ settings: { analyticsTimezone: timezone } });
    },
  );

  router.use('/guilds/:guildId/analytics', requireSession, requireGuildAccess);

  router.get(
    '/guilds/:guildId/analytics/overview',
    analyticsLimit,
    requirePermission(dependencies.authorization, 'analytics.view'),
    async (request, response) => {
      const guildId = getGuildId(request.params.guildId);
      const timezone = await dependencies.repository.getTimezone(guildId);
      if (!timezone) {
        throw new ApiError(404, 'guild_not_found', 'The server was not found.');
      }
      const current = getRange(request.query.from, request.query.to, timezone);
      const summary = await dependencies.repository.getSummary({
        guildId,
        ...current,
        timezone,
      });

      const compareFromValue = queryString(
        request.query.compareFrom,
        'compareFrom',
      );
      const compareToValue = queryString(request.query.compareTo, 'compareTo');
      if (Boolean(compareFromValue) !== Boolean(compareToValue)) {
        throw new ApiError(
          400,
          'invalid_comparison_range',
          'Both comparison dates must be provided.',
        );
      }

      let comparison = null;
      if (compareFromValue && compareToValue) {
        const range = getRange(compareFromValue, compareToValue, timezone);
        const currentDays =
          (Date.parse(`${current.to}T00:00:00Z`) -
            Date.parse(`${current.from}T00:00:00Z`)) /
            86_400_000 +
          1;
        const comparisonDays =
          (Date.parse(`${range.to}T00:00:00Z`) -
            Date.parse(`${range.from}T00:00:00Z`)) /
            86_400_000 +
          1;
        if (currentDays !== comparisonDays) {
          throw new ApiError(
            400,
            'invalid_comparison_range',
            'Comparison periods must have the same number of days.',
          );
        }
        comparison = await dependencies.repository.getSummary({
          guildId,
          ...range,
          timezone,
        });
      }
      response.json({ summary, comparison });
    },
  );

  router.get(
    '/guilds/:guildId/analytics/channels',
    analyticsLimit,
    requirePermission(dependencies.authorization, 'analytics.view'),
    async (request, response) => {
      const guildId = getGuildId(request.params.guildId);
      const timezone = await dependencies.repository.getTimezone(guildId);
      if (!timezone) {
        throw new ApiError(404, 'guild_not_found', 'The server was not found.');
      }
      const range = getRange(request.query.from, request.query.to, timezone);
      const page = parsePage(request.query.page, pageSchema, 'page');
      const pageSize = parsePage(
        request.query.pageSize,
        pageSizeSchema,
        'pageSize',
      );
      const channelId = channelIdSchema.safeParse(request.query.channelId);
      if (!channelId.success) {
        throw new ApiError(
          400,
          'invalid_channel_id',
          'The channel identifier is invalid.',
        );
      }
      const channelName = queryString(request.query.channelName, 'channelName');
      if (channelName && channelName.trim().length > 100) {
        throw new ApiError(
          400,
          'invalid_channel_name',
          'The channel name filter is invalid.',
        );
      }
      const result = await dependencies.repository.listChannels({
        guildId,
        from: dateBucket(range.from),
        to: dateBucket(addCalendarDays(range.to, 1)),
        page,
        pageSize,
        ...(channelId.data ? { channelId: channelId.data } : {}),
        ...(channelName?.trim() ? { channelName: channelName.trim() } : {}),
      });
      response.json({
        ...result,
        page,
        pageSize,
        pages: Math.ceil(result.total / pageSize),
        from: range.from,
        to: range.to,
        timezone,
      });
    },
  );

  router.get(
    '/guilds/:guildId/analytics/export.csv',
    analyticsLimit,
    requirePermission(dependencies.authorization, 'analytics.export'),
    async (request, response) => {
      const guildId = getGuildId(request.params.guildId);
      const timezone = await dependencies.repository.getTimezone(guildId);
      if (!timezone) {
        throw new ApiError(404, 'guild_not_found', 'The server was not found.');
      }
      const range = getRange(request.query.from, request.query.to, timezone);
      const [summary, result] = await Promise.all([
        dependencies.repository.getSummary({
          guildId,
          ...range,
          timezone,
        }),
        dependencies.repository.listChannels({
          guildId,
          from: dateBucket(range.from),
          to: dateBucket(addCalendarDays(range.to, 1)),
          page: 1,
          pageSize: 10_000,
        }),
      ]);
      if (result.total > result.channels.length) {
        throw new ApiError(
          413,
          'analytics_export_too_large',
          'Narrow the selected period before exporting.',
        );
      }

      const header = [
        'recordType',
        'date',
        'channelId',
        'channelName',
        'from',
        'to',
        'timezone',
        'messageCount',
        'joins',
        'leaves',
        'activeMembers',
      ];
      const dailyRows = summary.series.map((point) => [
        'daily',
        point.date,
        '',
        '',
        range.from,
        range.to,
        timezone,
        point.messageCount,
        point.joins,
        point.leaves,
        point.activeMembers,
      ]);
      const channelRows = result.channels.map((channel) => [
        'channel',
        '',
        channel.channelId,
        channel.name ?? '',
        range.from,
        range.to,
        timezone,
        channel.messageCount,
        '',
        '',
        '',
      ]);
      const csv = `\uFEFF${[header, ...dailyRows, ...channelRows]
        .map((row) => row.map(csvCell).join(','))
        .join('\r\n')}\r\n`;
      response
        .status(200)
        .set({
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="nexus-analytics.csv"',
          'Cache-Control': 'no-store',
        })
        .send(csv);
    },
  );

  router.put(
    '/guilds/:guildId/analytics/timezone',
    requireSameOrigin,
    requirePermission(dependencies.authorization, 'settings.manage'),
    async (request, response) => {
      const guildId = getGuildId(request.params.guildId);
      const parsed = z
        .object({ timezone: timezoneSchema })
        .safeParse(request.body);
      if (!parsed.success) {
        throw new ApiError(400, 'invalid_timezone', 'A timezone is required.');
      }
      const timezone = validateTimezone(parsed.data.timezone);
      const updated = await dependencies.repository.updateTimezone(
        guildId,
        timezone,
      );
      if (!updated) {
        throw new ApiError(
          409,
          'timezone_locked',
          'The timezone cannot change after analytics collection has started.',
        );
      }
      response.status(204).end();
    },
  );

  return router;
}
