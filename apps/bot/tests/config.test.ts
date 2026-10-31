import { describe, expect, it } from 'vitest';
import { parseBotEnvironment } from '../src/config.js';

const baseEnvironment = {
  DISCORD_BOT_TOKEN: 'bot-token',
  DISCORD_CLIENT_ID: 'client-id',
  BOT_API_SECRET: 's'.repeat(32),
  BOT_ANALYTICS_KEY: 'a'.repeat(32),
  BOT_HEALTH_PORT: '3001',
};

describe('bot environment', () => {
  it('requires HTTPS for the API transport in production', () => {
    expect(() =>
      parseBotEnvironment({
        ...baseEnvironment,
        NODE_ENV: 'production',
        BOT_API_BASE_URL:
          'http://api.example.test/api/internal/v1/discord/events',
      }),
    ).toThrow('BOT_API_BASE_URL must use HTTPS in production.');

    expect(
      parseBotEnvironment({
        ...baseEnvironment,
        NODE_ENV: 'production',
        BOT_API_BASE_URL:
          'https://api.example.test/api/internal/v1/discord/events',
      }).apiBaseUrl,
    ).toBe('https://api.example.test/api/internal/v1/discord/events');
  });

  it('continues to allow HTTP for local development', () => {
    expect(
      parseBotEnvironment({
        ...baseEnvironment,
        BOT_API_BASE_URL:
          'http://localhost:3000/api/internal/v1/discord/events',
      }).apiBaseUrl,
    ).toBe('http://localhost:3000/api/internal/v1/discord/events');
  });
});
