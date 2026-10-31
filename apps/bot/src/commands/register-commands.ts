import { REST, Routes } from 'discord.js';
import { slashCommandPayload } from './slash-commands.js';

export async function registerSlashCommands(
  token: string,
  clientId: string,
): Promise<void> {
  const rest = new REST({ version: '10' }).setToken(token);
  await rest.put(Routes.applicationCommands(clientId), {
    body: slashCommandPayload,
  });
}
