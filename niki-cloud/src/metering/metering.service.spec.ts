import { INestApplication } from "@nestjs/common";
import { Device } from "@prisma/client";
import { Test } from "@nestjs/testing";
import { randomUUID } from "node:crypto";

import { requireTestDatabaseUrl } from "../auth/test-database";
import { PrismaService } from "../database/prisma.service";
import { MeteringService } from "./metering.service";
import { DeviceUsageEvent, UsageCategory } from "./metering.types";

process.env.DATABASE_URL = requireTestDatabaseUrl(process.env.DATABASE_URL);
process.env.MAGIC_CODE_PEPPER = "test-magic-code-pepper";
process.env.SESSION_COOKIE_SECRET = "test-session-cookie-secret";
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

    await prisma.creditEntry.deleteMany();
    await prisma.usageEvent.deleteMany();
    await prisma.device.deleteMany();
    await prisma.webSession.deleteMany();
    await prisma.magicCode.deleteMany();
    await prisma.magicCodeLock.deleteMany();
    await prisma.user.deleteMany();

    const user = await prisma.user.create({ data: { email: "metering@example.com" } });
    device = await prisma.device.create({
      data: { userId: user.id, name: "Metering Mac", secretHash: "device-secret" },
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

  it("rolls back usage and credits when any event in the batch cannot be stored", async () => {
    const events: DeviceUsageEvent[] = [
      usageEvent("tool.call", 1),
      { ...usageEvent("tool.call", 1), conversationId: randomUUID() },
    ];

    await expect(service.ingest(device, { events })).rejects.toThrow();

    expect(await prisma.usageEvent.count()).toBe(0);
    expect(await prisma.creditEntry.count()).toBe(0);
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
