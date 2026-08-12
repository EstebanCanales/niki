import { PrismaService } from "../database/prisma.service";

export async function resetTestDatabase(prisma: PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "CreditEntry",
      "UsageEvent",
      "Message",
      "Conversation",
      "SyncCursor",
      "DeviceLinkAttempt",
      "DeviceLinkCode",
      "Device",
      "WebSession",
      "MagicCode",
      "MagicCodeLock",
      "WaitlistEntry",
      "User"
    RESTART IDENTITY CASCADE
  `);
}
