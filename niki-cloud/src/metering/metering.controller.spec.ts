import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { createHmac, randomUUID } from "node:crypto";
import request from "supertest";

import { requireTestDatabaseUrl } from "../auth/test-database";
import { PrismaService } from "../database/prisma.service";
import { DeviceSecretEncryptionService } from "../devices/device-secret-encryption.service";
import { resetTestDatabase } from "../testing/reset-test-database";

process.env.DATABASE_URL = requireTestDatabaseUrl(process.env.DATABASE_URL);
process.env.MAGIC_CODE_PEPPER = "test-magic-code-pepper";
process.env.SESSION_COOKIE_SECRET = "test-session-cookie-secret";
process.env.DEVICE_SECRET_ENCRYPTION_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
process.env.NIKI_CLOUD_DEV_AUTH = "1";

const { AppModule } = require("../app.module") as typeof import("../app.module");

describe("MeteringController", () => {
  const secret = "controller-device-secret";
  let app: INestApplication;
  let deviceId: string;
  let prisma: PrismaService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication({ rawBody: true });
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
    );
    await app.init();
    prisma = app.get(PrismaService);

    await resetTestDatabase(prisma);

    const user = await prisma.user.create({ data: { email: "meter-route@example.com" } });
    const newDeviceId = randomUUID();
    const encryptedSecret = app
      .get(DeviceSecretEncryptionService)
      .encrypt(secret, newDeviceId);
    const device = await prisma.device.create({
      data: { id: newDeviceId, userId: user.id, name: "Route Meter", ...encryptedSecret },
    });
    deviceId = device.id;
  });

  afterEach(async () => {
    await app.close();
  });

  it("accepts an exactly signed raw JSON usage batch", async () => {
    const rawBody = JSON.stringify({
      events: [
        {
          eventId: randomUUID(),
          occurredAt: "2026-08-11T18:00:00.000Z",
          category: "tool.call",
          quantity: 1,
        },
      ],
    });
    const timestamp = String(Date.now());
    const signature = createHmac("sha256", secret)
      .update(`${timestamp}.${rawBody}`)
      .digest("hex");

    await request(app.getHttpServer())
      .post("/v1/device-events/batch")
      .set("Content-Type", "application/json")
      .set("x-niki-device-id", deviceId)
      .set("x-niki-timestamp", timestamp)
      .set("x-niki-signature", signature)
      .send(rawBody)
      .expect(201, { accepted: 1, duplicates: 0 });

    expect(await prisma.usageEvent.count()).toBe(1);
    expect(await prisma.creditEntry.findFirstOrThrow()).toMatchObject({ amountMicros: -50_000n });
  });
});
