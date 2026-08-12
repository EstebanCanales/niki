import { INestApplication, ServiceUnavailableException, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";

import { AppConfigService } from "../config/app-config.service";
import { PrismaService } from "../database/prisma.service";
import { resetTestDatabase } from "../testing/reset-test-database";
import { MailerService } from "./mailer.service";
import { requireTestDatabaseUrl } from "./test-database";

process.env.DATABASE_URL = requireTestDatabaseUrl(process.env.DATABASE_URL);
process.env.MAGIC_CODE_PEPPER = "test-magic-code-pepper";
process.env.SESSION_COOKIE_SECRET = "test-session-cookie-secret";
process.env.DEVICE_SECRET_ENCRYPTION_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
process.env.NIKI_CLOUD_DEV_AUTH = "1";

const { AppModule } = require("../app.module") as typeof import("../app.module");

describe("AuthController", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
    prisma = app.get(PrismaService);

    await resetTestDatabase(prisma);
  });

  afterEach(async () => {
    await app.close();
  });

  it("accepts duplicate waitlist requests and rejects invalid emails", async () => {
    await request(app.getHttpServer())
      .post("/v1/waitlist")
      .send({ email: " Person@Example.com " })
      .expect(201);
    await request(app.getHttpServer())
      .post("/v1/waitlist")
      .send({ email: "person@example.com" })
      .expect(201);
    await request(app.getHttpServer())
      .post("/v1/waitlist")
      .send({ email: "not-an-email" })
      .expect(400);

    expect(await prisma.waitlistEntry.count()).toBe(1);
  });

  it("creates a secure session cookie and exposes the authenticated user", async () => {
    const requested = await request(app.getHttpServer())
      .post("/v1/auth/request-code")
      .send({ email: "person@example.com" })
      .expect(201);

    expect(requested.body.debugCode).toMatch(/^\d{6}$/);

    const verified = await request(app.getHttpServer())
      .post("/v1/auth/verify-code")
      .send({ email: "person@example.com", code: requested.body.debugCode })
      .expect(201);
    const cookie = verified.headers["set-cookie"]?.[0];

    expect(cookie).toEqual(expect.stringContaining("niki_session="));
    expect(cookie).toEqual(expect.stringContaining("HttpOnly"));
    expect(cookie).toEqual(expect.stringContaining("SameSite=Lax"));

    const me = await request(app.getHttpServer())
      .get("/v1/me")
      .set("Cookie", cookie)
      .expect(200);

    expect(me.body).toEqual({
      id: expect.any(String),
      email: "person@example.com",
      displayName: null,
    });
  });

  it("rejects an expired code over HTTP", async () => {
    const requested = await request(app.getHttpServer())
      .post("/v1/auth/request-code")
      .send({ email: "person@example.com" })
      .expect(201);
    await prisma.magicCode.updateMany({
      data: { expiresAt: new Date(Date.now() - 1) },
      where: { emailNormalized: "person@example.com" },
    });

    await request(app.getHttpServer())
      .post("/v1/auth/verify-code")
      .send({ email: "person@example.com", code: requested.body.debugCode })
      .expect(401);
  });

  it("clears the session cookie on logout", async () => {
    const response = await request(app.getHttpServer()).post("/v1/auth/logout").expect(201);
    const cookie = response.headers["set-cookie"]?.[0];

    expect(cookie).toEqual(expect.stringContaining("niki_session=;"));
    expect(cookie).toEqual(expect.stringContaining("Expires=Thu, 01 Jan 1970 00:00:00 GMT"));
  });

  it("revokes an undelivered code when mail delivery fails", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(AppConfigService)
      .useValue({
        deviceSecretEncryptionKey: Buffer.alloc(32),
        isDevAuthEnabled: false,
        magicCodePepper: "test-magic-code-pepper",
        sessionCookieSecret: "test-session-cookie-secret",
      })
      .overrideProvider(MailerService)
      .useValue({
        sendMagicCode: async () => {
          throw new ServiceUnavailableException("mail delivery failed");
        },
      })
      .compile();
    const productionApp = moduleRef.createNestApplication();
    productionApp.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await productionApp.init();

    try {
      const response = await request(productionApp.getHttpServer())
        .post("/v1/auth/request-code")
        .send({ email: "person@example.com" })
        .expect(503);

      expect(response.body.debugCode).toBeUndefined();
      expect(await prisma.magicCode.count()).toBe(0);
    } finally {
      await productionApp.close();
    }
  });

  it("omits debugCode and uses the mailer outside development", async () => {
    const delivered: Array<{ email: string; code: string }> = [];
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(AppConfigService)
      .useValue({
        deviceSecretEncryptionKey: Buffer.alloc(32),
        isDevAuthEnabled: false,
        magicCodePepper: "test-magic-code-pepper",
        sessionCookieSecret: "test-session-cookie-secret",
      })
      .overrideProvider(MailerService)
      .useValue({
        sendMagicCode: async (email: string, code: string) => {
          delivered.push({ email, code });
        },
      })
      .compile();
    const productionApp = moduleRef.createNestApplication();
    productionApp.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await productionApp.init();

    try {
      const response = await request(productionApp.getHttpServer())
        .post("/v1/auth/request-code")
        .send({ email: "person@example.com" })
        .expect(201);

      expect(response.body).toEqual({ ok: true });
      expect(delivered).toEqual([{ email: "person@example.com", code: expect.stringMatching(/^\d{6}$/) }]);
    } finally {
      await productionApp.close();
    }
  });

  it("marks the session cookie Secure in production", async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";

    try {
      const requested = await request(app.getHttpServer())
        .post("/v1/auth/request-code")
        .send({ email: "person@example.com" })
        .expect(201);
      const verified = await request(app.getHttpServer())
        .post("/v1/auth/verify-code")
        .send({ email: "person@example.com", code: requested.body.debugCode })
        .expect(201);

      expect(verified.headers["set-cookie"]?.[0]).toEqual(expect.stringContaining("Secure"));
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
    }
  });
});
