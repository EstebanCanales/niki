import { INestApplication, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { Test } from "@nestjs/testing";

import { AuthUser } from "../auth/auth.service";
import { requireTestDatabaseUrl } from "../auth/test-database";
import { PrismaService } from "../database/prisma.service";
import { DevicesService } from "./devices.service";

process.env.DATABASE_URL = requireTestDatabaseUrl(process.env.DATABASE_URL);
process.env.MAGIC_CODE_PEPPER = "test-magic-code-pepper";
process.env.SESSION_COOKIE_SECRET = "test-session-cookie-secret";
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

    await prisma.creditEntry.deleteMany();
    await prisma.usageEvent.deleteMany();
    await prisma.device.deleteMany();
    await prisma.webSession.deleteMany();
    await prisma.magicCode.deleteMany();
    await prisma.magicCodeLock.deleteMany();
    await prisma.user.deleteMany();

    user = await prisma.user.create({
      data: { email: "devices@example.com" },
      select: { id: true, email: true, displayName: true },
    });
  });

  afterEach(async () => {
    jest.useRealTimers();
    await app.close();
  });

  it("creates a six-character ten-minute link code from the approved alphabet", () => {
    const before = Date.now();
    const result = service.createLinkCode(user);
    const after = Date.now();

    expect(result.code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
    expect(result.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 10 * 60 * 1000);
    expect(result.expiresAt.getTime()).toBeLessThanOrEqual(after + 10 * 60 * 1000);
  });

  it("claims a link code once and returns the device secret only in that response", async () => {
    const { code } = service.createLinkCode(user);

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
  });

  it("rejects a link code after ten minutes", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-08-11T18:00:00.000Z"));
    const { code } = service.createLinkCode(user);
    jest.setSystemTime(new Date("2026-08-11T18:10:00.001Z"));

    await expect(service.link({ code, name: "Late Mac" })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(await prisma.device.count()).toBe(0);
  });

  it("revokes only a device owned by the authenticated user", async () => {
    const { code } = service.createLinkCode(user);
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
});
