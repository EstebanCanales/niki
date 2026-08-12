import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { createHmac, randomUUID } from "node:crypto";
import request from "supertest";

import { AuthService } from "../auth/auth.service";
import { requireTestDatabaseUrl } from "../auth/test-database";
import { PrismaService } from "../database/prisma.service";
import { DeviceSecretEncryptionService } from "../devices/device-secret-encryption.service";
import { resetTestDatabase } from "../testing/reset-test-database";

process.env.DATABASE_URL = requireTestDatabaseUrl(process.env.DATABASE_URL);
process.env.MAGIC_CODE_PEPPER = "test-magic-code-pepper";
process.env.SESSION_COOKIE_SECRET = "test-session-cookie-secret";
process.env.DEVICE_SECRET_ENCRYPTION_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
process.env.CONVERSATION_ENCRYPTION_KEY = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=";
process.env.NIKI_CLOUD_DEV_AUTH = "1";

const { AppModule } = require("../app.module") as typeof import("../app.module");

describe("ConversationsController", () => {
  const secret = "conversation-route-device-secret";
  let app: INestApplication;
  let cookie: string;
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

    const auth = app.get(AuthService);
    const user = await auth.createUserForEmail("conversation-route@example.com");
    const token = await auth.createSession(user);
    cookie = `niki_session=${auth.signSessionToken(token)}`;
    const newDeviceId = randomUUID();
    const encryptedSecret = app
      .get(DeviceSecretEncryptionService)
      .encrypt(secret, newDeviceId);
    const device = await prisma.device.create({
      data: { id: newDeviceId, userId: user.id, name: "Route Conversation Mac", ...encryptedSecret },
    });
    deviceId = device.id;
  });

  afterEach(async () => {
    await app.close();
  });

  it.each(["/v1/conversations", `/v1/conversations/${randomUUID()}`])(
    "requires an authenticated session for %s",
    async (path) => {
      await request(app.getHttpServer()).get(path).expect(401);
    },
  );

  it("requires explicit opt-in, accepts a signed batch, and exposes it only in that session", async () => {
    await request(app.getHttpServer())
      .patch("/v1/settings/conversation-sync")
      .send({ enabled: true })
      .expect(401);
    await request(app.getHttpServer())
      .patch("/v1/settings/conversation-sync")
      .set("Cookie", cookie)
      .send({ enabled: true })
      .expect(200, { conversationSyncEnabled: true });

    const rawBody = JSON.stringify({
      previousCursor: null,
      cursor: "route-cursor-1",
      conversationId: "route-thread-1",
      title: "Conversación firmada",
      messages: [
        {
          messageId: "route-message-1",
          role: "user",
          content: "Contenido privado firmado",
          occurredAt: "2026-08-11T18:00:00.000Z",
        },
      ],
    });
    const timestamp = String(Date.now());
    const signature = createHmac("sha256", secret)
      .update(`${timestamp}.${rawBody}`)
      .digest("hex");

    await request(app.getHttpServer())
      .post("/v1/device-conversations/batch")
      .set("Content-Type", "application/json")
      .send(rawBody)
      .expect(401);
    await request(app.getHttpServer())
      .post("/v1/device-conversations/batch")
      .set("Content-Type", "application/json")
      .set("x-niki-device-id", deviceId)
      .set("x-niki-timestamp", timestamp)
      .set("x-niki-signature", signature)
      .send(rawBody)
      .expect(201, { accepted: 1, duplicates: 0, cursor: "route-cursor-1" });

    const listed = await request(app.getHttpServer())
      .get("/v1/conversations")
      .set("Cookie", cookie)
      .expect(200);
    expect(listed.body).toEqual([
      expect.objectContaining({ externalId: "route-thread-1", title: "Conversación firmada" }),
    ]);

    const detail = await request(app.getHttpServer())
      .get(`/v1/conversations/${listed.body[0].id}`)
      .set("Cookie", cookie)
      .expect(200);
    expect(detail.body.messages).toEqual([
      expect.objectContaining({ content: "Contenido privado firmado" }),
    ]);
  });

  it("rejects signed content until the owner opts in", async () => {
    const rawBody = JSON.stringify({
      previousCursor: null,
      cursor: "disabled-cursor",
      conversationId: "disabled-thread",
      messages: [
        {
          messageId: "disabled-message",
          role: "user",
          content: "No almacenar",
          occurredAt: "2026-08-11T18:00:00.000Z",
        },
      ],
    });
    const timestamp = String(Date.now());
    const signature = createHmac("sha256", secret)
      .update(`${timestamp}.${rawBody}`)
      .digest("hex");

    await request(app.getHttpServer())
      .post("/v1/device-conversations/batch")
      .set("Content-Type", "application/json")
      .set("x-niki-device-id", deviceId)
      .set("x-niki-timestamp", timestamp)
      .set("x-niki-signature", signature)
      .send(rawBody)
      .expect(403);
    expect(await prisma.message.count()).toBe(0);
  });
});
