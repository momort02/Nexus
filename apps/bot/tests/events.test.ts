import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { DiscordBotEvent } from '@nexus/shared';
import {
  createLifecycleHandlers,
  memberJoinedEvent,
  memberLeftEvent,
  memberSnapshotEvent,
  messageCountEvent,
} from '../src/events/handlers.js';
import { ApiEventTransport } from '../src/transport/api-event-transport.js';

const messageFixture = {
  id: '12345678901234567',
  guildId: '11111111111111111',
  guild: { id: '11111111111111111' },
  channelId: '22222222222222222',
  author: { bot: false, id: '33333333333333333' },
  createdAt: new Date('2026-10-31T10:59:59.000Z'),
  content: 'must never be collected',
};

const event: DiscordBotEvent = {
  type: 'message.count',
  eventId: 'a'.repeat(64),
  guildId: messageFixture.guildId,
  channelId: messageFixture.channelId,
  memberKey: createHmac('sha256', 'test-secret')
    .update(`${messageFixture.guildId}:${messageFixture.author.id}`)
    .digest('hex'),
  bucketStart: '2026-10-31T10:00:00.000Z',
  occurredAt: messageFixture.createdAt.toISOString(),
};

describe('bot event handlers', () => {
  it('creates UTC hourly aggregates without including message content', () => {
    const aggregate = messageCountEvent(messageFixture, 'test-secret');
    expect(aggregate).toMatchObject({
      ...event,
      eventId: expect.stringMatching(/^[\da-f]{64}$/),
    });
    expect(aggregate).not.toHaveProperty('content');
    expect(aggregate).not.toHaveProperty('messageId');
  });

  it('ignores messages without a guild or from bots', () => {
    expect(
      messageCountEvent({ ...messageFixture, guildId: null }, 'test-secret'),
    ).toBeNull();
    expect(
      messageCountEvent(
        { ...messageFixture, author: { ...messageFixture.author, bot: true } },
        'test-secret',
      ),
    ).toBeNull();
  });

  it('emits lifecycle events through the shared handler', () => {
    const emit = vi.fn();
    const handlers = createLifecycleHandlers(emit, 'test-secret');
    handlers.messageCreate(messageFixture as never);
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        ...event,
        eventId: expect.stringMatching(/^[\da-f]{64}$/),
      }),
    );
  });

  it('creates deduplicable member join and leave events', () => {
    const guildId = '11111111111111111';
    const userId = '33333333333333333';
    const occurredAt = new Date('2026-10-31T10:01:00.000Z');
    const member = {
      id: userId,
      displayName: 'Amaury',
      user: { bot: false },
      guild: { id: guildId },
      joinedAt: new Date('2026-10-30T12:00:00.000Z'),
      roles: {
        cache: {
          filter: (predicate: (role: { id: string }) => boolean) =>
            [{ id: guildId }, { id: '44444444444444444' }].filter(predicate),
        },
      },
    } as never;
    const joined = memberJoinedEvent(member, occurredAt);
    expect(joined).toMatchObject({
      type: 'member.joined',
      guildId,
      discordUserId: userId,
      displayName: 'Amaury',
      roleIds: ['44444444444444444'],
    });
    expect(memberJoinedEvent(member, occurredAt).eventId).toBe(joined.eventId);

    const departingMember = { id: userId, guild: { id: guildId } };
    const left = memberLeftEvent(departingMember, occurredAt);
    expect(
      memberLeftEvent(departingMember, new Date(occurredAt.getTime() + 1000))
        .eventId,
    ).toBe(left.eventId);

    const snapshot = memberSnapshotEvent(member, occurredAt);
    expect(snapshot).toMatchObject({
      type: 'member.snapshot',
      discordUserId: userId,
      displayName: 'Amaury',
    });
    expect(
      memberSnapshotEvent(member, new Date(occurredAt.getTime() + 1000))
        .eventId,
    ).not.toBe(snapshot.eventId);

    const emit = vi.fn();
    createLifecycleHandlers(emit, 'test-secret').memberUpdate(member);
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'member.snapshot',
        discordUserId: userId,
        displayName: 'Amaury',
      }),
    );
  });

  it('counts slash commands, reaction additions, and observed voice sessions', () => {
    const emit = vi.fn();
    const handlers = createLifecycleHandlers(emit, 'test-secret');
    const user = { id: '33333333333333333', bot: false };
    const guildId = '11111111111111111';
    handlers.command(guildId, user as never, '77777777777777777');
    handlers.reactionAdd(
      {
        message: { guildId, id: '88888888888888888' },
        emoji: { id: '99999999999999999', name: 'wave' },
      } as never,
      user as never,
    );
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'member.activity', category: 'command' }),
    );
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'member.activity',
        category: 'reaction',
      }),
    );
    const activities = emit.mock.calls
      .map(([value]) => value)
      .filter((value) => value.type === 'member.activity');
    expect(activities).toHaveLength(2);
    for (const activity of activities) {
      expect(activity.memberKey).toMatch(/^[\da-f]{64}$/);
      expect(activity).not.toHaveProperty('discordUserId');
    }

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-31T10:00:00.000Z'));
    const oldState = {
      guild: { id: guildId },
      member: { id: user.id, user },
      channelId: null,
    } as never;
    const inVoice = {
      guild: { id: guildId },
      member: { id: user.id, user },
      channelId: '55555555555555555',
    } as never;
    handlers.voiceStateUpdate(oldState, inVoice);
    vi.setSystemTime(new Date('2026-10-31T10:02:00.000Z'));
    handlers.voiceStateUpdate(inVoice, oldState);
    vi.useRealTimers();
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'member.activity', category: 'voice' }),
    );
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'voice.session',
        startedAt: '2026-10-31T10:00:00.000Z',
        endedAt: '2026-10-31T10:02:00.000Z',
      }),
    );
  });
});

