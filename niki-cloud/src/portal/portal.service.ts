import { Injectable } from "@nestjs/common";

import { PrismaService } from "../database/prisma.service";

export type UsagePeriod = "day" | "week" | "month";

export interface UsageSummary {
  period: UsagePeriod;
  startsAt: string;
  endsAt: string;
  totalQuantity: string;
  byCategory: Record<string, string>;
}

export interface CreditEntryView {
  id: string;
  amountMicros: string;
  kind: string;
  sourceEventId: string | null;
  createdAt: string;
}

@Injectable()
export class PortalService {
  constructor(private readonly prisma: PrismaService) {}

  async getUsage(userId: string, period: UsagePeriod, now = new Date()): Promise<UsageSummary> {
    const { startsAt, endsAt } = periodBounds(period, now);
    const grouped = await this.prisma.usageEvent.groupBy({
      by: ["category"],
      where: {
        userId,
        occurredAt: { gte: startsAt, lt: endsAt },
      },
      _sum: { quantity: true },
    });
    const byCategory = Object.fromEntries(
      grouped
        .sort((left, right) => left.category.localeCompare(right.category))
        .map((row) => [row.category, (row._sum.quantity ?? 0n).toString()]),
    );
    const totalQuantity = grouped.reduce(
      (total, row) => total + (row._sum.quantity ?? 0n),
      0n,
    );

    return {
      period,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      totalQuantity: totalQuantity.toString(),
      byCategory,
    };
  }

  async getCredits(userId: string): Promise<{
    balanceMicros: string;
    entries: CreditEntryView[];
  }> {
    const [balance, entries] = await this.prisma.$transaction([
      this.prisma.creditEntry.aggregate({
        where: { userId },
        _sum: { amountMicros: true },
      }),
      this.prisma.creditEntry.findMany({
        where: { userId },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      }),
    ]);

    return {
      balanceMicros: (balance._sum.amountMicros ?? 0n).toString(),
      entries: entries.map((entry) => ({
        id: entry.id,
        amountMicros: entry.amountMicros.toString(),
        kind: entry.kind,
        sourceEventId: entry.sourceEventId,
        createdAt: entry.createdAt.toISOString(),
      })),
    };
  }

  async getDashboard(userId: string, now = new Date()): Promise<{
    balanceMicros: string;
    activeDeviceCount: number;
    conversationSyncEnabled: boolean;
    usage: UsageSummary;
  }> {
    const [credits, usage, activeDeviceCount, user] = await Promise.all([
      this.getCredits(userId),
      this.getUsage(userId, "month", now),
      this.prisma.device.count({ where: { userId, revokedAt: null } }),
      this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { conversationSyncEnabled: true },
      }),
    ]);

    return {
      balanceMicros: credits.balanceMicros,
      activeDeviceCount,
      conversationSyncEnabled: user.conversationSyncEnabled,
      usage,
    };
  }
}

function periodBounds(period: UsagePeriod, now: Date): { startsAt: Date; endsAt: Date } {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const date = now.getUTCDate();

  if (period === "month") {
    return {
      startsAt: new Date(Date.UTC(year, month, 1)),
      endsAt: new Date(Date.UTC(year, month + 1, 1)),
    };
  }

  const startsAt = new Date(Date.UTC(year, month, date));
  if (period === "week") {
    const daysSinceMonday = (startsAt.getUTCDay() + 6) % 7;
    startsAt.setUTCDate(startsAt.getUTCDate() - daysSinceMonday);
  }

  const endsAt = new Date(startsAt);
  endsAt.setUTCDate(endsAt.getUTCDate() + (period === "week" ? 7 : 1));
  return { startsAt, endsAt };
}
