import { ForbiddenException, Inject, Injectable, Logger } from "@nestjs/common";
import type { Request, Response } from "express";

import type { WorkItemKind, WorkItemStatus } from "../domain/contracts";
import { AuditService } from "../modules/audit/audit.service";
import { ComputerControlService } from "../modules/computer/computer-control.service";
import { UserMemoryService } from "../modules/common/user-memory.service";
import {
  actingUserIdFrom,
  correlationIdFrom,
  isTrustedOrigin,
} from "../modules/common/request-context";
import { IdentityService } from "../modules/identity/identity.service";
import { RuntimeService } from "../modules/runtime/runtime.service";
import { WorkItemsService } from "../modules/work-items/work-items.service";
import type { ChatRequestDto } from "./wrapper.types";

type NotchQueuedFile = {
  name: string;
  path: string;
  kind: string;
};

type NotchQueuedRequest = {
  id: string;
  userId: string;
  text: string;
  createdAt: string;
  files: NotchQueuedFile[];
};

@Injectable()
export class WrapperService {
  private readonly logger = new Logger(WrapperService.name);
  private readonly notchQueue = new Map<string, NotchQueuedRequest[]>();

  constructor(
    @Inject(RuntimeService)
    private readonly runtimeService: RuntimeService,
    @Inject(IdentityService)
    private readonly identityService: IdentityService,
    @Inject(AuditService)
    private readonly auditService: AuditService,
    @Inject(UserMemoryService)
    private readonly userMemoryService: UserMemoryService,
    @Inject(WorkItemsService)
    private readonly workItemsService: WorkItemsService,
    @Inject(ComputerControlService)
    private readonly computerControl: ComputerControlService,
  ) {}

  computerCapabilities() {
    return {
      ok: true,
      config: this.computerControl.getConfig(),
      permissions: this.computerControl.permissions(),
      capabilities: this.computerControl.capabilitiesList(),
    };
  }

  computerConfig() {
    return { ok: true, config: this.computerControl.getConfig() };
  }

  updateComputerConfig(input: { mode?: string; allowedRoots?: string[] }) {
    return { ok: true, config: this.computerControl.setConfig(input) };
  }

  computerRecent(limit?: number) {
    return { ok: true, recent: this.computerControl.recentActions(limit) };
  }

  async computerAction(
    req: Request,
    body: { action?: string; params?: Record<string, unknown> },
  ) {
    const action = String(body?.action ?? "").trim();
    if (!action) return { ok: false, error: "action is required" };
    const params = body?.params && typeof body.params === "object" ? body.params : {};
    return this.computerControl.run(action, params, {
      userId: actingUserIdFrom(req),
      correlationId: correlationIdFrom(req),
      source: "api",
    });
  }

  assertAuthorized(req: Request) {
    this.runtimeService.assertWrapperAuthorized(req);
  }

  /** Rechaza peticiones desde orígenes web externos (anti drive-by RCE). */
  assertTrustedOrigin(req: Request) {
    if (!isTrustedOrigin(req)) {
      throw new ForbiddenException("cross-origin request blocked");
    }
  }

  assertRuntimeEventsAuthorized(req: Request) {
    this.runtimeService.assertRuntimeEventsAuthorized(req);
  }

  healthz(req: Request) {
    return this.runtimeService.legacyHealth(req);
  }

  publicConfig() {
    return this.runtimeService.publicConfig();
  }

  runtimeConfig() {
    return this.runtimeService.getRuntimeConfig();
  }

  updateRuntimeConfig(input: {
    apiServerUrl?: string;
    apiKey?: string;
    model?: string;
    contextLengthOverride?: number | string | null;
    compatibilityMode?: string;
    diagnosticsEnabled?: boolean;
  }) {
    return this.runtimeService.updateRuntimeConfig(input);
  }

  runtimeStatus() {
    return this.runtimeService.status();
  }

  streamRuntimeEvents(req: Request, res: Response) {
    return this.runtimeService.streamRuntimeEvents(req, res);
  }

  proxyChatStream(req: Request, res: Response, body: ChatRequestDto) {
    return this.runtimeService.proxyChatStream(req, res, body);
  }

