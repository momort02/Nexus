import {
  PermissionFlagsBits,
  type Client,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { ApiEventTransport } from '../transport/api-event-transport.js';
import { getBotHealth } from '../health.js';
import { memberSnapshotEvent } from '../events/handlers.js';

interface InteractionHandlerOptions {
  client: Client;
  transport: ApiEventTransport;
  startedAt: Date;
}

export async function handleSlashCommand(
  interaction: ChatInputCommandInteraction,
  { client, transport, startedAt }: InteractionHandlerOptions,
): Promise<void> {
  if (interaction.commandName === 'nexus-health') {
    const health = getBotHealth(client, startedAt);
    await interaction.reply({
      ephemeral: true,
      content: health.connected
        ? `Nexus est connecté. Latence Gateway : ${health.ping} ms.`
        : 'Nexus est temporairement déconnecté.',
    });
    return;
  }

  if (interaction.commandName !== 'nexus-sync') {
    return;
  }

  if (!interaction.inGuild() || !interaction.guild) {
    await interaction.reply({
      ephemeral: true,
      content: 'Cette commande doit être utilisée dans un serveur.',
    });
    return;
  }

  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({
      ephemeral: true,
      content: 'La permission Discord « Gérer le serveur » est requise.',
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    let after: string | undefined;
    let processed = 0;
    while (true) {
      const members = await interaction.guild.members.list({
        limit: 1000,
        ...(after ? { after } : {}),
      });
      for (const member of members.values()) {
        if (!member.user.bot) {
          if (!transport.enqueue(memberSnapshotEvent(member))) {
            throw new Error('The local event queue is full.');
          }
          processed += 1;
        }
      }
      if (members.size < 1000) {
        break;
      }
      const lastMemberId = members.lastKey();
      if (!lastMemberId || lastMemberId === after) {
        throw new Error('Discord member pagination did not advance.');
      }
      after = lastMemberId;
    }
    await transport.flush();
    await interaction.editReply(
      `${processed} membres ont été traités pour la synchronisation.`,
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        event: 'member_sync_failed',
        guildId: interaction.guildId,
        errorName: error instanceof Error ? error.name : 'UnknownError',
      }),
    );
    await interaction.editReply(
      "La synchronisation a échoué. Vérifiez l'intent Guild Members et l'accès du bot au serveur.",
    );
  }
}
