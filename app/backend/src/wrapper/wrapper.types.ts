export type AgentPreferencesDto = {
  notificationsEnabled?: boolean;
  disabledTools?: string[];
};

export type ChatRequestDto = {
  input?: string;
  sessionId?: string;
  channel?: string;
  messages?: Array<{ role?: string; content?: string }>;
  agentPreferences?: AgentPreferencesDto;
  /**
   * Un cuadro de la cámara, como data URL, para que el modelo vea lo que ve la cámara.
   *
   * Va en un campo aparte y no dentro de `content` a propósito. El resto del backend
   * —memoria, dataset, contexto, auditoría— da por hecho que `content` es un string, y
   * hay `typeof m.content === "string"` desperdigados que descartarían el mensaje entero
   * en silencio si le llegara un array. Acá la imagen solo se adjunta en el viaje al
   * modelo; todo lo que se guarda sigue siendo el texto.
   */
  imagen?: string;
};

export type RuntimeCapabilityStateDto = "hidden" | "disabled" | "flagged" | "beta" | "ready";

export type RuntimeCapabilitiesResponseDto = {
  ok: true;
  capabilities: {
    modules: Record<string, { state: RuntimeCapabilityStateDto; reason?: string }>;
    capabilities: Record<string, { available: boolean; enabled: boolean; requiresSetup: boolean }>;
  };
};

export type RuntimeSessionSummaryDto = {
  id: string;
  title: string;
  profileId: string;
  model?: string;
  provider?: string;
  resumable: boolean;
  canUndo: boolean;
  canUndoReason?: string;
  canHandoff: boolean;
  canHandoffReason?: string;
  handoffTargets?: string[];
  updatedAt?: string;
  platform?: string;
  source?: string;
  messageCount?: number;
  apiCallCount?: number;
  suspended?: boolean;
  resumePending?: boolean;
  resumeReason?: string;
  handoffState?: string;
  handoffPlatform?: string;
  handoffError?: string;
  endedAt?: string;
};

export type RuntimeSessionsResponseDto = {
  ok: true;
  sessions: RuntimeSessionSummaryDto[];
};

export type RuntimeSessionHandoffResponseDto = {
  ok: boolean;
  sessionId: string;
  state?: string;
  platform?: string;
  error?: string;
};

export type RuntimeSessionUndoResponseDto = {
  ok: boolean;
  sessionId: string;
  removed: number;
  preview?: string;
  error?: string;
};

export type RuntimeProfileSummaryDto = {
  id: string;
  label: string;
  sessionCount: number;
  lastSeenAt?: string;
  providers: string[];
  models: string[];
};

export type RuntimeProfilesResponseDto = {
  ok: true;
  profiles: RuntimeProfileSummaryDto[];
};

export type RuntimeMcpServerDto = {
  id: string;
  name: string;
  status: "ready" | "disabled" | "degraded";
  enabled: boolean;
  transport?: string;
  authType?: string;
  supportsParallelToolCalls: boolean;
  resourcesEnabled: boolean;
  promptsEnabled: boolean;
  includeCount: number;
  excludeCount: number;
  reason?: string;
};

export type RuntimeMcpServersResponseDto = {
  ok: true;
  servers: RuntimeMcpServerDto[];
};

export type RuntimeDiscoverCapabilityDto = {
  id: "x_search" | "video_generate";
  title: string;
  available: boolean;
  reason?: string;
};

export type RuntimeDiscoverCapabilitiesResponseDto = {
  ok: true;
  profileId: string;
  capabilities: RuntimeDiscoverCapabilityDto[];
};
