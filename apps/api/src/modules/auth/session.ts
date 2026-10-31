import { timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { AuthRepository, AuthSession } from './types.js';
import { hashSessionToken } from './crypto.js';

export const SESSION_COOKIE = 'nexus_session';
export const OAUTH_STATE_COOKIE = 'nexus_oauth_state';
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function readCookieHeader(
  cookieHeader: string | undefined,
  name: string,
): string | null {
  const cookies = cookieHeader?.split(';') ?? [];
  const entry = cookies.find((cookie) => cookie.trim().startsWith(`${name}=`));

  if (!entry) {
    return null;
  }

  try {
    return decodeURIComponent(entry.trim().slice(name.length + 1));
  } catch {
    return null;
  }
}

export function readCookie(request: Request, name: string): string | null {
  return readCookieHeader(request.headers.cookie, name);
}

export function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

export function createRequireSameOrigin(allowedOrigin: string) {
  return function requireSameOrigin(
    request: Request,
    response: Response,
    next: NextFunction,
  ): void {
    if (request.get('origin') !== allowedOrigin) {
      response.status(403).json({
        error: {
          code: 'invalid_origin',
          message: 'The request origin could not be verified.',
          requestId: response.locals.requestId,
        },
      });
      return;
    }

    next();
  };
}

declare global {
  // Express locals are the typed request-scoped storage used by these middleware.
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Locals {
      authSession: AuthSession;
    }
  }
}

export function createRequireSession(repository: AuthRepository) {
  return async function requireSession(
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> {
    const token = readCookie(request, SESSION_COOKIE);

    if (!token) {
      response.status(401).json({
        error: {
          code: 'authentication_required',
          message: 'Authentication is required.',
          requestId: response.locals.requestId,
        },
      });
      return;
    }

    const session = await repository.findSession(hashSessionToken(token));

    if (!session || session.expiresAt <= new Date()) {
      if (session) {
        await repository.deleteSession(session.id);
      }
      response.clearCookie(SESSION_COOKIE);
      response.status(401).json({
        error: {
          code: 'authentication_required',
          message: 'Authentication is required.',
          requestId: response.locals.requestId,
        },
      });
      return;
    }

    if (
      session.accessTokenExpiresAt &&
      session.accessTokenExpiresAt <= new Date()
    ) {
      await repository.clearAccessToken(session.id);
      session.encryptedAccessToken = null;
      session.accessTokenExpiresAt = null;
    }

    response.locals.authSession = session;
    next();
  };
}

export function createRequireGuildAccess(repository: AuthRepository) {
  return async function requireGuildAccess(
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> {
    const session = response.locals.authSession;
    const guildId = request.params.guildId;

    if (!session || typeof guildId !== 'string') {
      response.status(403).json({
        error: {
          code: 'guild_access_denied',
          message: 'You do not have access to this server.',
          requestId: response.locals.requestId,
        },
      });
      return;
    }

    const membership = await repository.getMembership(session.userId, guildId);

    if (!membership) {
      response.status(403).json({
        error: {
          code: 'guild_access_denied',
          message: 'You do not have access to this server.',
          requestId: response.locals.requestId,
        },
      });
      return;
    }

    response.locals.guildMembership = membership;
    next();
  };
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Locals {
      guildMembership?: { id: string; name: string; role: string };
    }
  }
}
