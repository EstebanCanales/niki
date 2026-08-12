import { ConflictException, INestApplication, NotFoundException } from "@nestjs/common";
import { Device, User } from "@prisma/client";
import { Test } from "@nestjs/testing";

import { requireTestDatabaseUrl } from "../auth/test-database";
import { PrismaService } from "../database/prisma.service";
import { resetTestDatabase } from "../testing/reset-test-database";
import { ConversationsService, DeviceConversationBatch } from "./conversations.service";

process.env.DATABASE_URL = requireTestDatabaseUrl(process.env.DATABASE_URL);
process.env.MAGIC_CODE_PEPPER = "test-magic-code-pepper";
process.env.SESSION_COOKIE_SECRET = "test-session-cookie-secret";
process.env.DEVICE_SECRET_ENCRYPTION_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
process.env.CONVERSATION_ENCRYPTION_KEY = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=";
process.env.NIKI_CLOUD_DEV_AUTH = "1";

const { AppModule } = require("../app.module") as typeof import("../app.module");

describe("ConversationsService", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let service: ConversationsService;
  let user: User;
  let device: Device;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    service = app.get(ConversationsService);

    await resetTestDatabase(prisma);
    user = await prisma.user.create({
      data: { email: "conversation@example.com", conversationSyncEnabled: true },
    });
    device = await prisma.device.create({
      data: {
        userId: user.id,
        name: "Conversation Mac",
        secretCiphertext: "unused",
        secretNonce: "unused",
        secretAuthTag: "unused",
      },
    });
  });

  afterEach(async () => {
    await app.close();
  });

  const batch = (overrides: Partial<DeviceConversationBatch> = {}): DeviceConversationBatch => ({
    previousCursor: null,
    cursor: "cursor-1",
    conversationId: "local-thread-1",
    title: "Plan de lanzamiento",
    messages: [
      {
        messageId: "local-message-1",
        role: "user",
        content: "Recuerda que el lanzamiento es el viernes.",
        occurredAt: "2026-08-11T15:00:00.000Z",
      },
      {
        messageId: "local-message-2",
        role: "assistant",
        content: "Lo tendré presente.",
        occurredAt: "2026-08-11T15:00:01.000Z",
      },
    ],
    ...overrides,
  });

  it("rejects message content while conversation sync is disabled", async () => {
    await prisma.user.update({
      where: { id: user.id },
      data: { conversationSyncEnabled: false },
    });

    await expect(service.ingestBatch(device, batch())).rejects.toThrow(
      "Conversation sync is disabled",
    );
    expect(await prisma.conversation.count()).toBe(0);
    expect(await prisma.syncCursor.count()).toBe(0);
  });

  it("stores separate encrypted fields and decrypts content only for its owner", async () => {
    await service.ingestBatch(device, batch());

    const stored = await prisma.message.findFirstOrThrow({
      where: { externalId: "local-message-1" },
    });
    expect(stored.contentCiphertext).not.toContain("Recuerda que el lanzamiento es el viernes.");
    expect(stored.contentNonce).not.toBe(stored.contentCiphertext);
    expect(stored.contentAuthTag).not.toBe(stored.contentCiphertext);

    const conversation = await service.getConversation(user.id, "local-thread-1");
    expect(conversation.messages.map((message) => message.content)).toEqual([
      "Recuerda que el lanzamiento es el viernes.",
      "Lo tendré presente.",
    ]);
  });

  it("never lists or returns another tenant's conversations", async () => {
    await service.ingestBatch(device, batch());
    const other = await prisma.user.create({
      data: { email: "conversation-other@example.com", conversationSyncEnabled: true },
    });

    await expect(service.listConversations(other.id)).resolves.toEqual([]);
    await expect(service.getConversation(other.id, "local-thread-1")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("deduplicates an exact cursor replay and rejects a changed payload with that cursor", async () => {
    await expect(service.ingestBatch(device, batch())).resolves.toEqual({
      accepted: 2,
      duplicates: 0,
      cursor: "cursor-1",
    });
    await expect(service.ingestBatch(device, batch())).resolves.toEqual({
      accepted: 0,
      duplicates: 2,
      cursor: "cursor-1",
    });

    await expect(
      service.ingestBatch(
        device,
        batch({ messages: [{ ...batch().messages[0], content: "payload modificado" }] }),
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(await prisma.message.count()).toBe(2);
    expect(await prisma.syncCursor.findUniqueOrThrow({
      where: { userId_deviceId: { userId: user.id, deviceId: device.id } },
    })).toMatchObject({ cursor: "cursor-1" });
  });

  it("requires a continuous cursor chain and advances it only after a valid batch commits", async () => {
    await service.ingestBatch(device, batch());

    await expect(
      service.ingestBatch(device, batch({ previousCursor: "wrong", cursor: "cursor-2" })),
    ).rejects.toBeInstanceOf(ConflictException);

    await expect(
      service.ingestBatch(
        device,
        batch({
          previousCursor: "cursor-1",
          cursor: "cursor-2",
          messages: [{ ...batch().messages[0], messageId: "local-message-3", occurredAt: "bad" }],
        }),
      ),
    ).rejects.toThrow("occurredAt");

    expect(await prisma.syncCursor.findUniqueOrThrow({
      where: { userId_deviceId: { userId: user.id, deviceId: device.id } },
    })).toMatchObject({ cursor: "cursor-1" });

    await expect(
      service.ingestBatch(
        device,
        batch({
          previousCursor: "cursor-1",
          cursor: "cursor-2",
          messages: [
            {
              ...batch().messages[0],
              messageId: "local-message-3",
              occurredAt: "2026-08-11T16:00:00.000Z",
            },
          ],
        }),
      ),
    ).resolves.toEqual({ accepted: 1, duplicates: 0, cursor: "cursor-2" });
  });

  it("updates the owner's explicit conversation-sync preference", async () => {
    await expect(service.setConversationSync(user.id, false)).resolves.toEqual({
      conversationSyncEnabled: false,
    });
    expect(await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).toMatchObject({
      conversationSyncEnabled: false,
    });
  });
});
