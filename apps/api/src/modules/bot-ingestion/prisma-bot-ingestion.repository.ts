import { Prisma, PrismaClient } from '@prisma/client';
import type { DiscordBotEvent } from '@nexus/shared';
import {
  dateBucket,
  dateLabelsBetween,
  localDateAt,
  localMidnightUtc,
  validateTimezone,
} from '../analytics/time.js';
import type { BotIngestionRepository } from './types.js';

export class PrismaBotIngestionRepository implements BotIngestionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async consumeRequestNonce(nonce: string, expiresAt: Date): Promise<boolean> {
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`
        DELETE FROM "BotRequestNonce" WHERE "expiresAt" <= ${new Date()}
      `;
      const inserted = await transaction.$executeRaw`
        INSERT INTO "BotRequestNonce" ("nonce", "expiresAt")
        VALUES (${nonce}, ${expiresAt})
        ON CONFLICT ("nonce") DO NOTHING
      `;
      return inserted === 1;
    });
  }

  async ingest(
    event: DiscordBotEvent,
  ): Promise<'processed' | 'duplicate' | 'unknown-guild'> {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const guild = await transaction.guild.findUnique({
          where: { id: event.guildId },
          select: { id: true, analyticsTimezone: true },
        });
        if (!guild) {
          return 'unknown-guild';
        }

        const receipt = await transaction.botEventReceipt.createMany({
          data: [
            {
              eventId: event.eventId,
              guildId: event.guildId,
              type: event.type,
              occurredAt: new Date(event.occurredAt),
            },
          ],
          skipDuplicates: true,
        });
        if (receipt.count === 0) {
          return 'duplicate';
        }

        if (event.type !== 'guild.metadata') {
          await transaction.guild.updateMany({
            where: {
              id: event.guildId,
              analyticsStartedAt: null,
            },
            data: { analyticsStartedAt: new Date(event.occurredAt) },
          });
        }

        if (event.type === 'guild.metadata') {
          await transaction.discordGuildChannel.deleteMany({
            where: { guildId: event.guildId },
          });
          await transaction.discordGuildRole.deleteMany({
            where: { guildId: event.guildId },
          });
          if (event.channels.length > 0) {
            await transaction.discordGuildChannel.createMany({
              data: event.channels.map((channel) => ({
                guildId: event.guildId,
                channelId: channel.id,
                name: channel.name,
              })),
            });
          }
          if (event.roles.length > 0) {
            await transaction.discordGuildRole.createMany({
              data: event.roles.map((role) => ({
                guildId: event.guildId,
                roleId: role.id,
                name: role.name,
              })),
            });
          }
        } else if (event.type === 'message.count') {
          if (event.channelName) {
            await transaction.discordGuildChannel.upsert({
              where: {
                guildId_channelId: {
                  guildId: event.guildId,
                  channelId: event.channelId,
                },
              },
              create: {
                guildId: event.guildId,
                channelId: event.channelId,
                name: event.channelName,
              },
              update: { name: event.channelName },
            });
          }
          const activityDate = dateBucket(
            localDateAt(new Date(event.occurredAt), guild.analyticsTimezone),
          );
          await transaction.messageStatistic.upsert({
            where: {
              guildId_channelId_bucketStart: {
                guildId: event.guildId,
                channelId: event.channelId,
                bucketStart: new Date(event.bucketStart),
              },
            },
            create: {
              guildId: event.guildId,
              channelId: event.channelId,
              bucketStart: new Date(event.bucketStart),
              messageCount: 1,
            },
            update: { messageCount: { increment: 1 } },
          });
          await transaction.dailyMessageStatistic.upsert({
            where: {
              guildId_channelId_activityDate: {
                guildId: event.guildId,
                channelId: event.channelId,
                activityDate,
              },
            },
            create: {
              guildId: event.guildId,
              channelId: event.channelId,
              activityDate,
              messageCount: 1,
            },
            update: { messageCount: { increment: 1 } },
          });
          await transaction.dailyMemberActivity.upsert({
            where: {
              guildId_activityDate_memberKey: {
                guildId: event.guildId,
                activityDate,
                memberKey: event.memberKey,
              },
            },
            create: {
              guildId: event.guildId,
              activityDate,
              memberKey: event.memberKey,
              messageCount: 1,
              lastActivityAt: new Date(event.occurredAt),
            },
            update: {
              messageCount: { increment: 1 },
              lastActivityAt: new Date(event.occurredAt),
            },
          });
        } else if (event.type === 'member.activity') {
          const activityDate = dateBucket(
            localDateAt(new Date(event.occurredAt), guild.analyticsTimezone),
          );
          const counters = {
            command: { commandCount: 1 },
            reaction: { reactionCount: 1 },
            voice: { voiceSessions: 1 },
          }[event.category];
          await transaction.dailyMemberActivity.upsert({
            where: {
              guildId_activityDate_memberKey: {
                guildId: event.guildId,
                activityDate,
                memberKey: event.memberKey,
              },
            },
            create: {
              guildId: event.guildId,
              activityDate,
              memberKey: event.memberKey,
              ...counters,
              lastActivityAt: new Date(event.occurredAt),
            },
            update: {
              ...Object.fromEntries(
                Object.entries(counters).map(([key, value]) => [
                  key,
                  { increment: value },
                ]),
              ),
              lastActivityAt: new Date(event.occurredAt),
            },
          });
        } else if (event.type === 'voice.session') {
          const timezone = validateTimezone(guild.analyticsTimezone);
          const startedAt = new Date(event.startedAt);
          const endedAt = new Date(event.endedAt);
          const dates = dateLabelsBetween(startedAt, endedAt, timezone);
          for (const date of dates) {
            const dayStart = localMidnightUtc(date, timezone);
            const dayEnd = localMidnightUtc(
              new Date(dateBucket(date).getTime() + 24 * 60 * 60 * 1000)
                .toISOString()
                .slice(0, 10),
              timezone,
            );
            const seconds = Math.max(
              0,
              Math.floor(
                (Math.min(endedAt.getTime(), dayEnd.getTime()) -
                  Math.max(startedAt.getTime(), dayStart.getTime())) /
                  1000,
              ),
            );
            if (seconds === 0) {
              continue;
            }
            const activityDate = dateBucket(date);
            await transaction.dailyMemberActivity.upsert({
              where: {
                guildId_activityDate_memberKey: {
                  guildId: event.guildId,
                  activityDate,
                  memberKey: event.memberKey,
                },
              },
              create: {
                guildId: event.guildId,
                activityDate,
                memberKey: event.memberKey,
                voiceSeconds: seconds,
                lastActivityAt: endedAt,
              },
              update: {
                voiceSeconds: { increment: seconds },
                lastActivityAt: endedAt,
              },
            });
          }
        } else if (event.type === 'member.left') {
          const activityDate = dateBucket(
            localDateAt(new Date(event.occurredAt), guild.analyticsTimezone),
          );
          await transaction.guildDailyStatistic.upsert({
            where: {
              guildId_activityDate: {
                guildId: event.guildId,
                activityDate,
              },
            },
            create: {
              guildId: event.guildId,
              activityDate,
              leaveCount: 1,
            },
            update: { leaveCount: { increment: 1 } },
          });
          await transaction.guildMemberSnapshot.deleteMany({
            where: {
              guildId: event.guildId,
              discordUserId: event.discordUserId,
            },
          });
        } else if (event.type === 'member.joined') {
          const activityDate = dateBucket(
            localDateAt(new Date(event.occurredAt), guild.analyticsTimezone),
          );
          await transaction.guildDailyStatistic.upsert({
            where: {
              guildId_activityDate: {
                guildId: event.guildId,
                activityDate,
              },
            },
            create: {
              guildId: event.guildId,
              activityDate,
              joinCount: 1,
            },
            update: { joinCount: { increment: 1 } },
          });
          if (event.roleNames?.length) {
            await transaction.discordGuildRole.createMany({
              data: event.roleNames.map((role) => ({
                guildId: event.guildId,
                roleId: role.id,
                name: role.name,
              })),
              skipDuplicates: true,
            });
          }
          await transaction.guildMemberSnapshot.upsert({
            where: {
              guildId_discordUserId: {
                guildId: event.guildId,
                discordUserId: event.discordUserId,
              },
            },
            create: {
              guildId: event.guildId,
              discordUserId: event.discordUserId,
              displayName: event.displayName ?? null,
              joinedAt: event.joinedAt ? new Date(event.joinedAt) : null,
              roleIds: event.roleIds,
            },
            update: {
              displayName: event.displayName ?? null,
              joinedAt: event.joinedAt ? new Date(event.joinedAt) : null,
              roleIds: event.roleIds,
              syncedAt: new Date(),
            },
          });
        } else {
          if (event.roleNames?.length) {
            await transaction.discordGuildRole.createMany({
              data: event.roleNames.map((role) => ({
                guildId: event.guildId,
                roleId: role.id,
                name: role.name,
              })),
              skipDuplicates: true,
            });
          }
          await transaction.guildMemberSnapshot.upsert({
            where: {
              guildId_discordUserId: {
                guildId: event.guildId,
                discordUserId: event.discordUserId,
              },
            },
            create: {
              guildId: event.guildId,
              discordUserId: event.discordUserId,
              displayName: event.displayName ?? null,
              joinedAt: event.joinedAt ? new Date(event.joinedAt) : null,
              roleIds: event.roleIds,
            },
            update: {
              displayName: event.displayName ?? null,
              joinedAt: event.joinedAt ? new Date(event.joinedAt) : null,
              roleIds: event.roleIds,
              syncedAt: new Date(),
            },
          });
        }

        return 'processed';
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return 'duplicate';
      }
      throw error;
    }
  }
}
