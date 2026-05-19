import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";

import type {
  CreateWorkItemRequest,
  UpdateWorkItemRequest,
  WorkItem,
  WorkItemKind,
  WorkItemPriority,
  WorkItemStatus,
  WorkItemSubtask,
} from "../../domain/contracts";
import { LocalDbService } from "../common/local-db.service";
import { RuntimeStateService } from "../common/runtime-state.service";

function nowIso() {
  return new Date().toISOString();
}

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value: string) {
  return normalizeText(value)
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean);
}

function publicWorkItem(item: WorkItem) {
  const { userId: _userId, ...rest } = item;
  return rest;
}

function normalizeSubtasks(subtasks?: WorkItemSubtask[]) {
  return (subtasks ?? [])
    .map((subtask) => ({
      id: subtask.id?.trim() || `subtask-${crypto.randomUUID()}`,
      title: String(subtask.title ?? "").trim(),
      done: Boolean(subtask.done),
    }))
    .filter((subtask) => subtask.title);
}

function normalizePriority(priority?: string): WorkItemPriority {
  return priority === "high" || priority === "low" ? priority : "medium";
}

@Injectable()
export class WorkItemsService {
  private readonly items: WorkItem[] = [];

  constructor(
    @Inject(LocalDbService)
    private readonly localDb: LocalDbService,
    @Inject(RuntimeStateService)
    private readonly runtimeState: RuntimeStateService,
  ) {
    this.items.push(...this.localDb.getWorkItems());
  }

  list(
    userId: string,
    filters?: Partial<{ kind: WorkItemKind; status: WorkItemStatus; search: string }>,
  ) {
    let items = this.items.filter((item) => item.userId === userId);
    if (filters?.kind) items = items.filter((item) => item.kind === filters.kind);
    if (filters?.status) items = items.filter((item) => item.status === filters.status);
    if (filters?.search?.trim()) {
      const query = normalizeText(filters.search);
      items = items.filter((item) => normalizeText(item.title).includes(query));
    }
    items = items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return {
      ok: true,
      items: items.map(publicWorkItem),
    };
  }

  listRaw(userId: string, filters?: Partial<{ kind: WorkItemKind; status: WorkItemStatus }>) {
    return this.items
      .filter((item) => item.userId === userId)
      .filter((item) => (filters?.kind ? item.kind === filters.kind : true))
      .filter((item) => (filters?.status ? item.status === filters.status : true))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  create(
    userId: string,
    input: CreateWorkItemRequest,
    meta?: { correlationId?: string; actor?: "chat" | "manual" },
  ) {
    const title = String(input.title ?? "").trim();
    if (!title) throw new BadRequestException("title is required");

    const item: WorkItem = {
      id: `work-${crypto.randomUUID()}`,
      userId,
      kind: "task",
      title,
      notes: input.notes?.trim() || undefined,
      category: input.category?.trim() || "General",
      status:
        input.status === "done" || input.status === "archived" ? input.status : "open",
      priority: normalizePriority(input.priority),
      dueAt: input.dueAt?.trim() || undefined,
      subtasks: normalizeSubtasks(input.subtasks),
      proposalStatus: input.proposalStatus === "proposed" ? "proposed" : "none",
      createdAt: nowIso(),
      updatedAt: nowIso(),
      sourceSessionId: input.sourceSessionId?.trim() || undefined,
      source: input.source === "manual" ? "manual" : "chat",
    };

    this.items.unshift(item);
    this.persist();
    this.runtimeState.audit(
      userId,
      "work_item.create",
      item.id,
      meta?.correlationId ?? "work-items",
      `Created ${item.kind} "${item.title}" via ${meta?.actor ?? item.source}.`,
    );
    return {
      ok: true,
      item: publicWorkItem(item),
    };
  }

  update(
    userId: string,
    itemId: string,
    patch: UpdateWorkItemRequest,
    meta?: { correlationId?: string },
  ) {
    const item = this.findInternal(userId, itemId);
    const nextTitle = patch.title !== undefined ? String(patch.title).trim() : item.title;
    if (!nextTitle) throw new BadRequestException("title cannot be empty");

    item.title = nextTitle;
    if (patch.kind) item.kind = "task";
    if (patch.notes !== undefined) item.notes = patch.notes?.trim() || undefined;
    if (patch.category !== undefined) item.category = patch.category?.trim() || "General";
    if (patch.status) item.status = patch.status;
    if (patch.priority !== undefined) item.priority = normalizePriority(patch.priority);
    if (patch.dueAt !== undefined) item.dueAt = patch.dueAt?.trim() || undefined;
    if (patch.subtasks !== undefined) item.subtasks = normalizeSubtasks(patch.subtasks);
    if (patch.proposalStatus !== undefined) {
      item.proposalStatus = patch.proposalStatus === "proposed" ? "proposed" : "none";
    }
    item.updatedAt = nowIso();
    this.persist();

    this.runtimeState.audit(
      userId,
      "work_item.update",
      item.id,
      meta?.correlationId ?? "work-items",
      `Updated ${item.kind} "${item.title}".`,
    );
    return {
      ok: true,
      item: publicWorkItem(item),
    };
  }

  delete(userId: string, itemId: string, meta?: { correlationId?: string }) {
    const index = this.items.findIndex((item) => item.userId === userId && item.id === itemId);
    if (index < 0) throw new NotFoundException("work item not found");
    const [item] = this.items.splice(index, 1);
    this.persist();

    this.runtimeState.audit(
      userId,
      "work_item.delete",
      item.id,
      meta?.correlationId ?? "work-items",
      `Deleted ${item.kind} "${item.title}".`,
    );
    return {
      ok: true,
      deletedId: item.id,
      item: publicWorkItem(item),
    };
  }

  findBestMatch(
    userId: string,
    query: string,
    options?: Partial<{ kind: WorkItemKind; preferredIds: string[] }>,
  ) {
    const normalizedQuery = normalizeText(query);
    if (!normalizedQuery) return null;

    const preferredIds = new Set(options?.preferredIds ?? []);
    const queryTokens = tokenize(query);
    let best: { item: WorkItem; score: number } | null = null;

    for (const item of this.listRaw(userId, { kind: options?.kind })) {
      const titleNorm = normalizeText(item.title);
      let score = 0;

      if (titleNorm === normalizedQuery) score += 120;
      if (titleNorm.includes(normalizedQuery) || normalizedQuery.includes(titleNorm)) score += 80;
      if (preferredIds.has(item.id)) score += 28;
      if (item.status === "open") score += 8;

      const titleTokens = new Set(tokenize(item.title));
      for (const token of queryTokens) {
        if (titleTokens.has(token)) score += token.length > 3 ? 14 : 8;
      }

      if (!best || score > best.score) best = { item, score };
    }

    if (!best || best.score < 24) return null;
    return best.item;
  }

  private findInternal(userId: string, itemId: string) {
    const item = this.items.find((entry) => entry.userId === userId && entry.id === itemId);
    if (!item) throw new NotFoundException("work item not found");
    return item;
  }

  private persist() {
    this.localDb.saveWorkItems(this.items);
  }
}
