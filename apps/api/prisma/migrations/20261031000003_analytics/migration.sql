ALTER TABLE "Guild"
ADD COLUMN "analyticsTimezone" TEXT NOT NULL DEFAULT 'UTC';
ALTER TABLE "Guild"
ADD COLUMN "analyticsStartedAt" TIMESTAMP(3);

CREATE TABLE "GuildDailyStatistic" (
    "guildId" TEXT NOT NULL,
    "activityDate" DATE NOT NULL,
    "joinCount" INTEGER NOT NULL DEFAULT 0,
    "leaveCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "GuildDailyStatistic_pkey" PRIMARY KEY ("guildId", "activityDate")
);

CREATE TABLE "DailyMemberActivity" (
    "guildId" TEXT NOT NULL,
    "activityDate" DATE NOT NULL,
    "memberKey" VARCHAR(64) NOT NULL,
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "reactionCount" INTEGER NOT NULL DEFAULT 0,
    "commandCount" INTEGER NOT NULL DEFAULT 0,
    "voiceSeconds" INTEGER NOT NULL DEFAULT 0,
    "voiceSessions" INTEGER NOT NULL DEFAULT 0,
    "lastActivityAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyMemberActivity_pkey"
        PRIMARY KEY ("guildId", "activityDate", "memberKey")
);

CREATE TABLE "DailyMessageStatistic" (
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "activityDate" DATE NOT NULL,
    "messageCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DailyMessageStatistic_pkey"
        PRIMARY KEY ("guildId", "channelId", "activityDate")
);

CREATE INDEX "GuildDailyStatistic_guildId_activityDate_idx"
    ON "GuildDailyStatistic"("guildId", "activityDate");
CREATE INDEX "DailyMemberActivity_guildId_activityDate_idx"
    ON "DailyMemberActivity"("guildId", "activityDate");
CREATE INDEX "DailyMessageStatistic_guildId_activityDate_idx"
    ON "DailyMessageStatistic"("guildId", "activityDate");

ALTER TABLE "GuildDailyStatistic"
    ADD CONSTRAINT "GuildDailyStatistic_guildId_fkey"
    FOREIGN KEY ("guildId") REFERENCES "Guild"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DailyMemberActivity"
    ADD CONSTRAINT "DailyMemberActivity_guildId_fkey"
    FOREIGN KEY ("guildId") REFERENCES "Guild"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DailyMessageStatistic"
    ADD CONSTRAINT "DailyMessageStatistic_guildId_fkey"
    FOREIGN KEY ("guildId") REFERENCES "Guild"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
