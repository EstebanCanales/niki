import type { RuntimeCapabilities } from "./runtime-capabilities";
import type { RuntimeMcpServer } from "./runtime-mcp";
import type { RuntimeProfileSummary } from "./runtime-profiles";
import type { RuntimeSessionSummary } from "./runtime-sessions";

export type RuntimeConnectionState =
  | "disconnected"
  | "connecting"
  | "pairing"
  | "syncing"
  | "ready"
  | "degraded";

export type RuntimePatch = {
  connection?: {
    state: RuntimeConnectionState;
    endpoint: string;
    latencyMs: number;
    operatorMode: string;
    runtimeVersion: string;
  };
  agent?: {
    state: "idle" | "listening" | "thinking" | "acting" | "speaking" | "success" | "warning" | "error";
    model: string;
    channel: string;
    currentTask: string;
    summary: string;
  };
};

export type RuntimeUpdate =
  | {
      kind: "partial";
      patch: RuntimePatch;
    }
  | {
      kind: "diagnostics";
      payload: RuntimeDiagnosticsPayload;
    }
  | {
      kind: "approval_request";
      payload: RuntimeApprovalRequest;
    }
  | {
      kind: "approval_resolved";
      payload: RuntimeApprovalResolution;
    }
  | {
      kind: "capabilities";
      payload: RuntimeCapabilities;
    }
  | {
      kind: "sessions_snapshot";
      payload: {
        sessions: RuntimeSessionSummary[];
      };
    }
  | {
      kind: "mcp_snapshot";
      payload: {
        servers: RuntimeMcpServer[];
      };
    }
  | {
      kind: "profiles_snapshot";
      payload: {
        profiles: RuntimeProfileSummary[];
      };
    }
  | {
      kind: "session_action";
      payload: RuntimeSessionActionPayload;
    }
  | {
      kind: "surface";
      payload: RuntimeSurfacePayload;
    }
  | {
      kind: "surface_clear";
    }
  | {
      kind: "event";
      event: {
        id: string;
        ts: string;
        level: "info" | "success" | "warning" | "error";
        source: string;
        type: string;
        title: string;
        summary: string;
        detail?: string;
      };
    };

export function buildCapabilitiesEvent(capabilities: RuntimeCapabilities): RuntimeUpdate {
  return {
    kind: "capabilities",
    payload: capabilities,
  };
}

export function buildSessionsSnapshotEvent(sessions: RuntimeSessionSummary[]): RuntimeUpdate {
  return {
    kind: "sessions_snapshot",
    payload: {
      sessions,
    },
  };
}

export function buildMcpSnapshotEvent(servers: RuntimeMcpServer[]): RuntimeUpdate {
  return {
    kind: "mcp_snapshot",
    payload: {
      servers,
    },
  };
}

export function buildProfilesSnapshotEvent(profiles: RuntimeProfileSummary[]): RuntimeUpdate {
  return {
    kind: "profiles_snapshot",
    payload: {
      profiles,
    },
  };
}

export type RuntimeSessionActionPayload = {
  sessionId: string;
  action: "handoff" | "undo";
  status: "success" | "warning" | "error";
  summary: string;
  detail?: string;
  platform?: string;
  removed?: number;
};

export function buildSessionActionEvent(payload: RuntimeSessionActionPayload): RuntimeUpdate {
  return {
    kind: "session_action",
    payload,
  };
}

export type RuntimeSurfaceKind = "search" | "map" | "model3d";

export type RuntimeSurfacePayload = {
  id: string;
  kind: RuntimeSurfaceKind;
  title: string;
  subtitle?: string;
  query?: string;
  url?: string;
  location?: {
    label: string;
    lat?: number;
    lng?: number;
    address?: string;
  };
  modelUrl?: string;
  createdAt: string;
};

export function buildSurfaceEvent(payload: RuntimeSurfacePayload): RuntimeUpdate {
  return {
    kind: "surface",
    payload,
  };
}

export function buildSurfaceClearEvent(): RuntimeUpdate {
  return { kind: "surface_clear" };
}

