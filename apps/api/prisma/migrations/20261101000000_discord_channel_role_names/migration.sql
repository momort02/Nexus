CREATE TABLE "DiscordGuildChannel" (
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscordGuildChannel_pkey" PRIMARY KEY ("guildId", "channelId")
);

CREATE TABLE "DiscordGuildRole" (
    "guildId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscordGuildRole_pkey" PRIMARY KEY ("guildId", "roleId")
);

ALTER TABLE "DiscordGuildChannel"
ADD CONSTRAINT "DiscordGuildChannel_guildId_fkey"
FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DiscordGuildRole"
ADD CONSTRAINT "DiscordGuildRole_guildId_fkey"
FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;
