import { PermissionFlagsBits, type Client, type GuildMember } from 'discord.js';
import { createSignedBotHeaders } from './signature.js';

type ModerationAction = 'WARN' | 'TIMEOUT' | 'KICK' | 'BAN';

class NonRetryableApiError extends Error {}

interface QueuedAction {
  id: string;
  guildId: string;
  caseId: string;
  case: {
    targetDiscordId: string;
    actorDiscordId: string;
    action: ModerationAction;
    reason: string;
    durationSeconds: number | null;
  };
}

interface WorkerOptions {
  client: Client;
  endpoint: string;
  secret: string;
  fetchImplementation?: typeof fetch;
  pollIntervalMs?: number;
}

const requiredActorPermissions: Record<ModerationAction, bigint> = {
  WARN: 0n,
  TIMEOUT: PermissionFlagsBits.ModerateMembers,
  KICK: PermissionFlagsBits.KickMembers,
  BAN: PermissionFlagsBits.BanMembers,
};

function isQueuedAction(value: unknown): value is QueuedAction {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const action = value as Partial<QueuedAction>;
  return (
    typeof action.id === 'string' &&
    typeof action.guildId === 'string' &&
    typeof action.caseId === 'string' &&
    !!action.case &&
    typeof action.case.targetDiscordId === 'string' &&
    typeof action.case.actorDiscordId === 'string' &&
    ['WARN', 'TIMEOUT', 'KICK', 'BAN'].includes(action.case.action) &&
    typeof action.case.reason === 'string'
  );
}

export class ModerationActionWorker {
  private readonly fetchImplementation: typeof fetch;
  private readonly pollIntervalMs: number;
  private timer: NodeJS.Timeout | null = null;
  private polling = false;

  constructor(private readonly options: WorkerOptions) {
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.pollIntervalMs = options.pollIntervalMs ?? 5_000;
  }

  start(): void {
    if (this.timer) {
      return;
    }
    this.timer = setInterval(() => {
      void this.poll().catch((error: unknown) => {
        console.error(
          JSON.stringify({
            event: 'moderation_action_poll_failed',
            errorName: error instanceof Error ? error.name : 'UnknownError',
          }),
        );
      });
    }, this.pollIntervalMs);
    this.timer.unref();
    void this.poll().catch((error: unknown) => {
      console.error(
        JSON.stringify({
          event: 'moderation_action_poll_failed',
          errorName: error instanceof Error ? error.name : 'UnknownError',
        }),
      );
    });
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    while (this.polling) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  async poll(): Promise<void> {
    if (this.polling) {
      return;
    }
    this.polling = true;
    try {
      const payload = await this.request('/claim', {});
      if (!payload || typeof payload !== 'object' || !('actions' in payload)) {
        throw new Error('Moderation worker response is invalid.');
      }
      const actions = (payload as { actions: unknown }).actions;
      if (!Array.isArray(actions)) {
        throw new Error('Moderation worker response is invalid.');
      }
      for (const value of actions) {
        if (!isQueuedAction(value)) {
          console.error(JSON.stringify({ event: 'invalid_moderation_action' }));
          continue;
        }
        await this.process(value);
      }
    } finally {
      this.polling = false;
    }
  }

  private async process(job: QueuedAction): Promise<void> {
    let success = false;
    let message = 'L’action n’a pas pu être exécutée.';
    try {
      await this.execute(job);
      success = true;
      message = 'Action Discord exécutée.';
    } catch (error) {
      message = error instanceof Error ? error.message : message;
    }

    try {
      await this.request(`/${encodeURIComponent(job.id)}/result`, {
        success,
        message: message.slice(0, 500),
      });
    } catch (error) {
      console.error(
        JSON.stringify({
          event: 'moderation_action_result_delivery_failed',
          actionId: job.id,
          errorName: error instanceof Error ? error.name : 'UnknownError',
        }),
      );
    }
  }

  private async execute(job: QueuedAction): Promise<void> {
    const guild = await this.options.client.guilds.fetch(job.guildId);
    const [actor, target, botMember] = await Promise.all([
      guild.members.fetch(job.case.actorDiscordId),
      guild.members.fetch(job.case.targetDiscordId),
      guild.members.me
        ? Promise.resolve(guild.members.me)
        : guild.members.fetchMe(),
    ]);

    this.assertHierarchy(guild.ownerId, actor, target, botMember);
    const actorPermission = requiredActorPermissions[job.case.action];
    if (!actor.permissions.has(actorPermission)) {
      throw new Error(
        'L’acteur ne possède plus la permission Discord requise.',
      );
    }

    switch (job.case.action) {
      case 'WARN':
        await target.send(
          `Avertissement sur le serveur ${guild.name} : ${job.case.reason}`,
        );
        return;
      case 'TIMEOUT':
        if (!job.case.durationSeconds) {
          throw new Error('La durée du timeout est invalide.');
        }
        if (!botMember.permissions.has(PermissionFlagsBits.ModerateMembers)) {
          throw new Error(
            'Le bot ne possède pas la permission Discord requise.',
          );
        }
        await target.timeout(job.case.durationSeconds * 1000, job.case.reason);
        return;
      case 'KICK':
        if (!botMember.permissions.has(PermissionFlagsBits.KickMembers)) {
          throw new Error(
            'Le bot ne possède pas la permission Discord requise.',
          );
        }
        await target.kick(job.case.reason);
        return;
      case 'BAN':
        if (!botMember.permissions.has(PermissionFlagsBits.BanMembers)) {
          throw new Error(
            'Le bot ne possède pas la permission Discord requise.',
          );
        }
        await guild.members.ban(target.id, { reason: job.case.reason });
        return;
    }
  }

  private assertHierarchy(
    ownerId: string,
    actor: GuildMember,
    target: GuildMember,
    botMember: GuildMember,
  ): void {
    if (actor.id === target.id) {
      throw new Error(
        'Un membre ne peut pas appliquer une sanction sur lui-même.',
      );
    }
    if (target.id === ownerId || target.id === botMember.id) {
      throw new Error('La hiérarchie Discord interdit cette action.');
    }
    if (
      actor.id !== ownerId &&
      actor.roles.highest.comparePositionTo(target.roles.highest) <= 0
    ) {
      throw new Error(
        'Le rôle Discord de la cible est supérieur ou égal au vôtre.',
      );
    }
    if (botMember.roles.highest.comparePositionTo(target.roles.highest) <= 0) {
      throw new Error('Le bot ne peut pas agir sur un rôle Discord supérieur.');
    }
  }

  private async request(
    suffix: string,
    bodyValue: Record<string, unknown>,
  ): Promise<unknown> {
    const body = JSON.stringify(bodyValue);
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const url = new URL(`${this.options.endpoint}${suffix}`);
      const signatureHeaders = createSignedBotHeaders({
        secret: this.options.secret,
        method: 'POST',
        path: url.pathname,
        body,
        timestamp,
      });
      try {
        const response = await this.fetchImplementation(url.toString(), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...signatureHeaders,
          },
          body,
          signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) {
          const error = new Error(
            `Moderation API request failed with status ${response.status}.`,
          );
          if (response.status < 500 && response.status !== 429) {
            throw new NonRetryableApiError(error.message);
          }
          throw error;
        }
        if (response.status === 204) {
          return null;
        }
        return await response.json();
      } catch (error) {
        if (error instanceof NonRetryableApiError || attempt === 3) {
          throw error;
        }
        await new Promise((resolve) =>
          setTimeout(resolve, 250 * 2 ** (attempt - 1)),
        );
      }
    }
    throw new Error('Moderation API request exhausted its retries.');
  }
}
