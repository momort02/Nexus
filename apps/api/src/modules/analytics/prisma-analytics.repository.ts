import { Prisma, PrismaClient } from '@prisma/client';
import { addCalendarDays, dateBucket, localDateAt } from './time.js';
import type {
  AnalyticsChannel,
  AnalyticsRepository,
  AnalyticsSummary,
} from './types.js';

function sum(value: number | null | undefined): number {
  return value ?? 0;
}

export class PrismaAnalyticsRepository implements AnalyticsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async getTimezone(guildId: string): Promise<string | null> {
    const guild = await this.prisma.guild.findUnique({
      where: { id: guildId },
      select: { analyticsTimezone: true },
    });
    return guild?.analyticsTimezone ?? null;
  }

  async updateTimezone(guildId: string, timezone: string): Promise<boolean> {
    return this.prisma.$transaction(async (transaction) => {
      const guild = await transaction.guild.findUnique({
        where: { id: guildId },
        select: { analyticsStartedAt: true },
      });
      if (!guild || guild.analyticsStartedAt) {
        return false;
      }
      await transaction.guild.update({
        where: { id: guildId },
        data: { analyticsTimezone: timezone },
      });
      return true;
    });
  }

  async getSummary(input: {
    guildId: string;
    from: string;
    to: string;
    timezone: string;
    startAt: Date;
    endAt: Date;
  }): Promise<AnalyticsSummary> {
    const activityDateRange = {
      gte: dateBucket(input.from),
      lt: dateBucket(addCalendarDays(input.to, 1)),
    };
    const [guild, dailyGuildStats, dailyActivities, messages] =
      await Promise.all([
        this.prisma.guild.findUnique({
          where: { id: input.guildId },
          select: { analyticsStartedAt: true },
        }),
        this.prisma.guildDailyStatistic.groupBy({
          by: ['activityDate'],
          where: {
            guildId: input.guildId,
            activityDate: activityDateRange,
          },
          _sum: { joinCount: true, leaveCount: true },
        }),
        this.prisma.dailyMemberActivity.groupBy({
          by: ['activityDate'],
          where: {
            guildId: input.guildId,
            activityDate: activityDateRange,
          },
          _count: { _all: true },
        }),
        this.prisma.dailyMessageStatistic.groupBy({
          by: ['activityDate'],
          where: {
            guildId: input.guildId,
            activityDate: activityDateRange,
          },
          _sum: { messageCount: true },
        }),
      ]);

    const joins = new Map(
      dailyGuildStats.map((row) => [
        row.activityDate.toISOString().slice(0, 10),
        sum(row._sum.joinCount),
      ]),
    );
    const leaves = new Map(
      dailyGuildStats.map((row) => [
        row.activityDate.toISOString().slice(0, 10),
        sum(row._sum.leaveCount),
      ]),
    );
    const activeMembers = new Map(
      dailyActivities.map((row) => [
        row.activityDate.toISOString().slice(0, 10),
        row._count._all,
      ]),
    );
    const messageCounts = new Map(
      messages.map((row) => [
        row.activityDate.toISOString().slice(0, 10),
        sum(row._sum.messageCount),
      ]),
    );

    const observedFrom = guild?.analyticsStartedAt
      ? localDateAt(guild.analyticsStartedAt, input.timezone)
      : null;
    const firstDate =
      observedFrom && observedFrom > input.from ? observedFrom : input.from;
    const series: AnalyticsSummary['series'] = [];
    if (observedFrom && firstDate <= input.to) {
      for (
        let date = firstDate;
        date <= input.to;
        date = addCalendarDays(date, 1)
      ) {
        series.push({
          date,
          messageCount: messageCounts.get(date) ?? 0,
          joins: joins.get(date) ?? 0,
          leaves: leaves.get(date) ?? 0,
          activeMembers: activeMembers.get(date) ?? 0,
        });
      }
    }

    const totals = series.reduce(
      (result, point) => ({
        messageCount: result.messageCount + point.messageCount,
        joins: result.joins + point.joins,
        leaves: result.leaves + point.leaves,
        activeMemberDays: result.activeMemberDays + point.activeMembers,
        uniqueActiveMembers: 0,
      }),
      {
        messageCount: 0,
        joins: 0,
        leaves: 0,
        activeMemberDays: 0,
        uniqueActiveMembers: 0,
      },
    );

    totals.uniqueActiveMembers = await this.countUniqueActiveMembers({
      guildId: input.guildId,
      from: activityDateRange.gte,
      to: dateBucket(input.to),
    });

    const dau = activeMembers.get(input.to) ?? 0;
    const wau = await this.countUniqueActiveMembers({
      guildId: input.guildId,
      from: dateBucket(addCalendarDays(input.to, -6)),
      to: dateBucket(input.to),
    });
    const mau = await this.countUniqueActiveMembers({
      guildId: input.guildId,
      from: dateBucket(addCalendarDays(input.to, -29)),
      to: dateBucket(input.to),
    });

    return {
      timezone: input.timezone,
      from: input.from,
      to: input.to,
      observedFrom,
      series,
      totals,
      active: { dau, wau, mau },
    };
  }

  async countUniqueActiveMembers(input: {
    guildId: string;
    from: Date;
    to: Date;
  }): Promise<number> {
    const result = await this.prisma.$queryRaw<Array<{ count: bigint }>>(
      Prisma.sql`
        SELECT COUNT(DISTINCT "memberKey") AS count
        FROM "DailyMemberActivity"
        WHERE "guildId" = ${input.guildId}
          AND "activityDate" >= ${input.from}::date
          AND "activityDate" <= ${input.to}::date
      `,
    );
    return Number(result[0]?.count ?? 0);
  }

  async listChannels(input: {
    guildId: string;
    from: Date;
    to: Date;
    page: number;
    pageSize: number;
    channelId?: string;
    channelName?: string;
  }): Promise<{ channels: AnalyticsChannel[]; total: number }> {
    const namedChannels = input.channelName
      ? await this.prisma.discordGuildChannel.findMany({
          where: {
            guildId: input.guildId,
            name: { contains: input.channelName, mode: 'insensitive' },
          },
          select: { channelId: true },
        })
      : null;
    if (namedChannels && namedChannels.length === 0) {
      return { channels: [], total: 0 };
    }

    const where: Prisma.DailyMessageStatisticWhereInput = {
      guildId: input.guildId,
      activityDate: { gte: input.from, lt: input.to },
      ...(input.channelId ? { channelId: input.channelId } : {}),
      ...(namedChannels
        ? { channelId: { in: namedChannels.map(({ channelId }) => channelId) } }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.dailyMessageStatistic.groupBy({
        by: ['channelId'],
        where,
        _sum: { messageCount: true },
        orderBy: { channelId: 'asc' },
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
      }),
      this.prisma.dailyMessageStatistic.groupBy({
        by: ['channelId'],
        where,
      }),
    ]);
    const names = await this.prisma.discordGuildChannel.findMany({
      where: {
        guildId: input.guildId,
        channelId: { in: rows.map((row) => row.channelId) },
      },
      select: { channelId: true, name: true },
    });
    const channelNames = new Map(
      names.map(({ channelId, name }) => [channelId, name]),
    );

    return {
      channels: rows.map((row) => ({
        channelId: row.channelId,
        name: channelNames.get(row.channelId) ?? null,
        messageCount: sum(row._sum.messageCount),
      })),
      total: total.length,
    };
  }
}
