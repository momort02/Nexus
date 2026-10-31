CREATE TABLE "BotRequestNonce" (
    "nonce" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BotRequestNonce_pkey" PRIMARY KEY ("nonce")
);

CREATE INDEX "BotRequestNonce_expiresAt_idx" ON "BotRequestNonce"("expiresAt");
