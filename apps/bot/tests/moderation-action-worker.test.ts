import { createHmac } from 'node:crypto';
import { PermissionFlagsBits } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { ModerationActionWorker } from '../src/transport/moderation-action-worker.js';

const secret = 'secret-for-test';
const action = {
  id: 'action-1',
  guildId: '11111111111111111',
  caseId: 'case-1',
  case: {
    targetDiscordId: '22222222222222222',
    actorDiscordId: '33333333333333333',
    action: 'TIMEOUT',
    reason: 'Repeated disruption.',
    durationSeconds: 300,
  },
};

function createWorker(actorHierarchy: number) {
  const targetTimeout = vi.fn(async () => undefined);
  const actor = {
    id: action.case.actorDiscordId,
    permissions: {
      has: (permission: bigint) =>
        permission === PermissionFlagsBits.ModerateMembers,
    },
    roles: { highest: { comparePositionTo: () => actorHierarchy } },
  };
  const target = {
    id: action.case.targetDiscordId,
    permissions: { has: () => false },
    roles: { highest: { comparePositionTo: () => -1 } },
    timeout: targetTimeout,
  };
  const botMember = {
    id: '44444444444444444',
    permissions: {
      has: (permission: bigint) =>
        permission === PermissionFlagsBits.ModerateMembers,
    },
    roles: { highest: { comparePositionTo: () => 1 } },
  };
  const guild = {
    name: 'Test guild',
    ownerId: '55555555555555555',
    members: {
      me: botMember,
      fetch: async (id: string) => (id === actor.id ? actor : target),
    },
  };
  const requests: RequestInit[] = [];
  const fetchImplementation: typeof fetch = async (_input, init) => {
    if (init) {
      requests.push(init);
    }
    if (requests.length === 1) {
      return Response.json({ actions: [action] });
    }
    return new Response(null, { status: 204 });
  };
  const worker = new ModerationActionWorker({
    client: {
      guilds: { fetch: async () => guild },
    } as never,
    endpoint: 'http://localhost/api/internal/v1/moderation/actions',
    secret,
    fetchImplementation,
  });
  return { worker, targetTimeout, requests };
}

describe('ModerationActionWorker', () => {
  it('executes a timeout only after checking actor and bot permissions and hierarchy', async () => {
    const { worker, targetTimeout, requests } = createWorker(1);
    await worker.poll();

    expect(targetTimeout).toHaveBeenCalledWith(300_000, 'Repeated disruption.');
    expect(requests).toHaveLength(2);
    const headers = new Headers(requests[0]?.headers);
    const timestamp = headers.get('X-Nexus-Timestamp');
    const nonce = headers.get('X-Nexus-Nonce');
    const body = String(requests[0]?.body);
    expect(headers.get('X-Nexus-Signature')).toBe(
      createHmac('sha256', secret)
        .update(
          [
            'nexus-v1',
            timestamp,
            nonce,
            'POST',
            '/api/internal/v1/moderation/actions/claim',
            body,
          ].join('\n'),
        )
        .digest('hex'),
    );
    const resultHeaders = new Headers(requests[1]?.headers);
    expect(resultHeaders.get('X-Nexus-Nonce')).not.toBe(nonce);
    expect(resultHeaders.get('X-Nexus-Signature')).toBe(
      createHmac('sha256', secret)
        .update(
          [
            'nexus-v1',
            resultHeaders.get('X-Nexus-Timestamp'),
            resultHeaders.get('X-Nexus-Nonce'),
            'POST',
            '/api/internal/v1/moderation/actions/action-1/result',
            String(requests[1]?.body),
          ].join('\n'),
        )
        .digest('hex'),
    );
    expect(JSON.parse(String(requests[1]?.body))).toEqual({
      success: true,
      message: 'Action Discord exécutée.',
    });
  });

  it('reports a hierarchy violation without invoking the Discord action', async () => {
    const { worker, targetTimeout, requests } = createWorker(0);
    await worker.poll();

    expect(targetTimeout).not.toHaveBeenCalled();
    expect(JSON.parse(String(requests[1]?.body))).toMatchObject({
      success: false,
      message: 'Le rôle Discord de la cible est supérieur ou égal au vôtre.',
    });
  });
});
