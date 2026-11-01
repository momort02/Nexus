import { Client, Events, GatewayIntentBits, Partials } from 'discord.js';
import { parseBotEnvironment } from './config.js';
import { handleSlashCommand } from './commands/interaction-handler.js';
import { registerSlashCommands } from './commands/register-commands.js';
import { createLifecycleHandlers } from './events/handlers.js';
import { startHealthServer } from './health.js';
import { ApiEventTransport } from './transport/api-event-transport.js';
import { ModerationActionWorker } from './transport/moderation-action-worker.js';

export function createBot() {
  const environment = parseBotEnvironment(process.env);
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildMessageReactions,
      GatewayIntentBits.GuildVoiceStates,
    ],
    partials: [
      Partials.Channel,
      Partials.Message,
      Partials.Reaction,
      Partials.User,
    ],
  });
  const startedAt = new Date();
  const transport = new ApiEventTransport({
    endpoint: environment.apiBaseUrl,
    secret: environment.apiSecret,
  });
  const moderationWorker = new ModerationActionWorker({
    client,
    endpoint: new URL(
      '/api/internal/v1/moderation/actions',
      environment.apiBaseUrl,
    )
      .toString()
      .replace(/\/$/, ''),
    secret: environment.apiSecret,
  });
  const lifecycle = createLifecycleHandlers((event) => {
    transport.enqueue(event);
  }, environment.analyticsKey);

  client.on(Events.GuildMemberAdd, lifecycle.memberAdd);
  client.on(Events.GuildMemberRemove, lifecycle.memberRemove);
  client.on(Events.GuildMemberUpdate, (_oldMember, newMember) => {
    lifecycle.memberUpdate(newMember);
  });
  client.on(Events.GuildCreate, lifecycle.guildMetadata);
  client.on(Events.ChannelCreate, (channel) => {
    if (channel.isDMBased()) return;
    lifecycle.guildMetadata(channel.guild);
  });
  client.on(Events.ChannelUpdate, (_oldChannel, newChannel) => {
    if (newChannel.isDMBased()) return;
    lifecycle.guildMetadata(newChannel.guild);
  });
  client.on(Events.ChannelDelete, (channel) => {
    if (channel.isDMBased()) return;
    lifecycle.guildMetadata(channel.guild);
  });
  client.on(Events.GuildRoleCreate, (role) => {
    lifecycle.guildMetadata(role.guild);
  });
  client.on(Events.GuildRoleUpdate, (_oldRole, newRole) => {
    lifecycle.guildMetadata(newRole.guild);
  });
  client.on(Events.GuildRoleDelete, (role) => {
    lifecycle.guildMetadata(role.guild);
  });
  client.on(Events.MessageCreate, lifecycle.messageCreate);
  client.on(Events.MessageReactionAdd, (reaction, user) => {
    lifecycle.reactionAdd(reaction, user);
  });
  client.on(Events.VoiceStateUpdate, lifecycle.voiceStateUpdate);

  client.on(Events.InteractionCreate, (interaction) => {
    if (!interaction.isChatInputCommand()) {
      return;
    }
    lifecycle.command(interaction.guildId, interaction.user, interaction.id);
    void handleSlashCommand(interaction, {
      client,
      transport,
      startedAt,
    }).catch((error: unknown) => {
      console.error(
        JSON.stringify({
          event: 'slash_command_failed',
          command: interaction.commandName,
          errorName: error instanceof Error ? error.name : 'UnknownError',
        }),
      );
      if (interaction.deferred || interaction.replied) {
        void interaction.followUp({
          ephemeral: true,
          content: 'La commande a rencontré une erreur.',
        });
      }
    });
  });

  client.once(Events.ClientReady, (readyClient) => {
    moderationWorker.start();
    console.log(
      JSON.stringify({
        event: 'discord_gateway_ready',
        guildCount: readyClient.guilds.cache.size,
      }),
    );
    void registerSlashCommands(
      environment.discordBotToken,
      environment.discordClientId,
    ).catch((error: unknown) => {
      console.error(
        JSON.stringify({
          event: 'slash_command_registration_failed',
          errorName: error instanceof Error ? error.name : 'UnknownError',
        }),
      );
    });
    for (const guild of readyClient.guilds.cache.values()) {
      lifecycle.guildMetadata(guild);
    }
  });

  client.on(Events.Error, (error) => {
    console.error(
      JSON.stringify({
        event: 'discord_client_error',
        errorName: error.name,
      }),
    );
  });

  client.on(Events.ShardDisconnect, (_closeEvent, shardId) => {
    console.warn(
      JSON.stringify({ event: 'discord_gateway_disconnected', shardId }),
    );
  });

  client.on(Events.ShardReconnecting, (shardId) => {
    console.info(
      JSON.stringify({ event: 'discord_gateway_reconnecting', shardId }),
    );
  });

  const healthServer = startHealthServer(
    client,
    startedAt,
    environment.healthPort,
  );

  return {
    client,
    transport,
    healthServer,
    async start(): Promise<void> {
      await client.login(environment.discordBotToken);
    },
    async stop(): Promise<void> {
      await moderationWorker.stop();
      await transport.close();
      client.destroy();
      await new Promise<void>((resolve, reject) => {
        healthServer.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

if (process.env.NODE_ENV !== 'test') {
  const bot = createBot();
  await bot.start();

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      void bot.stop().then(
        () => process.exit(0),
        (error: unknown) => {
          console.error(
            JSON.stringify({
              event: 'bot_shutdown_failed',
              errorName: error instanceof Error ? error.name : 'UnknownError',
            }),
          );
          process.exit(1);
        },
      );
    });
  }
}
