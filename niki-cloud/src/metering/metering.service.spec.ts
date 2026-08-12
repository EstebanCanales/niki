import { INestApplication } from "@nestjs/common";
import { Device } from "@prisma/client";
import { Test } from "@nestjs/testing";
import { randomUUID } from "node:crypto";

import { requireTestDatabaseUrl } from "../auth/test-database";
import { PrismaService } from "../database/prisma.service";
import { resetTestDatabase } from "../testing/reset-test-database";
import { MeteringService } from "./metering.service";
import { DeviceUsageEvent, UsageCategory } from "./metering.types";

process.env.DATABASE_URL = requireTestDatabaseUrl(process.env.DATABASE_URL);
process.env.MAGIC_CODE_PEPPER = "test-magic-code-pepper";
process.env.SESSION_COOKIE_SECRET = "test-session-cookie-secret";
process.env.DEVICE_SECRET_ENCRYPTION_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
process.env.NIKI_CLOUD_DEV_AUTH = "1";

const { AppModule } = require("../app.module") as typeof import("../app.module");

describe("MeteringService", () => {
  let app: INestApplication;
  let device: Device;
  let prisma: PrismaService;
  let service: MeteringService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    service = app.get(MeteringService);

    await resetTestDatabase(prisma);

    const user = await prisma.user.create({ data: { email: "metering@example.com" } });
    device = await prisma.device.create({
      data: {
        userId: user.id,
        name: "Metering Mac",
        secretCiphertext: "unused",
        secretNonce: "unused",
        secretAuthTag: "unused",
      },
    });
  });

  afterEach(async () => {
    await app.close();
  });

  const usageEvent = (
    category: UsageCategory = "chat.input_tokens",
    quantity = 1,
  ): DeviceUsageEvent => ({
    eventId: randomUUID(),
    occurredAt: "2026-08-11T18:00:00.000Z",
    category,
    quantity,
  });

  it("does not debit the same event twice", async () => {
    const event = usageEvent("chat.input_tokens", 125);

    await expect(service.ingest(device, { events: [event] })).resolves.toEqual({
      accepted: 1,
      duplicates: 0,
    });
    await expect(service.ingest(device, { events: [event] })).resolves.toEqual({
      accepted: 0,
      duplicates: 1,
    });

    expect(await prisma.usageEvent.count()).toBe(1);
    expect(await prisma.creditEntry.count({ where: { sourceEventId: event.eventId } })).toBe(1);
  });

  it("does not debit concurrent deliveries of the same event twice", async () => {
    const event = usageEvent("tool.call", 1);

    const results = await Promise.all([
      service.ingest(device, { events: [event] }),
      service.ingest(device, { events: [event] }),
    ]);

    expect(results.map((result) => result.accepted).sort()).toEqual([0, 1]);
    expect(await prisma.usageEvent.count({ where: { eventId: event.eventId } })).toBe(1);
    expect(await prisma.creditEntry.count({ where: { sourceEventId: event.eventId } })).toBe(1);
  });

  it("debits integer credit micros using the server-owned rate table", async () => {
    const events = [
      usageEvent("chat.input_tokens", 3),
      usageEvent("chat.output_tokens", 2),
      usageEvent("voice.stt_seconds", 3),
      usageEvent("voice.tts_seconds", 4),
      usageEvent("tool.call", 5),
    ];

    await service.ingest(device, { events });

    const entries = await prisma.creditEntry.findMany({ orderBy: { createdAt: "asc" } });
    expect(entries.map((entry) => entry.amountMicros)).toEqual([
      -3n,
      -4n,
      -30_000n,
      -80_000n,
      -250_000n,
    ]);
    expect(entries.map((entry) => entry.kind)).toEqual(Array(5).fill("usage_debit"));
  });

  it("stores an external conversation identifier when conversation sync is absent", async () => {
    const event = { ...usageEvent("tool.call", 1), conversationId: "local-thread-123" };

    await expect(service.ingest(device, { events: [event] })).resolves.toEqual({
      accepted: 1,
      duplicates: 0,
    });

    const rows = await prisma.$queryRaw<Array<{ externalConversationId: string }>>`
      SELECT "externalConversationId"
      FROM "UsageEvent"
      WHERE "eventId" = ${event.eventId}
    `;
    expect(rows).toEqual([{ externalConversationId: "local-thread-123" }]);
  });

  it("never associates usage with another user's synchronized conversation", async () => {
    const otherUser = await prisma.user.create({ data: { email: "other-tenant@example.com" } });
    const otherConversation = await prisma.conversation.create({
      data: { userId: otherUser.id, externalId: "other-thread" },
    });
    const event = {
      ...usageEvent("chat.input_tokens", 1),
      conversationId: otherConversation.id,
    };

    await service.ingest(device, { events: [event] });
    await prisma.conversation.delete({ where: { id: otherConversation.id } });

    const usage = await prisma.usageEvent.findUniqueOrThrow({ where: { eventId: event.eventId } });
    expect(usage.externalConversationId).toBe(otherConversation.id);
  });

  it("rejects database updates and deletes of credit entries", async () => {
    const event = usageEvent("tool.call", 1);
    await service.ingest(device, { events: [event] });
    const entry = await prisma.creditEntry.findFirstOrThrow();

    await expect(
      prisma.creditEntry.update({
        where: { id: entry.id },
        data: { amountMicros: -1n },
      }),
    ).rejects.toThrow("CreditEntry is append-only");
    await expect(prisma.creditEntry.delete({ where: { id: entry.id } })).rejects.toThrow(
      "CreditEntry is append-only",
    );
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects unsafe quantity %s before writing the batch",
    async (quantity) => {
      await expect(
        service.ingest(device, { events: [usageEvent("chat.input_tokens", quantity)] }),
      ).rejects.toThrow("quantity");

      expect(await prisma.usageEvent.count()).toBe(0);
      expect(await prisma.creditEntry.count()).toBe(0);
    },
  );
});
