import { createServer } from 'node:http';
import { PrismaClient } from '@prisma/client';
import { createApp } from './app.js';
import { parseEnvironment } from './config/env.js';
import { createDiscordClient } from './modules/auth/discord-client.js';
import { PrismaAuthRepository } from './modules/auth/prisma-auth.repository.js';
import { PrismaRbacRepository } from './modules/permissions/prisma-rbac.repository.js';
import { PrismaBotIngestionRepository } from './modules/bot-ingestion/prisma-bot-ingestion.repository.js';
import { PrismaAnalyticsRepository } from './modules/analytics/prisma-analytics.repository.js';
import { PrismaStaffModerationRepository } from './modules/staff-moderation/prisma-staff-moderation.repository.js';
import { AuthorizationService } from './modules/permissions/authorization.service.js';
import { createRealtimeServer } from './realtime/socket.js';

const environment = parseEnvironment(process.env);
const prisma = new PrismaClient({
  datasourceUrl: environment.DATABASE_URL,
});
const repository = new PrismaAuthRepository(prisma);
const rbacRepository = new PrismaRbacRepository(prisma);
const botIngestionRepository = new PrismaBotIngestionRepository(prisma);
const analyticsRepository = new PrismaAnalyticsRepository(prisma);
const staffModerationRepository = new PrismaStaffModerationRepository(prisma);
const authorization = new AuthorizationService(rbacRepository);
let publishGuildEvent: (guildId: string) => Promise<void> = async () => {};
const app = createApp({
  repository,
  rbacRepository,
  botIngestionRepository,
  botApiSecret: environment.BOT_API_SECRET,
  analyticsRepository,
  staffModerationRepository,
  discord: createDiscordClient(environment),
  environment,
  publishGuildEvent: (guildId) => publishGuildEvent(guildId),
});
const server = createServer(app);
const realtime = createRealtimeServer(server, {
  authRepository: repository,
  authorization,
  environment,
});
publishGuildEvent = realtime.publishGuildEvent;

server.listen(environment.API_PORT, () => {
  console.log(`Nexus API listening on port ${environment.API_PORT}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    realtime.io.close(() => {
      void prisma.$disconnect().then(
        () => process.exit(0),
        (error: unknown) => {
          console.error('API shutdown failed.', {
            errorName: error instanceof Error ? error.name : 'UnknownError',
          });
          process.exit(1);
        },
      );
    });
  });
}
