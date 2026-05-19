"use client";

import { useCallback, useEffect, useState } from "react";

import { wrapperHeaders, wrapperUrl } from "@/core/runtime/wrapper";
import { useWorkspaceStore } from "@/stores/use-workspace-store";

export interface MemoryEntry {
  key: string;
  value: string;
  ttl?: number;
  updatedAt: string;
}

export function useMemory() {
  const baseUrl = useWorkspaceStore((s) => s.backendBaseUrl);
  const apiKey = useWorkspaceStore((s) => s.backendApiKey);
  const userId = useWorkspaceStore((s) => s.userId);

  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const authHeaders = useCallback(() => {
    const h = wrapperHeaders(apiKey);
    if (userId) h.set("x-niki-user-id", userId);
    return h;
  }, [apiKey, userId]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(wrapperUrl(baseUrl, "/v1/memory"), { headers: authHeaders() });
      if (!res.ok) throw new Error(`${res.status}`);
      const data = (await res.json()) as { ok: boolean; entries: MemoryEntry[] };
      setEntries(data.entries ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch memory.");
    } finally {
      setLoading(false);
    }
  }, [baseUrl, authHeaders]);

  const set = useCallback(async (key: string, value: string, ttl?: number) => {
    try {
      await fetch(wrapperUrl(baseUrl, "/v1/memory"), {
        method: "POST",
        headers: (() => {
          const headers = authHeaders();
          headers.set("content-type", "application/json");
          return headers;
        })(),
        body: JSON.stringify({ key, value, ttl }),
      });
      await refresh();
    } catch { /* ignore */ }
  }, [baseUrl, authHeaders, refresh]);

  const del = useCallback(async (key: string) => {
    try {
      await fetch(wrapperUrl(baseUrl, `/v1/memory/${encodeURIComponent(key)}`), {
        method: "DELETE",
        headers: authHeaders(),
      });
      await refresh();
    } catch { /* ignore */ }
  }, [baseUrl, authHeaders, refresh]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { entries, loading, error, refresh, set, del };
}
