import { INestApplication, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { Test } from "@nestjs/testing";

import { AuthUser } from "../auth/auth.service";
import { requireTestDatabaseUrl } from "../auth/test-database";
import { PrismaService } from "../database/prisma.service";
import { resetTestDatabase } from "../testing/reset-test-database";
import { DevicesService } from "./devices.service";

process.env.DATABASE_URL = requireTestDatabaseUrl(process.env.DATABASE_URL);
process.env.MAGIC_CODE_PEPPER = "test-magic-code-pepper";
process.env.SESSION_COOKIE_SECRET = "test-session-cookie-secret";
process.env.DEVICE_SECRET_ENCRYPTION_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
process.env.NIKI_CLOUD_DEV_AUTH = "1";

const { AppModule } = require("../app.module") as typeof import("../app.module");

describe("DevicesService", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let service: DevicesService;
  let user: AuthUser;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    service = app.get(DevicesService);

    await resetTestDatabase(prisma);

    user = await prisma.user.create({
      data: { email: "devices@example.com" },
      select: { id: true, email: true, displayName: true },
    });
  });

  afterEach(async () => {
    await app.close();
  });

  it("creates a six-character ten-minute link code from the approved alphabet", async () => {
    const before = Date.now();
    const result = await service.createLinkCode(user);
    const after = Date.now();

    expect(result.code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
    expect(result.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 10 * 60 * 1000);
    expect(result.expiresAt.getTime()).toBeLessThanOrEqual(after + 10 * 60 * 1000);
    const persisted = await prisma.deviceLinkCode.findFirstOrThrow();
    expect(persisted.codeHash).not.toBe(result.code);
    expect(persisted.codeHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("claims a link code once and returns the device secret only in that response", async () => {
    const { code } = await service.createLinkCode(user);

    const linked = await service.link({ code, name: "Esteban's Mac", platform: "macos" });

    expect(linked).toEqual({ deviceId: expect.any(String), secret: expect.any(String) });
    expect(linked.secret.length).toBeGreaterThanOrEqual(32);
    await expect(
      service.link({ code, name: "Duplicate Mac", platform: "macos" }),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    const listed = await service.list(user);
    expect(listed).toEqual([
      {
        id: linked.deviceId,
        name: "Esteban's Mac",
        platform: "macos",
        linkedAt: expect.any(Date),
        revokedAt: null,
      },
    ]);
    expect(listed[0]).not.toHaveProperty("secret");
    expect(listed[0]).not.toHaveProperty("secretHash");

    const storedDevice = await prisma.device.findUniqueOrThrow({ where: { id: linked.deviceId } });
    expect(JSON.stringify(storedDevice)).not.toContain(linked.secret);
    expect(storedDevice.secretCiphertext).not.toBe("");
    expect(storedDevice.secretNonce).not.toBe("");
    expect(storedDevice.secretAuthTag).not.toBe("");
  });

  it("rejects a link code after ten minutes", async () => {
    const { code } = await service.createLinkCode(user);
    await prisma.deviceLinkCode.updateMany({ data: { expiresAt: new Date(Date.now() - 1) } });

    await expect(service.link({ code, name: "Late Mac" })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(await prisma.device.count()).toBe(0);
  });

  it("atomically consumes a pending code after five failed uses", async () => {
    const { code } = await service.createLinkCode(user);
    await prisma.deviceLinkCode.updateMany({ data: { expiresAt: new Date(Date.now() - 1) } });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(
        service.link({ code, name: "Expired Mac" }, `expired-origin-${attempt}`),
      ).rejects.toThrow("Invalid or expired device link code");
    }

    expect(await prisma.deviceLinkCode.findFirstOrThrow()).toMatchObject({
      failedAttemptCount: 5,
      claimedAt: expect.any(Date),
    });
  });

  it("revokes only a device owned by the authenticated user", async () => {
    const { code } = await service.createLinkCode(user);
    const linked = await service.link({ code, name: "Revoked Mac" });
    const otherUser = await prisma.user.create({
      data: { email: "other@example.com" },
      select: { id: true, email: true, displayName: true },
    });

    await expect(service.revoke(otherUser, linked.deviceId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.revoke(user, linked.deviceId)).resolves.toBeUndefined();

    expect(await prisma.device.findUniqueOrThrow({ where: { id: linked.deviceId } })).toMatchObject({
      revokedAt: expect.any(Date),
    });
  });

  it("atomically allows only one concurrent claim", async () => {
    const { code } = await service.createLinkCode(user);

    const claims = await Promise.allSettled([
      service.link({ code, name: "First Mac" }, "first-origin"),
      service.link({ code, name: "Second Mac" }, "second-origin"),
    ]);

    expect(claims.filter((claim) => claim.status === "fulfilled")).toHaveLength(1);
    expect(claims.filter((claim) => claim.status === "rejected")).toHaveLength(1);
    expect(await prisma.device.count()).toBe(1);
    expect(await prisma.deviceLinkCode.findFirstOrThrow()).toMatchObject({
      claimedAt: expect.any(Date),
    });
  });
});
