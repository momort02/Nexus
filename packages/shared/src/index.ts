export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
    requestId: string;
  };
}

export interface DiscordBotEventBase {
  eventId: string;
  guildId: string;
  occurredAt: string;
}

export interface DiscordMessageCountEvent extends DiscordBotEventBase {
  type: 'message.count';
  channelId: string;
  memberKey: string;
  bucketStart: string;
}

export interface DiscordMemberActivityEvent extends DiscordBotEventBase {
  type: 'member.activity';
  memberKey: string;
  category: 'command' | 'reaction' | 'voice';
}

export interface DiscordVoiceSessionEvent extends DiscordBotEventBase {
  type: 'voice.session';
  memberKey: string;
  startedAt: string;
  endedAt: string;
}

export interface DiscordMemberJoinedEvent extends DiscordBotEventBase {
  type: 'member.joined';
  discordUserId: string;
  displayName?: string | null | undefined;
  joinedAt: string | null;
  roleIds: string[];
}

export interface DiscordMemberLeftEvent extends DiscordBotEventBase {
  type: 'member.left';
  discordUserId: string;
}

export interface DiscordMemberSnapshotEvent extends DiscordBotEventBase {
  type: 'member.snapshot';
  discordUserId: string;
  displayName?: string | null | undefined;
  joinedAt: string | null;
  roleIds: string[];
}

export type DiscordBotEvent =
  | DiscordMessageCountEvent
  | DiscordMemberActivityEvent
  | DiscordVoiceSessionEvent
  | DiscordMemberJoinedEvent
  | DiscordMemberLeftEvent
  | DiscordMemberSnapshotEvent;

export interface DiscordBotEventBatch {
  events: DiscordBotEvent[];
}