describe('API event transport', () => {
  it('deduplicates queued events and retries transient failures with a signature', async () => {
    const statuses = [503, 202];
    const requests: RequestInit[] = [];
    const fetchImplementation: typeof fetch = async (_input, init) => {
      if (init) {
        requests.push(init);
      }
      return new Response('', { status: statuses.shift() });
    };
    const transport = new ApiEventTransport({
      endpoint: 'http://localhost/api/internal/v1/discord/events',
      secret: 'test-secret',
      fetchImplementation,
      sleep: async () => undefined,
      now: () => Date.parse('2026-10-31T10:00:00.000Z'),
    });

    transport.enqueue(event);
    transport.enqueue(event);
    await transport.flush();
    await transport.close();

    expect(requests).toHaveLength(2);
    const first = requests[0];
    const second = requests[1];
    expect(first?.body).toBe(JSON.stringify({ events: [event] }));
    const headers = new Headers(first?.headers);
    const timestamp = headers.get('X-Nexus-Timestamp');
    const nonce = headers.get('X-Nexus-Nonce');
    const signature = headers.get('X-Nexus-Signature');
    expect(timestamp).toBe('1793440800');
    expect(nonce).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(signature).toBe(
      createHmac('sha256', 'test-secret')
        .update(
          [
            'nexus-v1',
            timestamp,
            nonce,
            'POST',
            '/api/internal/v1/discord/events',
            first?.body,
          ].join('\n'),
        )
        .digest('hex'),
    );
    expect(new Headers(second?.headers).get('X-Nexus-Nonce')).not.toBe(nonce);
  });

  it('stops after the configured bounded retry count', async () => {
    const statuses = [503, 503, 503, 202];
    const fetchImplementation = vi.fn<typeof fetch>(
      async () => new Response('', { status: statuses.shift() }),
    );
    const transport = new ApiEventTransport({
      endpoint: 'http://localhost/api/internal/v1/discord/events',
      secret: 'test-secret',
      fetchImplementation,
      sleep: async () => undefined,
    });
    transport.enqueue(event);

    await expect(transport.flush()).rejects.toThrow('failed after 3 attempts');
    expect(fetchImplementation).toHaveBeenCalledTimes(3);
    await transport.flush();
    expect(fetchImplementation).toHaveBeenCalledTimes(4);
    await transport.close();
  });
});
