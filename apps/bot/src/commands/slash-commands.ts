import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

export const slashCommands = [
  new SlashCommandBuilder()
    .setName('nexus-health')
    .setDescription('Vérifier la connexion du bot Nexus.'),
  new SlashCommandBuilder()
    .setName('nexus-sync')
    .setDescription('Synchroniser les membres de ce serveur avec Nexus.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
];

export const slashCommandPayload = slashCommands.map((command) =>
  command.toJSON(),
);
