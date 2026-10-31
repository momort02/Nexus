import { z } from 'zod';

const environmentSchema = z.object({
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  DATABASE_URL: z.string().min(1),
  APP_ORIGIN: z
    .string()
    .url()
    .refine(
      (value) => URL.canParse(value) && new URL(value).origin === value,
      'Must be an origin URL',
    ),
  DISCORD_CLIENT_ID: z.string().min(1),
  DISCORD_CLIENT_SECRET: z.string().min(1),
  DISCORD_REDIRECT_URI: z.string().url(),
  BOT_API_SECRET: z.string().min(32),
  OAUTH_ENCRYPTION_KEY: z.string().regex(/^[\da-fA-F]{64}$/),
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
});

export type Environment = z.infer<typeof environmentSchema>;

export function parseEnvironment(environment: NodeJS.ProcessEnv): Environment {
  return environmentSchema.parse(environment);
}
