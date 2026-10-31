import { z } from 'zod';
import type { Environment } from '../../config/env.js';
import type { DiscordClient, DiscordGuild } from './types.js';

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().positive(),
  token_type: z.literal('Bearer'),
});

const userSchema = z
  .object({
    id: z.string().regex(/^\d+$/),
    username: z.string().min(1),
    global_name: z.string().nullable().optional(),
    avatar: z.string().nullable().optional(),
  })
  .transform((user) => ({
    id: user.id,
    username: user.username,
    global_name: user.global_name ?? null,
    avatar: user.avatar ?? null,
  }));

const permissionsSchema = z.union([
  z.string().regex(/^\d+$/),
  z.number().int().nonnegative().safe().transform(String),
]);

const guildsSchema = z
  .array(
    z.object({
      id: z.string().regex(/^\d+$/),
      name: z.string().min(1),
      owner: z.boolean().default(false),
      permissions: permissionsSchema,
      icon: z.string().nullable().optional(),
    }),
  )
  .transform((guilds) =>
    guilds.map((guild) => ({ ...guild, icon: guild.icon ?? null })),
  );

async function discordRequest<T>(
  url: string,
  init: RequestInit,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
): Promise<T> {
  const response = await fetch(url, init);

  if (!response.ok) {
    throw new Error(`Discord request failed with status ${response.status}.`);
  }

  return schema.parse(await response.json());
}

export function createDiscordClient(environment: Environment): DiscordClient {
  return {
    async exchangeCode(code) {
      const body = new URLSearchParams({
        client_id: environment.DISCORD_CLIENT_ID,
        client_secret: environment.DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: environment.DISCORD_REDIRECT_URI,
      });
      const result = await discordRequest(
        'https://discord.com/api/oauth2/token',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body,
        },
        tokenResponseSchema,
      );

      return { accessToken: result.access_token, expiresIn: result.expires_in };
    },
    getUser(accessToken) {
      return discordRequest(
        'https://discord.com/api/users/@me',
        { headers: { Authorization: `Bearer ${accessToken}` } },
        userSchema,
      );
    },
    getGuilds(accessToken) {
      return discordRequest<DiscordGuild[]>(
        'https://discord.com/api/users/@me/guilds',
        { headers: { Authorization: `Bearer ${accessToken}` } },
        guildsSchema,
      );
    },
  };
}
