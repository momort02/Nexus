import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { ApiError } from '../http/api-error.js';
import { hashSessionToken } from '../modules/auth/crypto.js';
import type { AuthRepository } from '../modules/auth/types.js';
import { readCookieHeader, SESSION_COOKIE } from '../modules/auth/session.js';
import type { AuthorizationService } from '../modules/permissions/authorization.service.js';
import type { Environment } from '../config/env.js';

const GUILD_ID_PATTERN = /^\d{17,20}$/;

interface RealtimeSocketData extends Record<string, unknown> {
  userId: string;
  sessionId: string;
  guildId?: string;
}

interface ClientEvents {
  'guild:subscribe': (
    guildId: string,
    acknowledge: (result: { ok: boolean }) => void,
  ) => void;
  'guild:unsubscribe': () => void;
}

interface ServerEvents {
  'guild:updated': () => void;
}

type InterServerEvents = Record<never, never>;

export function createRealtimeServer(
  server: HttpServer,
  dependencies: {
    authRepository: AuthRepository;
    authorization: AuthorizationService;
    environment: Environment;
  },
) {
  const io = new Server<
    ClientEvents,
    ServerEvents,
    InterServerEvents,
    RealtimeSocketData
  >(server, {
    cors: {
      origin: dependencies.environment.APP_ORIGIN,
      credentials: true,
    },
    allowRequest: (request, callback) => {
      const origin = request.headers.origin;
      const isSameOriginBrowserRequest =
        !origin && request.headers['sec-fetch-site'] === 'same-origin';
      callback(
        null,
        origin === dependencies.environment.APP_ORIGIN ||
          isSameOriginBrowserRequest,
      );
    },
  });

  io.use(async (socket, next) => {
    const token = readCookieHeader(
      socket.request.headers.cookie,
      SESSION_COOKIE,
    );
    if (!token) {
      next(new Error('authentication_required'));
      return;
    }

    try {
      const session = await dependencies.authRepository.findSession(
        hashSessionToken(token),
      );
      if (!session || session.expiresAt <= new Date()) {
        next(new Error('authentication_required'));
        return;
      }
      socket.data.userId = session.userId;
      socket.data.sessionId = session.id;
      next();
    } catch (error) {
      next(error instanceof Error ? error : new Error('authentication_failed'));
    }
  });

  io.on('connection', (socket) => {
    socket.on('guild:subscribe', async (guildId, acknowledge) => {
      if (typeof guildId !== 'string' || !GUILD_ID_PATTERN.test(guildId)) {
        acknowledge({ ok: false });
        return;
      }

      try {
        const membership = await dependencies.authRepository.getMembership(
          socket.data.userId,
          guildId,
        );
        if (!membership) {
          acknowledge({ ok: false });
          return;
        }
        await dependencies.authorization.assertPermission(
          socket.data.userId,
          guildId,
          'dashboard.view',
        );
        const previousGuildId = socket.data.guildId;
        if (previousGuildId && previousGuildId !== guildId) {
          await socket.leave(`guild:${previousGuildId}`);
        }
        await socket.join(`guild:${guildId}`);
        socket.data.guildId = guildId;
        acknowledge({ ok: true });
      } catch (error) {
        if (!(error instanceof ApiError) || error.status >= 500) {
          console.error('Realtime subscription failed.', {
            userId: socket.data.userId,
            guildId,
            errorName: error instanceof Error ? error.name : 'UnknownError',
          });
        }
        acknowledge({ ok: false });
      }
    });

    socket.on('guild:unsubscribe', async () => {
      const guildId = socket.data.guildId;
      if (guildId) {
        await socket.leave(`guild:${guildId}`);
        delete socket.data.guildId;
      }
    });
  });

  return {
    io,
    async publishGuildEvent(guildId: string): Promise<void> {
      const room = io.in(`guild:${guildId}`);
      const sockets = await room.fetchSockets();
      for (const socket of sockets) {
        try {
          const session = await dependencies.authRepository.findSession(
            socket.data.sessionId,
          );
          const membership = await dependencies.authRepository.getMembership(
            socket.data.userId,
            guildId,
          );
          if (
            !session ||
            session.expiresAt <= new Date() ||
            !membership ||
            !(await dependencies.authorization.hasPermission(
              socket.data.userId,
              guildId,
              'dashboard.view',
            ))
          ) {
            await socket.leave(`guild:${guildId}`);
            continue;
          }
          socket.emit('guild:updated');
        } catch (error) {
          console.error('Realtime authorization check failed.', {
            userId: socket.data.userId,
            guildId,
            errorName: error instanceof Error ? error.name : 'UnknownError',
          });
          await socket.leave(`guild:${guildId}`);
        }
      }
    },
  };
}
