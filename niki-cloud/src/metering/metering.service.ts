import { BadRequestException, Injectable } from "@nestjs/common";
import { Device, Prisma } from "@prisma/client";

import { PrismaService } from "../database/prisma.service";
import { DeviceUsageBatch, DeviceUsageEvent, UsageCategory } from "./metering.types";

const MAX_POSTGRES_BIGINT = 9_223_372_036_854_775_807n;

export const CREDIT_MICROS_PER_CREDIT = 1_000_000n;

export const CREDIT_MICROS_PER_UNIT: Readonly<Record<UsageCategory, bigint>> = {
  "chat.input_tokens": 1n,
  "chat.output_tokens": 2n,
  "voice.stt_seconds": 10_000n,
  "voice.tts_seconds": 20_000n,
  "tool.call": 50_000n,
};

export interface MeteringIngestResult {
  accepted: number;
  duplicates: number;
}

@Injectable()
export class MeteringService {
  constructor(private readonly prisma: PrismaService) {}

  async ingest(device: Device, batch: DeviceUsageBatch): Promise<MeteringIngestResult> {
    if (!Array.isArray(batch.events) || batch.events.length === 0) {
      throw new BadRequestException("events must contain at least one usage event");
    }

    const preparedEvents = batch.events.map((event) => this.prepareEvent(event));

    const accepted = await this.prisma.$transaction(async (transaction) => {
      let insertedCount = 0;

      for (const prepared of preparedEvents) {
        const inserted = await transaction.usageEvent.createMany({
          data: [
            {
              eventId: prepared.event.eventId,
              userId: device.userId,
              deviceId: device.id,
              externalConversationId: prepared.event.conversationId,
              category: prepared.event.category,
              quantity: BigInt(prepared.event.quantity),
              model: prepared.event.model,
              metadata: prepared.metadata,
              occurredAt: prepared.occurredAt,
            },
          ],
          skipDuplicates: true,
        });

        if (inserted.count === 0) {
          continue;
        }

        await transaction.creditEntry.create({
          data: {
            userId: device.userId,
            sourceEventId: prepared.event.eventId,
            amountMicros: -prepared.costMicros,
            kind: "usage_debit",
          },
        });
        insertedCount += 1;
      }

      return insertedCount;
    });

    return { accepted, duplicates: batch.events.length - accepted };
  }

  private prepareEvent(event: DeviceUsageEvent): {
    event: DeviceUsageEvent;
    occurredAt: Date;
    metadata: Prisma.InputJsonValue | undefined;
    costMicros: bigint;
  } {
    if (!Number.isSafeInteger(event.quantity) || event.quantity <= 0) {
      throw new BadRequestException("event quantity must be a positive safe integer");
    }

    const rate = CREDIT_MICROS_PER_UNIT[event.category];
    if (rate === undefined) {
      throw new BadRequestException("event category is not supported");
    }

    const occurredAt = new Date(event.occurredAt);
    if (Number.isNaN(occurredAt.getTime())) {
      throw new BadRequestException("event occurredAt must be a valid timestamp");
    }

    if (
      event.metadata &&
      Object.values(event.metadata).some((value) => typeof value !== "string")
    ) {
      throw new BadRequestException("event metadata values must be strings");
    }

    const costMicros = BigInt(event.quantity) * rate;
    if (costMicros > MAX_POSTGRES_BIGINT) {
      throw new BadRequestException("event quantity exceeds the credit ledger limit");
    }

    return {
      event,
      occurredAt,
      metadata: event.metadata as Prisma.InputJsonValue | undefined,
      costMicros,
    };
  }
}
