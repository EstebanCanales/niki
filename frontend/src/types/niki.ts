export type Locale = "en" | "es";

export type InteractionMode = "chat" | "command" | "autopilot" | "automoto";

export type AgentVisualState =
  | "idle"
  | "listening"
  | "thinking"
  | "acting"
  | "speaking"
  | "success"
  | "warning"
  | "error";

export type RuntimeTransportMode = "mock" | "backend";

export type ToolOrigin = "core" | "plugin" | "skill";
export type ToolHealth = "healthy" | "degraded" | "offline";
export type EventLevel = "info" | "success" | "warning" | "error";
export type IntegrationAuthState = "connected" | "attention" | "disconnected";
export type MessageRole = "user" | "assistant" | "system";

export interface ToolQuickAction {
  id: string;
  label: string;
  prompt: string;
}

export interface ToolEvent {
  id: string;
  title: string;
  status: EventLevel;
  at: string;
}

export interface ToolDescriptor {
  id: string;
  name: string;
  description: string;
  origin: ToolOrigin;
  icon: string;
  category: string;
  status: "ready" | "busy" | "warning" | "error" | "disabled";
  health: ToolHealth;
  permissions: string[];
  capabilities: string[];
  inputSchema: string[];
  outputSchema: string[];
  lastActivity: string;
  configSummary: string;
  recentEvents: ToolEvent[];
  recentResult: string;
  quickActions: ToolQuickAction[];
  enabled: boolean;
}

export interface RuntimeEvent {
  id: string;
  ts: string;
  level: EventLevel;
  source: string;
  type: string;
  title: string;
  summary: string;
  detail?: string;
}

export interface SessionTraceStep {
  id: string;
  toolId: string;
  label: string;
  status: "running" | "completed" | "warning" | "error";
  startedAt: string;
  endedAt?: string;
  detail: string;
}

export interface SessionMessage {
  id: string;
  role: MessageRole;
  content: string;
  createdAt: string;
  attachments?: string[];
  trace?: SessionTraceStep[];
}

export interface NotchFileContext {
  name: string;
  path: string;
  kind: string;
}

export interface NotchChatRequest {
  text: string;
  files: NotchFileContext[];
  createdAt: string;
}

export interface SessionSummary {
  id: string;
  title: string;
  summary: string;
  status: "live" | "paused" | "complete";
  mode: InteractionMode;
  updatedAt: string;
  toolsUsed: string[];
  titleCustomized?: boolean;
}

export type WorkItemKind = "task";
export type WorkItemStatus = "open" | "done" | "archived";
export type WorkItemSource = "chat" | "manual";
export type NikiTonePreference = "grounded" | "warm" | "direct";
export type NikiBrevityPreference = "concise" | "balanced" | "detailed";
export type NikiResponseStylePreference =
  | "operational"
  | "friendly"
  | "brief_status";

export interface NikiPersonaProfile {
  assistantName: string;
  tone: NikiTonePreference;
  brevity: NikiBrevityPreference;
  operationalRules: string;
  forbiddenBehaviors: string;
  responseStyle: NikiResponseStylePreference;
  updatedAt: string;
}

export type WorkItemPriority = "low" | "medium" | "high";
export type WorkItemProposalStatus = "none" | "proposed";

export interface WorkItemSubtask {
  id: string;
  title: string;
  done: boolean;
}

export interface WorkItem {
  id: string;
  kind: WorkItemKind;
  title: string;
  notes?: string;
  category: string;
  status: WorkItemStatus;
  priority: WorkItemPriority;
  dueAt?: string;
  subtasks: WorkItemSubtask[];
  proposalStatus: WorkItemProposalStatus;
  createdAt: string;
  updatedAt: string;
  sourceSessionId?: string;
  source: WorkItemSource;
}

export interface MemoryEntry {
  id: string;
  title: string;
  content: string;
  kind: "preference" | "entity" | "workflow" | "context" | "note";
  pinned?: boolean;
  score: number;
  updatedAt: string;
}

export interface MemoryCollection {
  recent: MemoryEntry[];
  persistent: MemoryEntry[];
  pinned: MemoryEntry[];
  entities: MemoryEntry[];
  status: {
    indexed: number;
    dirty: number;
    lastSync: string;
  };
}

export interface IntegrationStatus {
  id: string;
  name: string;
  icon: string;
  description: string;
  state: IntegrationAuthState;
  dependsOn: string[];
  health: ToolHealth;
  updatedAt: string;
}

export interface PluginSummary {
  id: string;
  name: string;
  type: "plugin" | "skill";
  version: string;
  status: "ready" | "busy" | "warning" | "error" | "disabled";
  origin: string;
  description: string;
}

export interface FileRecord {
  id: string;
  name: string;
  kind: "transcript" | "clip" | "config" | "asset";
  summary: string;
  updatedAt: string;
}

export interface ApprovalRequest {
  id: string;
  title: string;
  reason: string;
  scope: string;
  createdAt: string;
  source: string;
}

export interface AgentStatus {
  name: string;
  state: AgentVisualState;
  model: string;
  voice: string;
  channel: string;
  uptime: string;
  currentTask: string;
  summary: string;
}

export interface ConnectionSnapshot {
  state:
    | "disconnected"
    | "connecting"
    | "pairing"
    | "syncing"
    | "ready"
    | "degraded";
  endpoint: string;
  latencyMs: number;
  operatorMode: string;
  runtimeVersion: string;
}

export interface StreamerPreset {
  title: string;
  description: string;
  tools: string[];
  scenes: string[];
  streamHealth: string;
  liveRecommendations: string[];
}

export interface RuntimeSnapshot {
  connection: ConnectionSnapshot;
  agent: AgentStatus;
  tools: ToolDescriptor[];
  sessions: SessionSummary[];
  sessionMessages: Record<string, SessionMessage[]>;
  activeSessionId: string;
  memory: MemoryCollection;
  integrations: IntegrationStatus[];
  plugins: PluginSummary[];
  logs: RuntimeEvent[];
  files: FileRecord[];
  approvals: ApprovalRequest[];
  streamerPreset: StreamerPreset;
}

export type RuntimePatch = Partial<RuntimeSnapshot>;

export type RuntimeUpdate =
  | { kind: "snapshot"; snapshot: RuntimeSnapshot }
  | { kind: "partial"; patch: RuntimePatch }
  | { kind: "event"; event: RuntimeEvent };

export interface PromptRequest {
  mode: InteractionMode;
  content: string;
}

export interface ToolActionRequest {
  toolId: string;
  actionId: string;
}

export interface RuntimeActions {
  sendPrompt(request: PromptRequest): Promise<void>;
  runToolAction(request: ToolActionRequest): Promise<void>;
  approveExec(id: string, approved: boolean): Promise<void>;
}
