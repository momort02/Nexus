import { createHash, createHmac } from 'node:crypto';
import type {
  DiscordBotEvent,
  DiscordMemberActivityEvent,
  DiscordMemberJoinedEvent,
  DiscordMemberLeftEvent,
  DiscordMessageCountEvent,
  DiscordVoiceSessionEvent,
  DiscordGuildMetadataEvent,
} from '@nexus/shared';
import type {
  Guild,
  GuildMember,
  Message,
  MessageReaction,
  PartialMessageReaction,
  PartialUser,
  User,
  VoiceState,
} from 'discord.js';

function hashEventId(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function memberKey(
  guildId: string,
  userId: string,
  analyticsKey: string,
): string {
  return createHmac('sha256', analyticsKey)
    .update(`${guildId}:${userId}`)
    .digest('hex');
}

function activityEvent(
  guildId: string,
  userId: string,
  analyticsKey: string,
  category: DiscordMemberActivityEvent['category'],
  eventId: string,
  occurredAt: Date,
): DiscordMemberActivityEvent {
  return {
    type: 'member.activity',
    eventId: hashEventId(eventId),
    guildId,
    memberKey: memberKey(guildId, userId, analyticsKey),
    category,
    occurredAt: occurredAt.toISOString(),
  };
}

function roleIds(member: GuildMember): string[] {
  return roleNames(member).map(({ id }) => id);
}

function roleNames(member: GuildMember): Array<{ id: string; name: string }> {
  return member.roles.cache
    .filter((role) => role.id !== member.guild.id)
    .map(({ id, name }) => ({ id, name }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function guildMetadataEvent(
  guild: Guild,
  occurredAt = new Date(),
): DiscordGuildMetadataEvent {
  return {
    type: 'guild.metadata',
    eventId: hashEventId(
      `${guild.id}:guild.metadata:${occurredAt.toISOString()}`,
    ),
    guildId: guild.id,
    channels: guild.channels.cache.map(({ id, name }) => ({ id, name })),
    roles: guild.roles.cache
      .filter((role) => role.id !== guild.id)
      .map(({ id, name }) => ({ id, name })),
    occurredAt: occurredAt.toISOString(),
  };
}

export function memberJoinedEvent(
  member: GuildMember,
  occurredAt = new Date(),
): DiscordMemberJoinedEvent {
  const joinedAt = member.joinedAt?.toISOString() ?? occurredAt.toISOString();
  return {
    type: 'member.joined',
    eventId: hashEventId(
      `${member.guild.id}:member.joined:${member.id}:${joinedAt}`,
    ),
    guildId: member.guild.id,
    discordUserId: member.id,
    displayName: member.displayName,
    joinedAt,
    roleIds: roleIds(member),
    roleNames: roleNames(member),
    occurredAt: occurredAt.toISOString(),
  };
}

export function memberLeftEvent(
  member: Pick<GuildMember, 'guild' | 'id'>,
  occurredAt = new Date(),
): DiscordMemberLeftEvent {
  const minuteBucket = Math.floor(occurredAt.getTime() / 60_000);
  return {
    type: 'member.left',
    eventId: hashEventId(
      `${member.guild.id}:member.left:${member.id}:${minuteBucket}`,
    ),
    guildId: member.guild.id,
    discordUserId: member.id,
    occurredAt: occurredAt.toISOString(),
  };
}

export function memberSnapshotEvent(
  member: GuildMember,
  occurredAt = new Date(),
): DiscordBotEvent {
  const joinedAt = member.joinedAt?.toISOString() ?? occurredAt.toISOString();
  return {
    type: 'member.snapshot',
    eventId: hashEventId(
      `${member.guild.id}:member.snapshot:${member.id}:${joinedAt}:${occurredAt.toISOString()}`,
    ),
    guildId: member.guild.id,
    discordUserId: member.id,
    displayName: member.displayName,
    joinedAt,
    roleIds: roleIds(member),
    roleNames: roleNames(member),
    occurredAt: occurredAt.toISOString(),
  };
}

export function messageCountEvent(
  message: {
    id: string;
    guildId: string | null;
    guild: {
      id: string;
      channels?: {
        cache: {
          get(channelId: string): { name: string } | undefined;
        };
      };
    } | null;
    channelId: string | null;
    author: { bot: boolean; id: string };
    webhookId?: string | null;
    system?: boolean;
    createdAt: Date;
  },
  analyticsKey: string,
): DiscordMessageCountEvent | null {
  if (
    !message.guildId ||
    !message.guild ||
    !message.channelId ||
    message.author.bot ||
    message.webhookId ||
    message.system
  ) {
    return null;
  }

  const occurredAt = message.createdAt;
  const bucketStart = new Date(
    Date.UTC(
      occurredAt.getUTCFullYear(),
      occurredAt.getUTCMonth(),
      occurredAt.getUTCDate(),
      occurredAt.getUTCHours(),
    ),
  );
  return {
    type: 'message.count',
    eventId: hashEventId(`message:${message.id}`),
    guildId: message.guildId,
    channelId: message.channelId,
    ...(message.guild.channels?.cache.get(message.channelId)?.name
      ? {
          channelName: message.guild.channels.cache.get(message.channelId)
            ?.name,
        }
      : {}),
    memberKey: memberKey(message.guildId, message.author.id, analyticsKey),
    bucketStart: bucketStart.toISOString(),
    occurredAt: occurredAt.toISOString(),
  };
}

export function createLifecycleHandlers(
  emit: (event: DiscordBotEvent) => void,
  analyticsKey: string,
) {
  const voiceSessionStarts = new Map<string, Date>();
  return {
    guildMetadata(guild: Guild): void {
      emit(guildMetadataEvent(guild));
    },
    memberAdd(member: GuildMember, occurredAt?: Date): void {
      emit(memberJoinedEvent(member, occurredAt));
    },
    memberRemove(
      member: Pick<GuildMember, 'guild' | 'id'>,
      occurredAt?: Date,
    ): void {
      emit(memberLeftEvent(member, occurredAt));
    },
    memberUpdate(member: GuildMember): void {
      if (!member.user.bot) {
        emit(memberSnapshotEvent(member));
      }
    },
    messageCreate(message: Message): void {
      const event = messageCountEvent(message, analyticsKey);
      if (event) {
        emit(event);
      }
    },
    command(
      guildId: string | null,
      user: User,
      interactionId: string,
      occurredAt = new Date(),
    ): void {
      if (guildId && !user.bot) {
        emit(
          activityEvent(
            guildId,
            user.id,
            analyticsKey,
            'command',
            `command:${interactionId}`,
            occurredAt,
          ),
        );
      }
    },
    reactionAdd(
      reaction: MessageReaction | PartialMessageReaction,
      user: User | PartialUser,
      occurredAt = new Date(),
    ): void {
      const guildId = reaction.message.guildId;
      if (!guildId || user.bot) {
        return;
      }
      emit(
        activityEvent(
          guildId,
          user.id,
          analyticsKey,
          'reaction',
          `reaction:${guildId}:${user.id}:${reaction.message.id}:${reaction.emoji.id ?? reaction.emoji.name ?? ''}:${Math.floor(occurredAt.getTime() / 60_000)}`,
          occurredAt,
        ),
      );
    },
    voiceStateUpdate(oldState: VoiceState, newState: VoiceState): void {
      const guildId = newState.guild.id;
      const member = newState.member ?? oldState.member;
      if (!member || member.user.bot) {
        return;
      }

      const sessionKey = `${guildId}:${member.id}`;
      if (!oldState.channelId && newState.channelId) {
        const startedAt = new Date();
        voiceSessionStarts.set(sessionKey, startedAt);
        emit(
          activityEvent(
            guildId,
            member.id,
            analyticsKey,
            'voice',
            `voice-start:${sessionKey}:${startedAt.toISOString()}`,
            startedAt,
          ),
        );
      } else if (oldState.channelId && !newState.channelId) {
        const startedAt = voiceSessionStarts.get(sessionKey);
        voiceSessionStarts.delete(sessionKey);
        if (startedAt) {
          const endedAt = new Date();
          const event: DiscordVoiceSessionEvent = {
            type: 'voice.session',
            eventId: hashEventId(
              `voice-session:${sessionKey}:${startedAt.toISOString()}`,
            ),
            guildId,
            memberKey: memberKey(guildId, member.id, analyticsKey),
            startedAt: startedAt.toISOString(),
            endedAt: endedAt.toISOString(),
            occurredAt: endedAt.toISOString(),
          };
          emit(event);
        }
      }
    },
  };
}
