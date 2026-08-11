import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";

import { PrismaService } from "../database/prisma.service";
import { AuthService } from "./auth.service";

process.env.DATABASE_URL = "postgresql://estebancanales@127.0.0.1:55432/niki_cloud?schema=public";
process.env.MAGIC_CODE_PEPPER = "test-magic-code-pepper";
process.env.SESSION_COOKIE_SECRET = "test-session-cookie-secret";
process.env.NIKI_CLOUD_DEV_AUTH = "1";

const { AppModule } = require("../app.module") as typeof import("../app.module");

describe("AuthService", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let service: AuthService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    service = app.get(AuthService);

    await prisma.webSession.deleteMany();
    await prisma.magicCode.deleteMany();
    await prisma.user.deleteMany();
    await prisma.waitlistEntry.deleteMany();
  });

  afterEach(async () => {
    await app.close();
  });

  it("normalizes duplicate waitlist emails into one record", async () => {
    await service.joinWaitlist(" Person@Example.com ");
    await service.joinWaitlist("person@example.com");

    expect(await prisma.waitlistEntry.count()).toBe(1);
  });

  it("accepts a valid unexpired code once", async () => {
    const code = await service.issueMagicCode("person@example.com");

    await expect(service.verifyMagicCode("person@example.com", code)).resolves.toMatchObject({
      email: "person@example.com",
    });
    await expect(service.verifyMagicCode("person@example.com", code)).rejects.toThrow();
  });

  it("rejects an expired code", async () => {
    const code = await service.issueMagicCode("person@example.com");
    await prisma.magicCode.updateMany({
      data: { expiresAt: new Date(Date.now() - 1) },
      where: { emailNormalized: "person@example.com" },
    });

    await expect(service.verifyMagicCode("person@example.com", code)).rejects.toThrow();
  });

  it("rejects a code after five invalid attempts", async () => {
    const code = await service.issueMagicCode("person@example.com");

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(service.verifyMagicCode("person@example.com", "000000")).rejects.toThrow();
    }

    await expect(service.verifyMagicCode("person@example.com", code)).rejects.toThrow();
  });

  it("stores only a hash for a new web session token", async () => {
    const user = await service.createUserForEmail("person@example.com");
    const token = await service.createSession(user);
    const session = await prisma.webSession.findFirstOrThrow();

    expect(session.tokenHash).not.toBe(token);
    expect(session.tokenHash).toHaveLength(64);
  });
});
