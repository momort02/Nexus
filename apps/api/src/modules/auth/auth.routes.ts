import { randomBytes } from 'node:crypto';
import { Router, type Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import type { Environment } from '../../config/env.js';
import {
  decryptAccessToken,
  encryptAccessToken,
  hashSessionToken,
  createSessionToken,
} from './crypto.js';
import type { AuthRepository, DiscordClient } from './types.js';
import {
  OAUTH_STATE_COOKIE,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  createRequireSession,
  createRequireSameOrigin,
  readCookie,
  safeEqual,
} from './session.js';

const callbackQuerySchema = z.object({
  code: z.string().min(1).max(2048),
  state: z.string().regex(/^[\da-f]{64}$/),
});

const guildIdSchema = z.string().regex(/^\d{17,20}$/);
const MANAGE_GUILD_PERMISSION = 1n << 5n;
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const CALLBACK_PATH = '/api/v1/auth/discord/callback';

interface AuthRouteDependencies {
  repository: AuthRepository;
  discord: DiscordClient;
  environment: Environment;
}

function isSecure(environment: Environment): boolean {
  return environment.NODE_ENV === 'production';
}

function setSessionCookie(
  response: Response,
  token: string,
  environment: Environment,
): void {
  response.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isSecure(environment),
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_MS,
  });
}

function clearSessionCookie(
  response: Response,
  environment: Environment,
): void {
  response.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    secure: isSecure(environment),
    sameSite: 'lax',
    path: '/',
  });
}

function hasManageGuild(permissions: string): boolean {
  try {
    return (BigInt(permissions) & MANAGE_GUILD_PERMISSION) !== 0n;
  } catch {
    return false;
  }
}

