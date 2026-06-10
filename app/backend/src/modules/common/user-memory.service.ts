import { Inject, Injectable, Logger } from "@nestjs/common";

import { AppConfigService } from "./app-config.service";

export interface StoredMemoryEntry {
  key: string;
  value: string;
  ttl?: number;
  updatedAt: string;
}

@Injectable()
export class UserMemoryService {
  private readonly logger = new Logger(UserMemoryService.name);

  constructor(
    @Inject(AppConfigService)
    private readonly configService: AppConfigService,
  ) {}

  private upstashFetch(path: string, init?: RequestInit) {
    const config = this.configService.get();
    const { upstashRedisRestUrl, upstashRedisRestToken } = config;
    if (!upstashRedisRestUrl || !upstashRedisRestToken) {
      throw new Error(
        "Upstash not configured. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.",
      );
    }
    const url = `${upstashRedisRestUrl.replace(/\/+$/, "")}${path}`;
    return fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${upstashRedisRestToken}`,
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
  }

  async listEntries(userId: string) {
    const prefix = `niki:memory:${userId}:`;
    const keysRes = await this.upstashFetch(`/keys/${encodeURIComponent(prefix + "*")}`);
    const keysData = (await keysRes.json()) as { result?: string[] };
    const keys = keysData.result ?? [];

    if (!keys.length) return [];

    const mgetRes = await this.upstashFetch(
      "/mget/" + keys.map(encodeURIComponent).join("/"),
    );
    const mgetData = (await mgetRes.json()) as { result?: Array<string | null> };

    return keys
      .map((key, index) => {
        const raw = mgetData.result?.[index];
        if (!raw) return null;
        try {
          return JSON.parse(raw) as StoredMemoryEntry;
        } catch {
          return {
            key: key.replace(prefix, ""),
            value: raw,
            updatedAt: new Date().toISOString(),
          } satisfies StoredMemoryEntry;
        }
      })
      .filter((entry): entry is StoredMemoryEntry => entry !== null)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async safeListEntries(userId: string) {
    try {
      return await this.listEntries(userId);
    } catch (error) {
      this.logger.warn(`[memory] safeListEntries failed for ${userId}: ${String(error)}`);
      return [];
    }
  }

  async setEntry(userId: string, key: string, value: string, ttl?: number) {
    const redisKey = `niki:memory:${userId}:${key}`;
    const entry: StoredMemoryEntry = {
      key,
      value,
      ttl,
      updatedAt: new Date().toISOString(),
    };
    const setPath = ttl
      ? `/set/${encodeURIComponent(redisKey)}/${encodeURIComponent(JSON.stringify(entry))}/ex/${ttl}`
      : `/set/${encodeURIComponent(redisKey)}/${encodeURIComponent(JSON.stringify(entry))}`;
    await this.upstashFetch(setPath);
    return entry;
  }

  async setStructuredEntry(
    userId: string,
    key: string,
    payload: Record<string, unknown>,
    ttl?: number,
  ) {
    return this.setEntry(userId, key, JSON.stringify(payload), ttl);
  }

  async deleteEntry(userId: string, key: string) {
    const redisKey = `niki:memory:${userId}:${key}`;
    await this.upstashFetch(`/del/${encodeURIComponent(redisKey)}`);
    return { ok: true };
  }
}
