import { ForbiddenException, Inject, Injectable, Logger } from "@nestjs/common";
import type { Request, Response } from "express";

import { AuditService } from "../modules/audit/audit.service";
import { ComputerControlService } from "../modules/computer/computer-control.service";
import { projectComputerOperatorSurface } from "../modules/computer/computer-operator-surface";
import {
  actingUserIdFrom,
  correlationIdFrom,
  isTrustedOrigin,
} from "../modules/common/request-context";
import { IdentityService } from "../modules/identity/identity.service";
import { RuntimeService } from "../modules/runtime/runtime.service";
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
    @Inject(ComputerControlService)
    private readonly computerControl: ComputerControlService,
  ) {}

  computerCapabilities() {
    const permissions = this.computerControl.permissions();
    const capabilities = this.computerControl.capabilitiesList();
    return {
      ok: true,
      config: this.computerControl.getConfig(),
      permissions,
      capabilities,
      surface: projectComputerOperatorSurface({
        capabilities,
        permissions,
      }),
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

  runtimeCapabilities() {
    return {
      ok: true,
      capabilities: this.runtimeService.getRuntimeCapabilities(),
    };
  }

  runtimeSessions() {
    return {
      ok: true,
      sessions: this.runtimeService.getRuntimeSessions(),
    };
  }

  runtimeProfiles() {
    return {
      ok: true,
      profiles: this.runtimeService.getRuntimeProfiles(),
    };
  }

  requestSessionHandoff(input: { sessionId?: string; platform?: string }) {
    return this.runtimeService.requestSessionHandoff(input);
  }

  requestSessionUndo(input: { sessionId?: string }) {
    return this.runtimeService.requestSessionUndo(input);
  }

  runtimeMcpServers() {
    return {
      ok: true,
      servers: this.runtimeService.getRuntimeMcpServers(),
    };
  }

  updateRuntimeMcpServer(input: { id?: string; enabled?: boolean }) {
    return this.runtimeService.updateRuntimeMcpServer(input);
  }

  runtimeDiscoverCapabilities(profileId?: string) {
    const projected = this.runtimeService.getRuntimeDiscoverCapabilities(profileId);
    return {
      ok: true,
      profileId: projected.profileId,
      capabilities: projected.capabilities,
    };
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

  respondToApproval(input: { runId?: string; choice?: string; all?: boolean }) {
    return this.runtimeService.respondToApproval(input);
  }

  showSurface(input: {
    kind?: string;
    title?: string;
    subtitle?: string;
    query?: string;
    url?: string;
    location?: { label: string; lat?: number; lng?: number; address?: string };
    modelUrl?: string;
  }) {
    return this.runtimeService.showSurface(input as Parameters<RuntimeService["showSurface"]>[0]);
  }

  clearSurface() {
    return this.runtimeService.clearSurface();
  }

  proxyChatStream(req: Request, res: Response, body: ChatRequestDto) {
    return this.runtimeService.proxyChatStream(req, res, body);
  }

  marcarInterrupcion(body: { sessionId?: string; spoken?: string }) {
    return this.runtimeService.marcarInterrupcion(body);
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
}
