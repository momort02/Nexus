import { Prisma, PrismaClient } from '@prisma/client';
import type {
  AuthRepository,
  AuthSession,
  AuthUser,
  GuildMembership,
} from './types.js';
import { PrismaRbacRepository } from '../permissions/prisma-rbac.repository.js';

const sessionInclude = {
  user: true,
} satisfies Prisma.UserSessionInclude;

export class PrismaAuthRepository implements AuthRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async upsertUser(user: Omit<AuthUser, 'id'>): Promise<AuthUser> {
    return this.prisma.user.upsert({
      where: { discordId: user.discordId },
      create: user,
      update: {
        username: user.username,
        globalName: user.globalName,
        avatar: user.avatar,
      },
    });
  }

  async createSession(session: {
    id: string;
    userId: string;
    encryptedAccessToken: string;
    accessTokenExpiresAt: Date;
    expiresAt: Date;
  }): Promise<void> {
    await this.prisma.userSession.create({ data: session });
  }

  async findSession(id: string): Promise<AuthSession | null> {
    const session = await this.prisma.userSession.findUnique({
      where: { id },
      include: sessionInclude,
    });
    return session;
  }

  async deleteSession(id: string): Promise<void> {
    await this.prisma.userSession.deleteMany({ where: { id } });
  }

  async clearAccessToken(id: string): Promise<void> {
    await this.prisma.userSession.updateMany({
      where: { id },
      data: { encryptedAccessToken: null, accessTokenExpiresAt: null },
    });
  }

  async listMemberships(userId: string): Promise<GuildMembership[]> {
    const memberships = await this.prisma.guildMembership.findMany({
      where: { userId },
      include: { guild: true },
      orderBy: { guild: { name: 'asc' } },
    });

    return memberships.map(({ guild, role }) => ({
      id: guild.id,
      name: guild.name,
      role,
    }));
  }

  async getMembership(
    userId: string,
    guildId: string,
  ): Promise<GuildMembership | null> {
    const membership = await this.prisma.guildMembership.findUnique({
      where: { userId_guildId: { userId, guildId } },
      include: { guild: true },
    });

    return membership
      ? {
          id: membership.guild.id,
          name: membership.guild.name,
          role: membership.role,
        }
      : null;
  }

  async createOrSelectGuild(
    userId: string,
    guild: { id: string; name: string },
    sessionId: string,
  ): Promise<'created' | 'selected' | 'not-authorized'> {
    return this.prisma.$transaction(
      async (transaction) => {
        const existingMembership = await transaction.guildMembership.findUnique(
          {
            where: { userId_guildId: { userId, guildId: guild.id } },
          },
        );

        if (!existingMembership) {
          const existingGuild = await transaction.guild.findUnique({
            where: { id: guild.id },
          });

          if (existingGuild) {
            return 'not-authorized';
          }

          await transaction.guild.create({
            data: { id: guild.id, name: guild.name },
          });
          await transaction.guildMembership.create({
            data: { userId, guildId: guild.id, role: 'OWNER' },
          });
          const membership =
            await transaction.guildMembership.findUniqueOrThrow({
              where: { userId_guildId: { userId, guildId: guild.id } },
            });
          await new PrismaRbacRepository(this.prisma).seedGuildRoles(
            transaction,
            guild.id,
            membership.id,
          );
        } else {
          await transaction.guild.update({
            where: { id: guild.id },
            data: { name: guild.name },
          });
          const roleAssignments = await transaction.userGuildRole.count({
            where: {
              membership: { userId, guildId: guild.id },
            },
          });
          if (roleAssignments === 0 && existingMembership.role === 'OWNER') {
            const membership =
              await transaction.guildMembership.findUniqueOrThrow({
                where: { userId_guildId: { userId, guildId: guild.id } },
              });
            await new PrismaRbacRepository(this.prisma).seedGuildRoles(
              transaction,
              guild.id,
              membership.id,
            );
          }
        }

        await transaction.userSession.update({
          where: { id: sessionId },
          data: { selectedGuildId: guild.id },
        });

        return existingMembership ? 'selected' : 'created';
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
}
