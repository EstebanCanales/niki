import { INestApplication, UnauthorizedException } from "@nestjs/common";
import { Device } from "@prisma/client";
import { Test } from "@nestjs/testing";
import { createHmac, randomUUID } from "node:crypto";

import { requireTestDatabaseUrl } from "../auth/test-database";
import { PrismaService } from "../database/prisma.service";
import { DeviceSecretEncryptionService } from "../devices/device-secret-encryption.service";
import { resetTestDatabase } from "../testing/reset-test-database";
import { DeviceSignatureService } from "./device-signature.service";

process.env.DATABASE_URL = requireTestDatabaseUrl(process.env.DATABASE_URL);
process.env.MAGIC_CODE_PEPPER = "test-magic-code-pepper";
process.env.SESSION_COOKIE_SECRET = "test-session-cookie-secret";
process.env.DEVICE_SECRET_ENCRYPTION_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
process.env.NIKI_CLOUD_DEV_AUTH = "1";

const { AppModule } = require("../app.module") as typeof import("../app.module");

describe("DeviceSignatureService", () => {
  const now = Date.parse("2026-08-11T18:00:00.000Z");
  const rawBody = Buffer.from('{"events":[]}');
  const secret = "a-random-device-secret";
  let app: INestApplication;
  let device: Device;
  let prisma: PrismaService;
  let service: DeviceSignatureService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    service = app.get(DeviceSignatureService);

    await resetTestDatabase(prisma);

    const user = await prisma.user.create({ data: { email: "signature@example.com" } });
    const deviceId = randomUUID();
    const encryptedSecret = app.get(DeviceSecretEncryptionService).encrypt(secret, deviceId);
    device = await prisma.device.create({
      data: { id: deviceId, userId: user.id, name: "Signed Mac", ...encryptedSecret },
    });
  });

  afterEach(async () => {
    await app.close();
  });

  const signature = (timestamp: string, body = rawBody): string =>
    createHmac("sha256", secret).update(`${timestamp}.${body.toString("utf8")}`).digest("hex");

  it("accepts a lowercase hex HMAC over timestamp dot raw body", async () => {
    const timestamp = String(now);

    await expect(
      service.verify(
        { deviceId: device.id, timestamp, signature: signature(timestamp) },
        rawBody,
        now,
      ),
    ).resolves.toMatchObject({ id: device.id, userId: device.userId });
  });

  it("rejects timestamps older than five minutes", async () => {
    const timestamp = String(now - 5 * 60 * 1000 - 1);

    await expect(
      service.verify(
        { deviceId: device.id, timestamp, signature: signature(timestamp) },
        rawBody,
        now,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("rejects signatures for a different raw body and malformed hex", async () => {
    const timestamp = String(now);

    await expect(
      service.verify(
        { deviceId: device.id, timestamp, signature: signature(timestamp) },
        Buffer.from('{"events":[{}]}'),
        now,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      service.verify(
        { deviceId: device.id, timestamp, signature: signature(timestamp).toUpperCase() },
        rawBody,
        now,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("rejects revoked devices", async () => {
    const timestamp = String(now);
    await prisma.device.update({
      where: { id: device.id },
      data: { revokedAt: new Date(now - 1) },
    });

    await expect(
      service.verify(
        { deviceId: device.id, timestamp, signature: signature(timestamp) },
        rawBody,
        now,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("rejects a malformed device identifier as an authentication failure", async () => {
    const timestamp = String(now);

    await expect(
      service.verify(
        { deviceId: "not-a-uuid", timestamp, signature: signature(timestamp) },
        rawBody,
        now,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
