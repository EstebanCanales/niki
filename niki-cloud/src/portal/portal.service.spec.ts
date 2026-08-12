import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";

import { requireTestDatabaseUrl } from "../auth/test-database";
import { PrismaService } from "../database/prisma.service";
import { resetTestDatabase } from "../testing/reset-test-database";
import { PortalService } from "./portal.service";

process.env.DATABASE_URL = requireTestDatabaseUrl(process.env.DATABASE_URL);
process.env.MAGIC_CODE_PEPPER = "test-magic-code-pepper";
process.env.SESSION_COOKIE_SECRET = "test-session-cookie-secret";
process.env.DEVICE_SECRET_ENCRYPTION_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
process.env.CONVERSATION_ENCRYPTION_KEY = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=";
process.env.NIKI_CLOUD_DEV_AUTH = "1";

const { AppModule } = require("../app.module") as typeof import("../app.module");

describe("PortalService", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let service: PortalService;
  let userId: string;
  let deviceId: string;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    service = app.get(PortalService);

    await resetTestDatabase(prisma);

    const user = await prisma.user.create({ data: { email: "portal@example.com" } });
    const device = await prisma.device.create({
      data: {
        userId: user.id,
        name: "Portal Mac",
        secretCiphertext: "unused",
        secretNonce: "unused",
        secretAuthTag: "unused",
      },
    });
    userId = user.id;
    deviceId = device.id;
  });

  afterEach(async () => {
    await app.close();
  });

  async function createUsage(
    ownerId: string,
    ownerDeviceId: string,
    eventId: string,
    category: string,
    quantity: bigint,
    occurredAt: string,
  ): Promise<void> {
    await prisma.usageEvent.create({
      data: {
        eventId,
        userId: ownerId,
        deviceId: ownerDeviceId,
        category,
        quantity,
        occurredAt: new Date(occurredAt),
      },
    });
  }

  it("uses exact UTC day boundaries and excludes another tenant's usage", async () => {
    const other = await prisma.user.create({ data: { email: "other-portal@example.com" } });
    const otherDevice = await prisma.device.create({
      data: {
        userId: other.id,
        name: "Other Mac",
        secretCiphertext: "unused",
        secretNonce: "unused",
        secretAuthTag: "unused",
      },
    });

    await createUsage(userId, deviceId, "before", "chat.input_tokens", 99n, "2026-08-10T23:59:59.999Z");
    await createUsage(userId, deviceId, "start", "chat.input_tokens", 10n, "2026-08-11T00:00:00.000Z");
    await createUsage(userId, deviceId, "voice", "voice.tts_seconds", 3n, "2026-08-11T12:00:00.000Z");
    await createUsage(userId, deviceId, "end", "chat.input_tokens", 88n, "2026-08-12T00:00:00.000Z");
    await createUsage(other.id, otherDevice.id, "other", "tool.call", 7n, "2026-08-11T08:00:00.000Z");

    await expect(
      service.getUsage(userId, "day", new Date("2026-08-11T18:30:00.000Z")),
    ).resolves.toEqual({
      period: "day",
      startsAt: "2026-08-11T00:00:00.000Z",
      endsAt: "2026-08-12T00:00:00.000Z",
      totalQuantity: "13",
      byCategory: {
        "chat.input_tokens": "10",
        "voice.tts_seconds": "3",
      },
    });
  });

  it.each([
    ["week" as const, "2026-08-10T00:00:00.000Z", "2026-08-17T00:00:00.000Z"],
    ["month" as const, "2026-08-01T00:00:00.000Z", "2026-09-01T00:00:00.000Z"],
  ])("computes the %s period in UTC", async (period, startsAt, endsAt) => {
    const usage = await service.getUsage(
      userId,
      period,
      new Date("2026-08-11T23:30:00-06:00"),
    );

    expect(usage).toMatchObject({ period, startsAt, endsAt });
  });

  it("derives the current balance from every immutable ledger entry", async () => {
    await prisma.creditEntry.createMany({
      data: [
        { userId, amountMicros: 3_000_000n, kind: "initial_grant" },
        { userId, amountMicros: -450_000n, kind: "usage_debit" },
        { userId, amountMicros: 25_000n, kind: "adjustment" },
      ],
    });
    const other = await prisma.user.create({ data: { email: "other-credit@example.com" } });
    await prisma.creditEntry.create({
      data: { userId: other.id, amountMicros: 99_000_000n, kind: "initial_grant" },
    });

    const credits = await service.getCredits(userId);

    expect(credits.balanceMicros).toBe("2575000");
    expect(credits.entries).toHaveLength(3);
    expect(credits.entries.map((entry) => entry.amountMicros).sort()).toEqual([
      "-450000",
      "25000",
      "3000000",
    ]);
  });

  it("builds the dashboard from owner-only credit, usage, and device data", async () => {
    await prisma.creditEntry.create({
      data: { userId, amountMicros: 2_000_000n, kind: "initial_grant" },
    });
    await createUsage(userId, deviceId, "dashboard-event", "tool.call", 2n, "2026-08-11T10:00:00.000Z");

    const dashboard = await service.getDashboard(
      userId,
      new Date("2026-08-11T18:30:00.000Z"),
    );

    expect(dashboard).toMatchObject({
      balanceMicros: "2000000",
      activeDeviceCount: 1,
      conversationSyncEnabled: false,
      usage: {
        period: "month",
        totalQuantity: "2",
        byCategory: { "tool.call": "2" },
      },
    });
  });
});