  enqueueNotchRequest(
    req: Request,
    body: {
      text?: string;
      createdAt?: string;
      files?: Array<{
        name?: string;
        path?: string;
        kind?: string;
      }>;
    },
  ) {
    const userId = actingUserIdFrom(req);
    const text = String(body.text ?? "").trim();
    const files = Array.isArray(body.files)
      ? body.files.map((file) => ({
          name: String(file.name ?? "").trim(),
          path: String(file.path ?? "").trim(),
          kind: String(file.kind ?? "").trim(),
        }))
      : [];
    const createdAt = String(body.createdAt ?? "").trim() || new Date().toISOString();
    const next: NotchQueuedRequest = {
      id: `notch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      userId,
      text,
      createdAt,
      files,
    };
    const queue = this.notchQueue.get(userId) ?? [];
    queue.push(next);
    this.notchQueue.set(userId, queue);
    this.logger.log(
      `[notch] queued user=${userId} request=${next.id} pending=${queue.length} textChars=${text.length} fileCount=${files.length}`,
    );
    return {
      ok: true,
      requestId: next.id,
      pending: queue.length,
    };
  }

  consumeNotchRequest(req: Request) {
    const userId = actingUserIdFrom(req);
    const queue = this.notchQueue.get(userId) ?? [];
    const next = queue.shift() ?? null;
    if (queue.length > 0) {
      this.notchQueue.set(userId, queue);
    } else {
      this.notchQueue.delete(userId);
    }

    if (!next) {
      return { ok: true, request: null };
    }

    this.logger.log(
      `[notch] delivered user=${userId} request=${next.id} remaining=${queue.length} textChars=${next.text.length} fileCount=${next.files.length}`,
    );
    return {
      ok: true,
      request: {
        text: next.text,
        files: next.files,
        createdAt: next.createdAt,
      },
    };
  }

  me(req: Request) {
    return this.identityService.me(actingUserIdFrom(req));
  }

  activities(req: Request) {
    return this.auditService.activities(actingUserIdFrom(req));
  }

  async listMemory(req: Request) {
    const userId = actingUserIdFrom(req);
    try {
      const entries = await this.userMemoryService.listEntries(userId);
      return { ok: true, entries };
    } catch (err) {
      this.logger.error(`[memory] listMemory error: ${String(err)}`);
      return { ok: false, entries: [], error: String(err) };
    }
  }

  async setMemory(key: string, value: string, ttl: number | undefined, req: Request) {
    const userId = actingUserIdFrom(req);
    try {
      await this.userMemoryService.setEntry(userId, key, value, ttl);
      this.logger.log(`[memory] set key=${userId}:${key}`);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }

  async deleteMemory(key: string, req: Request) {
    const userId = actingUserIdFrom(req);
    try {
      await this.userMemoryService.deleteEntry(userId, key);
      this.logger.log(`[memory] del key=${userId}:${key}`);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }

  listWorkItems(
    req: Request,
    query: { kind?: string; status?: string; search?: string },
  ) {
    return this.workItemsService.list(actingUserIdFrom(req), {
      kind: this.asKind(query.kind),
      status: this.asStatus(query.status),
      search: String(query.search ?? "").trim() || undefined,
    });
  }

  createWorkItem(
    req: Request,
    body: {
      kind?: string;
      title?: string;
      notes?: string;
      category?: string;
      status?: string;
      priority?: string;
      dueAt?: string;
      subtasks?: Array<{ id?: string; title?: string; done?: boolean }>;
      proposalStatus?: string;
      sourceSessionId?: string;
      source?: string;
    },
  ) {
    return this.workItemsService.create(actingUserIdFrom(req), {
      kind: "task",
      title: String(body.title ?? ""),
      notes: body.notes,
      category: body.category,
      status: this.asStatus(body.status),
      priority:
        body.priority === "high" || body.priority === "low" ? body.priority : "medium",
      dueAt: body.dueAt,
      subtasks: Array.isArray(body.subtasks)
        ? body.subtasks.map((item) => ({
            id: String(item.id ?? ""),
            title: String(item.title ?? ""),
            done: Boolean(item.done),
          }))
        : undefined,
      proposalStatus: body.proposalStatus === "proposed" ? "proposed" : "none",
      sourceSessionId: body.sourceSessionId,
      source: body.source === "manual" ? "manual" : "chat",
    }, {
      actor: body.source === "manual" ? "manual" : "chat",
    });
  }

  updateWorkItem(
    req: Request,
    id: string,
    body: {
      kind?: string;
      title?: string;
      notes?: string;
      category?: string;
      status?: string;
      priority?: string;
      dueAt?: string;
      subtasks?: Array<{ id?: string; title?: string; done?: boolean }>;
      proposalStatus?: string;
    },
  ) {
    return this.workItemsService.update(actingUserIdFrom(req), id, {
      kind: this.asKind(body.kind),
      title: body.title,
      notes: body.notes,
      category: body.category,
      status: this.asStatus(body.status),
      priority:
        body.priority === "high" || body.priority === "low" ? body.priority : undefined,
      dueAt: body.dueAt,
      subtasks: Array.isArray(body.subtasks)
        ? body.subtasks.map((item) => ({
            id: String(item.id ?? ""),
            title: String(item.title ?? ""),
            done: Boolean(item.done),
          }))
        : undefined,
      proposalStatus: body.proposalStatus === "proposed" ? "proposed" : body.proposalStatus === "none" ? "none" : undefined,
    });
  }

  deleteWorkItem(req: Request, id: string) {
    return this.workItemsService.delete(actingUserIdFrom(req), id);
  }

  private asKind(value?: string): WorkItemKind | undefined {
    if (value === "task") return value;
    return undefined;
  }

  private asStatus(value?: string): WorkItemStatus | undefined {
    if (value === "open" || value === "done" || value === "archived") return value;
    return undefined;
  }
}
