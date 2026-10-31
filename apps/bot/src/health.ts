import { createServer, type Server } from 'node:http';
import type { Client } from 'discord.js';

export interface BotHealth {
  startedAt: string;
  connected: boolean;
  ping: number;
  guildCount: number;
}

export function getBotHealth(
  client: Pick<Client, 'isReady' | 'ws' | 'guilds'>,
  startedAt: Date,
): BotHealth {
  return {
    startedAt: startedAt.toISOString(),
    connected: client.isReady(),
    ping: client.ws.ping,
    guildCount: client.guilds.cache.size,
  };
}

export function startHealthServer(
  client: Pick<Client, 'isReady' | 'ws' | 'guilds'>,
  startedAt: Date,
  port: number,
  host = '127.0.0.1',
): Server {
  const server = createServer((request, response) => {
    if (request.method !== 'GET' || request.url !== '/health') {
      response.writeHead(404, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ status: 'not_found' }));
      return;
    }

    const health = getBotHealth(client, startedAt);
    response.writeHead(health.connected ? 200 : 503, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    });
    response.end(
      JSON.stringify({
        status: health.connected ? 'ok' : 'degraded',
        ...health,
      }),
    );
  });

  server.listen(port, host, () => {
    console.log(JSON.stringify({ event: 'health_server_started', port, host }));
  });
  return server;
}
