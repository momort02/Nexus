import type { DiscordBotEvent } from '@nexus/shared';

export interface BotIngestionRepository {
  consumeRequestNonce(nonce: string, expiresAt: Date): Promise<boolean>;
  ingest(
    event: DiscordBotEvent,
  ): Promise<'processed' | 'duplicate' | 'unknown-guild'>;
}

export interface BotEventPayload {
  events: DiscordBotEvent[];
}
