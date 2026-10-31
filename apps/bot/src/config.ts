export interface BotEnvironment {
  discordBotToken: string;
  discordClientId: string;
  apiBaseUrl: string;
  apiSecret: string;
  analyticsKey: string;
  healthPort: number;
  nodeEnv: string;
}

export function parseBotEnvironment(env: NodeJS.ProcessEnv): BotEnvironment {
  const required = (key: 'DISCORD_BOT_TOKEN' | 'DISCORD_CLIENT_ID'): string => {
    const value = env[key]?.trim();
    if (!value) {
      throw new Error(`${key} must be set to start the Discord bot.`);
    }
    return value;
  };
  const apiSecret = env.BOT_API_SECRET?.trim();
  if (!apiSecret || apiSecret.length < 32) {
    throw new Error('BOT_API_SECRET must contain at least 32 characters.');
  }
  const analyticsKey = env.BOT_ANALYTICS_KEY?.trim();
  if (!analyticsKey || analyticsKey.length < 32) {
    throw new Error('BOT_ANALYTICS_KEY must contain at least 32 characters.');
  }

  const apiBaseUrl = env.BOT_API_BASE_URL?.trim();
  if (!apiBaseUrl) {
    throw new Error('BOT_API_BASE_URL must be set to start the Discord bot.');
  }
  const apiUrl = new URL(apiBaseUrl);
  if (
    !['http:', 'https:'].includes(apiUrl.protocol) ||
    apiUrl.username ||
    apiUrl.password ||
    apiUrl.search ||
    apiUrl.hash
  ) {
    throw new Error('BOT_API_BASE_URL must be a plain HTTP(S) URL.');
  }
  const nodeEnv = env.NODE_ENV ?? 'development';
  if (nodeEnv === 'production' && apiUrl.protocol !== 'https:') {
    throw new Error('BOT_API_BASE_URL must use HTTPS in production.');
  }

  const healthPort = Number(env.BOT_HEALTH_PORT ?? 3001);
  if (!Number.isInteger(healthPort) || healthPort < 1 || healthPort > 65_535) {
    throw new Error('BOT_HEALTH_PORT must be an integer from 1 to 65535.');
  }

  return {
    discordBotToken: required('DISCORD_BOT_TOKEN'),
    discordClientId: required('DISCORD_CLIENT_ID'),
    apiBaseUrl: apiUrl.toString(),
    apiSecret,
    analyticsKey,
    healthPort,
    nodeEnv,
  };
}
