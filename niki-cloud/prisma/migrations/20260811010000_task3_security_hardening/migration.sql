-- DropForeignKey
ALTER TABLE "UsageEvent" DROP CONSTRAINT "UsageEvent_conversationId_fkey";

-- DropForeignKey
ALTER TABLE "CreditEntry" DROP CONSTRAINT "CreditEntry_userId_fkey";

-- Existing device credentials were stored as plaintext despite the old column name.
-- Preserve device history but revoke those credentials; users must relink with an encrypted secret.
ALTER TABLE "Device" RENAME COLUMN "secretHash" TO "secretCiphertext";
ALTER TABLE "Device"
ADD COLUMN "secretAuthTag" TEXT,
ADD COLUMN "secretNonce" TEXT;
UPDATE "Device"
SET "secretCiphertext" = '',
    "secretNonce" = '',
    "secretAuthTag" = '',
    "revokedAt" = COALESCE("revokedAt", CURRENT_TIMESTAMP);
ALTER TABLE "Device"
ALTER COLUMN "secretAuthTag" SET NOT NULL,
ALTER COLUMN "secretNonce" SET NOT NULL;

-- Keep the caller's local identifier as non-relational metadata. It must never bind a
-- usage row to another tenant's synchronized Conversation record.
ALTER TABLE "UsageEvent" RENAME COLUMN "conversationId" TO "externalConversationId";
ALTER TABLE "UsageEvent"
ALTER COLUMN "externalConversationId" TYPE TEXT
USING "externalConversationId"::TEXT;

-- AlterTable
ALTER TABLE "CreditEntry" DROP COLUMN "updatedAt";

-- CreateTable
CREATE TABLE "DeviceLinkCode" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "failedAttemptCount" INTEGER NOT NULL DEFAULT 0,
    "claimedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeviceLinkCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceLinkAttempt" (
    "originHash" TEXT NOT NULL,
    "failedAttemptCount" INTEGER NOT NULL DEFAULT 0,
    "windowStartedAt" TIMESTAMPTZ(6) NOT NULL,
    "lockedUntil" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "DeviceLinkAttempt_pkey" PRIMARY KEY ("originHash")
);

-- CreateIndex
CREATE UNIQUE INDEX "DeviceLinkCode_codeHash_key" ON "DeviceLinkCode"("codeHash");

-- CreateIndex
CREATE INDEX "DeviceLinkCode_userId_expiresAt_idx" ON "DeviceLinkCode"("userId", "expiresAt");

-- AddForeignKey
ALTER TABLE "DeviceLinkCode" ADD CONSTRAINT "DeviceLinkCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditEntry" ADD CONSTRAINT "CreditEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Credit entries are an append-only ledger. Enforce this below Prisma so every SQL client
-- receives the same protection.
CREATE FUNCTION "reject_credit_entry_mutation"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'CreditEntry is append-only' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER "CreditEntry_append_only"
BEFORE UPDATE OR DELETE ON "CreditEntry"
FOR EACH ROW
EXECUTE FUNCTION "reject_credit_entry_mutation"();
