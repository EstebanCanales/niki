"use client";

import { useCallback, useEffect, useState } from "react";

import { wrapperHeaders, wrapperUrl } from "@/core/runtime/wrapper";
import { useWorkspaceStore } from "@/stores/use-workspace-store";
import type {
  WorkItem,
  WorkItemKind,
  WorkItemPriority,
  WorkItemStatus,
  WorkItemSubtask,
} from "@/types/niki";

interface WorkItemsState {
  items: WorkItem[];
  loading: boolean;
  actionId: string | null;
  error: string | null;
}

function normalizeWorkItem(item: WorkItem): WorkItem {
  return {
    ...item,
    kind: "task",
    priority:
      item.priority === "high" || item.priority === "low" ? item.priority : "medium",
    proposalStatus: item.proposalStatus === "proposed" ? "proposed" : "none",
    subtasks: Array.isArray(item.subtasks) ? item.subtasks : [],
  };
}

function authHeaders(apiKey: string, userId: string, extra?: HeadersInit) {
  const headers = wrapperHeaders(apiKey, extra);
  if (userId) headers.set("x-niki-user-id", userId);
  return headers;
}

export function useWorkItems() {
  const baseUrl = useWorkspaceStore((state) => state.backendBaseUrl);
  const apiKey = useWorkspaceStore((state) => state.backendApiKey);
  const userId = useWorkspaceStore((state) => state.userId);
  const refreshToken = useWorkspaceStore((state) => state.workItemsRefreshToken);
  const bumpWorkItemsRefreshToken = useWorkspaceStore(
    (state) => state.bumpWorkItemsRefreshToken,
  );

  const [state, setState] = useState<WorkItemsState>({
    items: [],
    loading: false,
    actionId: null,
    error: null,
  });

  const refresh = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: null }));
    try {
      const response = await fetch(wrapperUrl(baseUrl, "/v1/work-items"), {
        headers: authHeaders(apiKey, userId),
        cache: "no-store",
      });
      if (!response.ok) throw new Error((await response.text()) || `${response.status}`);
      const data = (await response.json()) as { items?: WorkItem[] };
      setState((current) => ({
        ...current,
        items: (data.items ?? []).map(normalizeWorkItem),
        loading: false,
        error: null,
      }));
    } catch (error) {
      setState((current) => ({
        ...current,
        loading: false,
        error: error instanceof Error ? error.message : "Failed to fetch work items.",
      }));
    }
  }, [apiKey, baseUrl, userId]);

  const createItem = useCallback(
    async (payload: {
      kind: WorkItemKind;
      title: string;
      category?: string;
      notes?: string;
      priority?: WorkItemPriority;
      dueAt?: string;
      subtasks?: WorkItemSubtask[];
      proposalStatus?: "none" | "proposed";
      source?: "chat" | "manual";
    }) => {
      setState((current) => ({ ...current, actionId: "create", error: null }));
      try {
        const response = await fetch(wrapperUrl(baseUrl, "/v1/work-items"), {
          method: "POST",
          headers: authHeaders(apiKey, userId, { "content-type": "application/json" }),
          body: JSON.stringify({
            ...payload,
            source: payload.source ?? "manual",
          }),
        });
        if (!response.ok) throw new Error((await response.text()) || `${response.status}`);
        const data = (await response.json()) as { item?: WorkItem };
        setState((current) => ({
          ...current,
          items: data.item
            ? [
                normalizeWorkItem(data.item),
                ...current.items.filter((item) => item.id !== data.item!.id),
              ]
            : current.items,
          actionId: null,
          error: null,
        }));
        bumpWorkItemsRefreshToken();
        return data.item ?? null;
      } catch (error) {
        setState((current) => ({
          ...current,
          actionId: null,
          error: error instanceof Error ? error.message : "Failed to create work item.",
        }));
        throw error;
      }
    },
    [apiKey, baseUrl, bumpWorkItemsRefreshToken, userId],
  );

  const updateItem = useCallback(
    async (
      id: string,
      patch: Partial<{
        kind: WorkItemKind;
        title: string;
        notes?: string;
        category?: string;
        status: WorkItemStatus;
        priority: WorkItemPriority;
        dueAt?: string;
        subtasks: WorkItemSubtask[];
        proposalStatus: "none" | "proposed";
      }>,
    ) => {
      setState((current) => ({ ...current, actionId: id, error: null }));
      try {
        const response = await fetch(wrapperUrl(baseUrl, `/v1/work-items/${id}`), {
          method: "PATCH",
          headers: authHeaders(apiKey, userId, { "content-type": "application/json" }),
          body: JSON.stringify(patch),
        });
        if (!response.ok) throw new Error((await response.text()) || `${response.status}`);
        const data = (await response.json()) as { item?: WorkItem };
        setState((current) => ({
          ...current,
          items: data.item
            ? current.items.map((item) =>
                item.id === data.item!.id ? normalizeWorkItem(data.item!) : item,
              )
            : current.items,
          actionId: null,
          error: null,
        }));
        bumpWorkItemsRefreshToken();
        return data.item ?? null;
      } catch (error) {
        setState((current) => ({
          ...current,
          actionId: null,
          error: error instanceof Error ? error.message : "Failed to update work item.",
        }));
        throw error;
      }
    },
    [apiKey, baseUrl, bumpWorkItemsRefreshToken, userId],
  );

  const deleteItem = useCallback(
    async (id: string) => {
      setState((current) => ({ ...current, actionId: id, error: null }));
      try {
        const response = await fetch(wrapperUrl(baseUrl, `/v1/work-items/${id}`), {
          method: "DELETE",
          headers: authHeaders(apiKey, userId),
        });
        if (!response.ok) throw new Error((await response.text()) || `${response.status}`);
        setState((current) => ({
          ...current,
          items: current.items.filter((item) => item.id !== id),
          actionId: null,
          error: null,
        }));
        bumpWorkItemsRefreshToken();
      } catch (error) {
        setState((current) => ({
          ...current,
          actionId: null,
          error: error instanceof Error ? error.message : "Failed to delete work item.",
        }));
        throw error;
      }
    },
    [apiKey, baseUrl, bumpWorkItemsRefreshToken, userId],
  );

  useEffect(() => {
    void refresh();
  }, [refresh, refreshToken]);

  return {
    ...state,
    refresh,
    createItem,
    updateItem,
    deleteItem,
  };
}