export function createAuthRouter({
  repository,
  discord,
  environment,
}: AuthRouteDependencies): Router {
  const router = Router();
  const requireSession = createRequireSession(repository);
  const requireSameOrigin = createRequireSameOrigin(environment.APP_ORIGIN);
  const sensitiveLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
  });

  router.get('/auth/discord', sensitiveLimit, (_request, response) => {
    const state = randomBytes(32).toString('hex');
    response.cookie(OAUTH_STATE_COOKIE, state, {
      httpOnly: true,
      secure: isSecure(environment),
      sameSite: 'lax',
      path: CALLBACK_PATH,
      maxAge: OAUTH_STATE_TTL_MS,
    });

    const authorizationUrl = new URL('https://discord.com/oauth2/authorize');
    authorizationUrl.search = new URLSearchParams({
      client_id: environment.DISCORD_CLIENT_ID,
      redirect_uri: environment.DISCORD_REDIRECT_URI,
      response_type: 'code',
      scope: 'identify guilds',
      state,
    }).toString();

    response.redirect(302, authorizationUrl.toString());
  });

  router.get(
    '/auth/discord/callback',
    sensitiveLimit,
    async (request, response) => {
      const callback = callbackQuerySchema.safeParse(request.query);
      const stateCookie = readCookie(request, OAUTH_STATE_COOKIE);
      response.clearCookie(OAUTH_STATE_COOKIE, {
        httpOnly: true,
        secure: isSecure(environment),
        sameSite: 'lax',
        path: CALLBACK_PATH,
      });

      if (
        !callback.success ||
        !stateCookie ||
        !safeEqual(callback.data.state, stateCookie)
      ) {
        response.status(400).json({
          error: {
            code: 'invalid_oauth_state',
            message: 'The Discord sign-in request could not be verified.',
            requestId: response.locals.requestId,
          },
        });
        return;
      }

      const { accessToken, expiresIn } = await discord.exchangeCode(
        callback.data.code,
      );
      const discordUser = await discord.getUser(accessToken);
      const user = await repository.upsertUser({
        discordId: discordUser.id,
        username: discordUser.username,
        globalName: discordUser.global_name ?? null,
        avatar: discordUser.avatar ?? null,
      });
      const sessionToken = createSessionToken();
      const now = new Date();
      await repository.createSession({
        id: hashSessionToken(sessionToken),
        userId: user.id,
        encryptedAccessToken: encryptAccessToken(
          accessToken,
          environment.OAUTH_ENCRYPTION_KEY,
        ),
        accessTokenExpiresAt: new Date(now.getTime() + expiresIn * 1000),
        expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
      });

      setSessionCookie(response, sessionToken, environment);
      response.redirect(302, environment.APP_ORIGIN);
    },
  );

  router.post(
    '/auth/logout',
    sensitiveLimit,
    requireSameOrigin,
    async (request, response) => {
      const token = readCookie(request, SESSION_COOKIE);
      if (token) {
        await repository.deleteSession(hashSessionToken(token));
      }

      clearSessionCookie(response, environment);
      response.status(204).end();
    },
  );

  router.get('/me', requireSession, (_request, response) => {
    const { user, selectedGuildId } = response.locals.authSession;
    response.json({ user, selectedGuildId });
  });

  router.get('/guilds', requireSession, async (_request, response) => {
    const guilds = await repository.listMemberships(
      response.locals.authSession.userId,
    );
    response.json({ guilds });
  });

  router.get(
    '/guilds/available',
    requireSession,
    async (_request, response) => {
      const session = response.locals.authSession;

      if (!session.encryptedAccessToken || !session.accessTokenExpiresAt) {
        response.status(401).json({
          error: {
            code: 'discord_reauth_required',
            message: 'Sign in with Discord again to refresh the server list.',
            requestId: response.locals.requestId,
          },
        });
        return;
      }

      const accessToken = decryptAccessToken(
        session.encryptedAccessToken,
        environment.OAUTH_ENCRYPTION_KEY,
      );
      const guilds = await discord.getGuilds(accessToken);
      response.json({
        guilds: guilds.map(({ id, name, icon, owner, permissions }) => ({
          id,
          name,
          icon,
          owner,
          canCreateNexus: owner || hasManageGuild(permissions),
        })),
      });
    },
  );

  router.post(
    '/guilds/:guildId/select',
    requireSession,
    requireSameOrigin,
    async (request, response) => {
      const parsedGuildId = guildIdSchema.safeParse(request.params.guildId);

      if (!parsedGuildId.success) {
        response.status(400).json({
          error: {
            code: 'invalid_guild_id',
            message: 'The server identifier is invalid.',
            requestId: response.locals.requestId,
          },
        });
        return;
      }

      const session = response.locals.authSession;
      if (!session.encryptedAccessToken || !session.accessTokenExpiresAt) {
        response.status(401).json({
          error: {
            code: 'discord_reauth_required',
            message: 'Sign in with Discord again to select a server.',
            requestId: response.locals.requestId,
          },
        });
        return;
      }

      const existingMembership = await repository.getMembership(
        session.userId,
        parsedGuildId.data,
      );
      const accessToken = decryptAccessToken(
        session.encryptedAccessToken,
        environment.OAUTH_ENCRYPTION_KEY,
      );
      const discordGuilds = await discord.getGuilds(accessToken);
      const discordGuild = discordGuilds.find(
        (guild) => guild.id === parsedGuildId.data,
      );

      if (
        !discordGuild ||
        (!existingMembership &&
          !hasManageGuild(discordGuild.permissions) &&
          !discordGuild.owner)
      ) {
        response.status(403).json({
          error: {
            code: 'guild_access_denied',
            message: 'You cannot add or select this server.',
            requestId: response.locals.requestId,
          },
        });
        return;
      }

      const result = await repository.createOrSelectGuild(
        session.userId,
        discordGuild,
        session.id,
      );

      if (result === 'not-authorized') {
        response.status(403).json({
          error: {
            code: 'guild_access_denied',
            message: 'You do not have access to this Nexus server.',
            requestId: response.locals.requestId,
          },
        });
        return;
      }

      response.json({
        selectedGuildId: discordGuild.id,
        created: result === 'created',
      });
    },
  );

  return router;
}
