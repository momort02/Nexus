import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { ApiError } from '../../http/api-error.js';
import { createBotRequestAuthentication } from '../../http/bot-signature.js';
import type { BotIngestionRepository } from './types.js';

const discordIdSchema = z.string().regex(/^\d{17,20}$/);
const eventBase = {
  eventId: z.string().regex(/^[\da-f]{64}$/),
  guildId: discordIdSchema,
  occurredAt: z.string().datetime({ offset: true }),
};
const botEventSchema = z.discriminatedUnion('type', [
  z.object({
    ...eventBase,
    type: z.literal('message.count'),
    channelId: discordIdSchema,
    memberKey: z.string().regex(/^[\da-f]{64}$/),
    bucketStart: z.string().datetime({ offset: true }),
  }),
  z.object({
    ...eventBase,
    type: z.literal('member.activity'),
    memberKey: z.string().regex(/^[\da-f]{64}$/),
    category: z.enum(['command', 'reaction', 'voice']),
  }),
  z.object({
    ...eventBase,
    type: z.literal('voice.session'),
    memberKey: z.string().regex(/^[\da-f]{64}$/),
    startedAt: z.string().datetime({ offset: true }),
    endedAt: z.string().datetime({ offset: true }),
  }),
  z.object({
    ...eventBase,
    type: z.literal('member.joined'),
    discordUserId: discordIdSchema,
    displayName: z.string().trim().min(1).max(128).nullable().optional(),
    joinedAt: z.string().datetime({ offset: true }).nullable(),
    roleIds: z.array(discordIdSchema).max(250),
  }),
  z.object({
    ...eventBase,
    type: z.literal('member.left'),
    discordUserId: discordIdSchema,
  }),
  z.object({
    ...eventBase,
    type: z.literal('member.snapshot'),
    discordUserId: discordIdSchema,
    displayName: z.string().trim().min(1).max(128).nullable().optional(),
    joinedAt: z.string().datetime({ offset: true }).nullable(),
    roleIds: z.array(discordIdSchema).max(250),
  }),
]);
const validatedBotEventSchema = botEventSchema.superRefine((event, context) => {
  if (event.type !== 'voice.session') {
    return;
  }
  const duration =
    new Date(event.endedAt).getTime() - new Date(event.startedAt).getTime();
  if (duration <= 0 || duration > 7 * 24 * 60 * 60 * 1000) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Voice session duration must be between zero and seven days.',
    });
  }
});
const batchSchema = z.object({
  events: z.array(validatedBotEventSchema).min(1).max(100),
});

export function createBotIngestionRouter(options: {
  repository: BotIngestionRepository;
  secret: string;
  publishGuildEvent?: (guildId: string) => void | Promise<void>;
}): Router {
  const router = Router();
  router.post(
    '/',
    rateLimit({
      windowMs: 60_000,
      limit: 120,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
    }),
    createBotRequestAuthentication({
      secret: options.secret,
      consumeNonce: (nonce, expiresAt) =>
        options.repository.consumeRequestNonce(nonce, expiresAt),
    }),
    async (request, response) => {
      const parsed = batchSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ApiError(
          400,
          'invalid_bot_event_batch',
          'The bot event batch is invalid.',
        );
      }

      let processed = 0;
      let duplicates = 0;
      let ignored = 0;
      const updatedGuildIds = new Set<string>();
      for (const event of parsed.data.events) {
        const result = await options.repository.ingest(event);
        if (result === 'unknown-guild') {
          ignored += 1;
        } else if (result === 'processed') {
          processed += 1;
          updatedGuildIds.add(event.guildId);
        } else {
          duplicates += 1;
        }
      }
      response.on('finish', () => {
        for (const guildId of updatedGuildIds) {
          void Promise.resolve(options.publishGuildEvent?.(guildId)).catch(
            (error: unknown) => {
              console.error('Realtime event delivery failed.', {
                requestId: response.locals.requestId,
                errorName: error instanceof Error ? error.name : 'UnknownError',
              });
            },
          );
        }
      });
      response.status(202).json({ processed, duplicates, ignored });
    },
  );
  return router;
}
