CREATE TABLE "BotEventReceipt" (
    "eventId" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BotEventReceipt_pkey" PRIMARY KEY ("eventId")
);

CREATE TABLE "MessageStatistic" (
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "bucketStart" TIMESTAMP(3) NOT NULL,
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessageStatistic_pkey" PRIMARY KEY ("guildId", "channelId", "bucketStart")
);

CREATE TABLE "GuildMemberSnapshot" (
    "guildId" TEXT NOT NULL,
    "discordUserId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3),
    "roleIds" JSONB NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuildMemberSnapshot_pkey" PRIMARY KEY ("guildId", "discordUserId")
);

CREATE INDEX "BotEventReceipt_guildId_receivedAt_idx"
    ON "BotEventReceipt"("guildId", "receivedAt");
CREATE INDEX "MessageStatistic_guildId_bucketStart_idx"
    ON "MessageStatistic"("guildId", "bucketStart");
CREATE INDEX "GuildMemberSnapshot_guildId_syncedAt_idx"
    ON "GuildMemberSnapshot"("guildId", "syncedAt");

ALTER TABLE "BotEventReceipt"
    ADD CONSTRAINT "BotEventReceipt_guildId_fkey"
    FOREIGN KEY ("guildId") REFERENCES "Guild"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MessageStatistic"
    ADD CONSTRAINT "MessageStatistic_guildId_fkey"
    FOREIGN KEY ("guildId") REFERENCES "Guild"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GuildMemberSnapshot"
    ADD CONSTRAINT "GuildMemberSnapshot_guildId_fkey"
    FOREIGN KEY ("guildId") REFERENCES "Guild"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
