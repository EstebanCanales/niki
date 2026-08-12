import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Device, Prisma } from "@prisma/client";
import { isUUID } from "class-validator";
import { createHash, randomUUID } from "node:crypto";

import { PrismaService } from "../database/prisma.service";
import { ContentCryptoService } from "./content-crypto.service";

export interface DeviceConversationMessage {
  messageId: string;
  role: string;
  content: string;
  occurredAt: string;
}

export interface DeviceConversationBatch {
  previousCursor: string | null;
  cursor: string;
  conversationId: string;
  title?: string;
  messages: DeviceConversationMessage[];
}

export interface ConversationView {
  id: string;
  externalId: string;
  title: string | null;
  lastMessageAt: string | null;
  messages: Array<{
    id: string;
    externalId: string;
    role: string;
    content: string;
    occurredAt: string;
  }>;
}

@Injectable()
export class ConversationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: ContentCryptoService,
  ) {}

  async ingestBatch(
    device: Device,
    batch: DeviceConversationBatch,
  ): Promise<{ accepted: number; duplicates: number; cursor: string }> {
    const prepared = this.prepareBatch(batch);
    const liveDevice = await this.prisma.device.findFirst({
      where: { id: device.id, userId: device.userId, revokedAt: null },
      select: { id: true, userId: true, user: { select: { conversationSyncEnabled: true } } },
    });

    if (!liveDevice) {
      throw new ForbiddenException("Device is not linked");
    }
    if (!liveDevice.user.conversationSyncEnabled) {
      throw new ForbiddenException("Conversation sync is disabled");
    }

    return this.withSerializableRetry((transaction) =>
      this.ingestTransaction(
        transaction,
        liveDevice.userId,
        liveDevice.id,
        prepared,
      ),
    );
  }

  async listConversations(userId: string): Promise<Omit<ConversationView, "messages">[]> {
    const conversations = await this.prisma.conversation.findMany({
      where: { userId },
      orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }],
      select: {
        id: true,
        externalId: true,
        title: true,
        lastMessageAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return conversations.map((conversation) => ({
      id: conversation.id,
      externalId: conversation.externalId,
      title: conversation.title,
      lastMessageAt: conversation.lastMessageAt?.toISOString() ?? null,
    }));
  }

  async getConversation(userId: string, identifier: string): Promise<ConversationView> {
    const conversation = await this.prisma.conversation.findFirst({
      where: {
        userId,
        OR: [
          { externalId: identifier },
          ...(isUUID(identifier) ? [{ id: identifier }] : []),
        ],
      },
      include: { messages: { orderBy: [{ occurredAt: "asc" }, { id: "asc" }] } },
    });

    if (!conversation) {
      throw new NotFoundException("Conversation not found");
    }

    return {
      id: conversation.id,
      externalId: conversation.externalId,
      title: conversation.title,
      lastMessageAt: conversation.lastMessageAt?.toISOString() ?? null,
      messages: conversation.messages.map((message) => ({
        id: message.id,
        externalId: message.externalId,
        role: message.role,
        content: this.crypto.decrypt(message, {
          userId,
          conversationId: conversation.id,
          messageId: message.id,
        }),
        occurredAt: message.occurredAt.toISOString(),
      })),
    };
  }

  async setConversationSync(
    userId: string,
    enabled: boolean,
  ): Promise<{ conversationSyncEnabled: boolean }> {
    const updated = await this.prisma.user.updateMany({
      where: { id: userId },
      data: { conversationSyncEnabled: enabled },
    });
    if (updated.count !== 1) {
      throw new NotFoundException("User not found");
    }
    return { conversationSyncEnabled: enabled };
  }

  private async ingestTransaction(
    transaction: Prisma.TransactionClient,
    userId: string,
    deviceId: string,
    batch: PreparedConversationBatch,
  ): Promise<{ accepted: number; duplicates: number; cursor: string }> {
    const user = await transaction.user.findUnique({
      where: { id: userId },
      select: { conversationSyncEnabled: true },
    });
    if (!user?.conversationSyncEnabled) {
      throw new ForbiddenException("Conversation sync is disabled");
    }

    await transaction.syncCursor.upsert({
      where: { userId_deviceId: { userId, deviceId } },
      create: { userId, deviceId },
      update: {},
    });
    const [syncCursor] = await transaction.$queryRaw<
      Array<{ cursor: string | null; batchDigest: string | null }>
    >`
      SELECT "cursor", "batchDigest"
      FROM "SyncCursor"
      WHERE "userId" = ${userId}::uuid AND "deviceId" = ${deviceId}::uuid
      FOR UPDATE
    `;

    if (syncCursor.cursor === batch.cursor) {
      if (syncCursor.batchDigest !== batch.digest) {
        throw new ConflictException("Conversation cursor payload conflict");
      }
      return { accepted: 0, duplicates: batch.messages.length, cursor: batch.cursor };
    }
    if (syncCursor.cursor !== batch.previousCursor) {
      throw new ConflictException("Conversation cursor is out of sequence");
    }

    const conversation = await transaction.conversation.upsert({
      where: { userId_externalId: { userId, externalId: batch.conversationId } },
      create: {
        userId,
        deviceId,
        externalId: batch.conversationId,
        title: batch.title,
      },
      update: {
        deviceId,
        ...(batch.title === undefined ? {} : { title: batch.title }),
      },
    });

    let accepted = 0;
    let duplicates = 0;
    let lastMessageAt = conversation.lastMessageAt;

    for (const message of batch.messages) {
      const existing = await transaction.message.findUnique({
        where: {
          conversationId_externalId: {
            conversationId: conversation.id,
            externalId: message.messageId,
          },
        },
      });
      if (existing) {
        const content = this.crypto.decrypt(existing, {
          userId,
          conversationId: conversation.id,
          messageId: existing.id,
        });
        if (
          existing.role !== message.role ||
          existing.occurredAt.getTime() !== message.occurredAt.getTime() ||
          content !== message.content
        ) {
          throw new ConflictException("Conversation message payload conflict");
        }
        duplicates += 1;
      } else {
        const id = randomUUID();
        const encrypted = this.crypto.encrypt(message.content, {
          userId,
          conversationId: conversation.id,
          messageId: id,
        });
        await transaction.message.create({
          data: {
            id,
            conversationId: conversation.id,
            externalId: message.messageId,
            role: message.role,
            occurredAt: message.occurredAt,
            ...encrypted,
          },
        });
        accepted += 1;
      }

      if (!lastMessageAt || message.occurredAt > lastMessageAt) {
        lastMessageAt = message.occurredAt;
      }
    }

    await transaction.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt },
    });
    await transaction.syncCursor.update({
      where: { userId_deviceId: { userId, deviceId } },
      data: {
        cursor: batch.cursor,
        batchDigest: batch.digest,
        lastSyncedAt: new Date(),
      },
    });

    return { accepted, duplicates, cursor: batch.cursor };
  }

  private prepareBatch(batch: DeviceConversationBatch): PreparedConversationBatch {
    if (!batch || typeof batch !== "object") {
      throw new BadRequestException("conversation batch is required");
    }
    this.requireString(batch.cursor, "cursor", 256);
    if (batch.previousCursor !== null) {
      this.requireString(batch.previousCursor, "previousCursor", 256);
    }
    if (batch.cursor === batch.previousCursor) {
      throw new BadRequestException("cursor must advance");
    }
    this.requireString(batch.conversationId, "conversationId", 256);
    if (batch.title !== undefined) {
      this.requireString(batch.title, "title", 500);
    }
    if (!Array.isArray(batch.messages) || batch.messages.length === 0) {
      throw new BadRequestException("messages must contain at least one message");
    }
    if (batch.messages.length > 500) {
      throw new BadRequestException("messages exceeds the batch limit");
    }

    const ids = new Set<string>();
    const messages = batch.messages.map((message) => {
      this.requireString(message.messageId, "messageId", 256);
      this.requireString(message.role, "role", 32);
      this.requireString(message.content, "content", 200_000);
      if (ids.has(message.messageId)) {
        throw new BadRequestException("messageId must be unique within a batch");
      }
      ids.add(message.messageId);

      const occurredAt = new Date(message.occurredAt);
      if (Number.isNaN(occurredAt.getTime())) {
        throw new BadRequestException("message occurredAt must be a valid timestamp");
      }
      return { ...message, occurredAt };
    });

    const canonical = {
      previousCursor: batch.previousCursor,
      cursor: batch.cursor,
      conversationId: batch.conversationId,
      title: batch.title ?? null,
      messages: messages.map((message) => ({
        messageId: message.messageId,
        role: message.role,
        content: message.content,
        occurredAt: message.occurredAt.toISOString(),
      })),
    };

    return {
      ...batch,
      messages,
      digest: createHash("sha256").update(JSON.stringify(canonical)).digest("hex"),
    };
  }

  private requireString(value: unknown, name: string, maxLength: number): asserts value is string {
    if (typeof value !== "string" || value.length === 0 || value.length > maxLength) {
      throw new BadRequestException(`${name} must be a non-empty string`);
    }
  }

  private async withSerializableRetry<T>(
    operation: (transaction: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error) {
        const retryable =
          error instanceof Prisma.PrismaClientKnownRequestError &&
          (error.code === "P2034" || error.code === "P2002");
        if (!retryable || attempt === 2) {
          throw error;
        }
      }
    }
    throw new Error("unreachable");
  }
}

interface PreparedConversationBatch
  extends Omit<DeviceConversationBatch, "messages"> {
  messages: Array<Omit<DeviceConversationMessage, "occurredAt"> & { occurredAt: Date }>;
  digest: string;
}