export function buildInitialRuntimeEvents(input: {
  status: {
    state: RuntimeConnectionState;
    apiServerUrl: string;
    resolvedModel: string;
    detail?: string | null;
  };
  capabilities: RuntimeCapabilities;
  sessions: RuntimeSessionSummary[];
  mcpServers: RuntimeMcpServer[];
  profiles: RuntimeProfileSummary[];
}): RuntimeUpdate[] {
  return [
    {
      kind: "partial",
      patch: {
        connection: {
          state: input.status.state,
          endpoint: input.status.apiServerUrl,
          latencyMs: 0,
          operatorMode: "wrapper",
          runtimeVersion: input.status.resolvedModel,
        },
        agent: {
          state: input.status.state === "ready" ? "idle" : input.status.state === "degraded" ? "warning" : "error",
          model: input.status.resolvedModel,
          channel: "Niki app -> Hermes",
          currentTask: input.status.state === "ready" ? "Ready for realtime requests" : "Runtime unavailable",
          summary: String(input.status.detail ?? ""),
        },
      },
    },
    buildCapabilitiesEvent(input.capabilities),
    buildSessionsSnapshotEvent(input.sessions),
    buildMcpSnapshotEvent(input.mcpServers),
    buildProfilesSnapshotEvent(input.profiles),
  ];
}

export function buildRuntimeBroadcastSignature(input: {
  status: {
    state: RuntimeConnectionState;
    apiServerUrl: string;
    resolvedModel: string;
    detail?: string | null;
  };
  capabilities: RuntimeCapabilities;
  sessions: RuntimeSessionSummary[];
  mcpServers: RuntimeMcpServer[];
  profiles: RuntimeProfileSummary[];
}) {
  return JSON.stringify({
    status: input.status,
    capabilities: input.capabilities,
    sessions: input.sessions,
    mcpServers: input.mcpServers,
    profiles: input.profiles,
  });
}

export type RuntimeApprovalRequest = {
  id: string;
  runId: string;
  title: string;
  toolName: string;
  detail: string;
  choices: string[];
};

export type RuntimeApprovalResolution = {
  id: string;
  runId: string;
  decision: string;
  resolved: number;
};

export type RuntimeDiagnosticsPayload = {
  id: string;
  runId: string;
  sessionId?: string;
  filePath: string;
  severity: "error" | "warning" | "info";
  message: string;
};

function approvalIdFrom(data: Record<string, unknown>) {
  const explicit = typeof data.approval_id === "string" ? data.approval_id.trim() : "";
  if (explicit) return explicit;
  const runId = typeof data.run_id === "string" ? data.run_id.trim() : "";
  const timestamp = typeof data.timestamp === "number" ? String(data.timestamp) : "pending";
  return runId ? `${runId}:${timestamp}` : `approval:${timestamp}`;
}

export function normalizeHermesApprovalEvent(
  eventType: string,
  payload: unknown,
): RuntimeUpdate | null {
  if (!payload || typeof payload !== "object") return null;
  const data = payload as Record<string, unknown>;
  const runId = typeof data.run_id === "string" ? data.run_id : "";
  const approvalId = approvalIdFrom(data);

  if (eventType === "approval.request" || eventType === "approval_requested") {
    const command = typeof data.command === "string" ? data.command : "";
    const description = typeof data.description === "string" ? data.description : "";
    const detail = command || description || "Approval required.";
    const choices = Array.isArray(data.choices)
      ? data.choices.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      : ["once", "session", "always", "deny"];

    return {
      kind: "approval_request",
      payload: {
        id: approvalId,
        runId,
        title: description || "Approval required",
        toolName: command ? "command" : "approval",
        detail,
        choices,
      },
    };
  }

  if (eventType === "approval.responded" || eventType === "approval_resolved") {
    return {
      kind: "approval_resolved",
      payload: {
        id: approvalId,
        runId,
        decision: typeof data.choice === "string" ? data.choice : typeof data.decision === "string" ? data.decision : "",
        resolved: typeof data.resolved === "number" ? data.resolved : 0,
      },
    };
  }

  return null;
}

export function normalizeHermesDiagnosticsEvent(
  eventType: string,
  payload: unknown,
): RuntimeUpdate | null {
  if (eventType !== "lsp_diagnostics" && eventType !== "diagnostics.lsp") {
    return null;
  }
  if (!payload || typeof payload !== "object") return null;

  const data = payload as Record<string, unknown>;
  const filePath =
    typeof data.file === "string"
      ? data.file
      : typeof data.path === "string"
        ? data.path
        : "";
  const message = typeof data.message === "string" ? data.message : "";
  if (!filePath || !message) return null;

  const runId = typeof data.run_id === "string" ? data.run_id : "";
  const sessionId = typeof data.session_id === "string" ? data.session_id : undefined;
  const rawSeverity = typeof data.severity === "string" ? data.severity.toLowerCase() : "info";
  const severity: RuntimeDiagnosticsPayload["severity"] =
    rawSeverity === "error" || rawSeverity === "warning" ? rawSeverity : "info";

  return {
    kind: "diagnostics",
    payload: {
      id: `${runId || "run"}:${filePath}:${message}`,
      runId,
      sessionId,
      filePath,
      severity,
      message,
    },
  };
}
