import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";

import { AuthService } from "../auth/auth.service";
import { requireTestDatabaseUrl } from "../auth/test-database";
import { PrismaService } from "../database/prisma.service";
import { resetTestDatabase } from "../testing/reset-test-database";

process.env.DATABASE_URL = requireTestDatabaseUrl(process.env.DATABASE_URL);
process.env.MAGIC_CODE_PEPPER = "test-magic-code-pepper";
process.env.SESSION_COOKIE_SECRET = "test-session-cookie-secret";
process.env.DEVICE_SECRET_ENCRYPTION_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
process.env.NIKI_CLOUD_DEV_AUTH = "1";

const { AppModule } = require("../app.module") as typeof import("../app.module");

describe("DevicesController", () => {
  let app: INestApplication;
  let cookie: string;
  let prisma: PrismaService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
    );
    await app.init();
    prisma = app.get(PrismaService);

    await resetTestDatabase(prisma);

    const auth = app.get(AuthService);
    const user = await auth.createUserForEmail("device-route@example.com");
    const token = await auth.createSession(user);
    cookie = `niki_session=${auth.signSessionToken(token)}`;
  });

  afterEach(async () => {
    await app.close();
  });

  it("requires a session to issue a link code", async () => {
    await request(app.getHttpServer()).post("/v1/devices/link-code").expect(401);
  });

  it("links, lists, and revokes a device through the public contracts", async () => {
    const issued = await request(app.getHttpServer())
      .post("/v1/devices/link-code")
      .set("Cookie", cookie)
      .expect(201);
    expect(issued.body).toEqual({
      code: expect.stringMatching(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/),
      expiresAt: expect.any(String),
    });

    const linked = await request(app.getHttpServer())
      .post("/v1/devices/link")
      .send({ code: issued.body.code, name: "Route Mac", platform: "macos" })
      .expect(201);
    expect(linked.body).toEqual({ deviceId: expect.any(String), secret: expect.any(String) });

    const listed = await request(app.getHttpServer())
      .get("/v1/devices")
      .set("Cookie", cookie)
      .expect(200);
    expect(listed.body).toEqual([
      {
        id: linked.body.deviceId,
        name: "Route Mac",
        platform: "macos",
        linkedAt: expect.any(String),
        revokedAt: null,
      },
    ]);

    await request(app.getHttpServer())
      .delete(`/v1/devices/${linked.body.deviceId}`)
      .set("Cookie", cookie)
      .expect(200, { ok: true });
  });

  it("links a code after the issuing application instance restarts", async () => {
    const issued = await request(app.getHttpServer())
      .post("/v1/devices/link-code")
      .set("Cookie", cookie)
      .expect(201);

    await app.close();
    const restartedModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = restartedModule.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
    );
    await app.init();

    await request(app.getHttpServer())
      .post("/v1/devices/link")
      .send({ code: issued.body.code, name: "Restarted Mac", platform: "macos" })
      .expect(201);
  });

  it("locks an origin after five failed link attempts and keeps errors generic", async () => {
    const issued = await request(app.getHttpServer())
      .post("/v1/devices/link-code")
      .set("Cookie", cookie)
      .expect(201);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const failed = await request(app.getHttpServer())
        .post("/v1/devices/link")
        .send({ code: `AAAAA${attempt + 2}`, name: "Guessing Mac" })
        .expect(401);
      expect(failed.body.message).toBe("Invalid or expired device link code");
    }

    const locked = await request(app.getHttpServer())
      .post("/v1/devices/link")
      .send({ code: issued.body.code, name: "Blocked Mac" })
      .expect(401);
    expect(locked.body.message).toBe("Invalid or expired device link code");
    expect(await prisma.device.count()).toBe(0);
    expect(await prisma.deviceLinkAttempt.findFirstOrThrow()).toMatchObject({
      failedAttemptCount: 5,
      lockedUntil: expect.any(Date),
    });
  });
});
