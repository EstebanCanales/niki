export type AccountLifecycle =
  | "pending_kyc"
  | "active"
  | "restricted"
  | "suspended"
  | "closed";

export type IntentLifecycle =
  | "draft"
  | "policy_pending"
  | "approved"
  | "executing"
  | "executed"
  | "rejected"
  | "cancelled"
  | "failed"
  | "expired";

export type ReconciliationStatus =
  | "scheduled"
  | "running"
  | "matched"
  | "discrepant"
  | "failed";

export type ApprovalStatus = "pending" | "approved" | "rejected";
export type KycStatus = "not_started" | "pending" | "approved" | "rejected";
export type MfaMethod = "totp" | "email";
export type PolicyDecision = "allow" | "review" | "deny";
export type LedgerDirection = "debit" | "credit";

export type User = {
  id: string;
  email: string;
  displayName: string;
  roles: string[];
  jurisdiction: string;
  accountStatus: AccountLifecycle;
  walletAddress: string;
  createdAt: string;
};

export type Session = {
  id: string;
  userId: string;
  issuedAt: string;
  expiresAt: string;
  mfaVerified: boolean;
  scopes: string[];
};

export type MfaChallenge = {
  id: string;
  userId: string;
  method: MfaMethod;
  code: string;
  expiresAt: string;
  status: "issued" | "verified" | "expired";
};

export type ComplianceProfile = {
  userId: string;
  kycStatus: KycStatus;
  screeningStatus: "clear" | "review" | "blocked";
  jurisdictionAllowed: boolean;
  riskTier: "low" | "medium" | "high";
  updatedAt: string;
};

export type ApprovalRequest = {
  id: string;
  kind: "intent" | "policy_override" | "workflow";
  status: ApprovalStatus;
  userId: string;
  intentId?: string;
  reason: string;
  scope: string;
  createdAt: string;
  resolvedAt?: string;
};

export type Account = {
  id: string;
  userId: string;
  type: "wallet";
  lifecycle: AccountLifecycle;
  baseCurrency: string;
  createdAt: string;
};

export type BalanceSnapshot = {
  accountId: string;
  currency: string;
  available: number;
  reserved: number;
  total: number;
  asOf: string;
};

export type JournalPosting = {
  id: string;
  accountId: string;
  currency: string;
  direction: LedgerDirection;
  amount: number;
  narrative: string;
};

export type JournalEntry = {
  id: string;
  intentId?: string;
  kind: "deposit" | "reserve" | "release" | "fill" | "adjustment";
  createdAt: string;
  postings: JournalPosting[];
};

export type Discrepancy = {
  id: string;
  accountId: string;
  reason: string;
  severity: "info" | "warning" | "critical";
  createdAt: string;
  status: "open" | "resolved";
};

export type ReconciliationRun = {
  id: string;
  startedAt: string;
  finishedAt?: string;
  status: ReconciliationStatus;
  matchedAccounts: number;
  discrepancyIds: string[];
};

export type PolicyRule = {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
};

export type ExposureLimit = {
  id: string;
  scope: "user" | "product";
  targetId: string;
  currency: string;
  maxNotional: number;
};

export type KillSwitch = {
  id: string;
  name: string;
  enabled: boolean;
  reason: string;
};

export type Intent = {
  id: string;
  userId: string;
  accountId: string;
  market: string;
  outcome: string;
  side: "buy" | "sell";
  orderType: "market" | "limit";
  quantity: number;
  limitPrice?: number;
  notional: number;
  status: IntentLifecycle;
  createdAt: string;
  updatedAt: string;
  idempotencyKey: string;
  policyDecision: PolicyDecision;
  rejectionReason?: string;
  approvalRequestId?: string;
  requestedBy: "user" | "agent";
  providerStatus: "not_sent" | "accepted" | "filled" | "rejected";
};

export type ProviderOrder = {
  id: string;
  intentId: string;
  provider: string;
  status: "accepted" | "filled" | "rejected";
  externalId: string;
  updatedAt: string;
};

export type AuditEvent = {
  id: string;
  ts: string;
  actor: string;
  action: string;
  subject: string;
  status: "success" | "warning" | "error";
  correlationId: string;
  detail: string;
};

export type OutboxEvent = {
  id: string;
  topic: string;
  status: "pending" | "processed";
  createdAt: string;
  processedAt?: string;
  correlationId: string;
  payload: Record<string, unknown>;
};

export type QueueJob = {
  id: string;
  kind: "intent.dispatch" | "audit.export" | "reconciliation.run";
  status: "queued" | "running" | "completed";
  createdAt: string;
  updatedAt: string;
  correlationId: string;
  payload: Record<string, unknown>;
 };

export type WorkItemKind = "task";
export type WorkItemStatus = "open" | "done" | "archived";
export type WorkItemSource = "chat" | "manual";

export type NikiTonePreference = "grounded" | "warm" | "direct";
export type NikiBrevityPreference = "concise" | "balanced" | "detailed";

export type NikiResponseStylePreference =
  | "operational"
  | "friendly"
  | "brief_status";

export type NikiOperatorProfile = {
  assistantName: string;
  tone: NikiTonePreference;
  brevity: NikiBrevityPreference;
  operationalRules: string;
  forbiddenBehaviors: string;
  responseStyle: NikiResponseStylePreference;
  updatedAt: string;
};

export type NikiPersonaProfile = NikiOperatorProfile;

export type WorkItemPriority = "low" | "medium" | "high";
export type WorkItemProposalStatus = "none" | "proposed";

export type WorkItemSubtask = {
  id: string;
  title: string;
  done: boolean;
};

export type WorkItem = {
  id: string;
  userId: string;
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
};

export type CreateWorkItemRequest = {
  kind: WorkItemKind;
  title: string;
  notes?: string;
  category?: string;
  status?: WorkItemStatus;
  priority?: WorkItemPriority;
  dueAt?: string;
  subtasks?: WorkItemSubtask[];
  proposalStatus?: WorkItemProposalStatus;
  sourceSessionId?: string;
  source?: WorkItemSource;
};

export type UpdateWorkItemRequest = Partial<{
  kind: WorkItemKind;
  title: string;
  notes?: string;
  category?: string;
  status: WorkItemStatus;
  priority: WorkItemPriority;
  dueAt?: string;
  subtasks: WorkItemSubtask[];
  proposalStatus: WorkItemProposalStatus;
}>;

export type ActivityItem = {
  id: string;
  ts: string;
  title: string;
  summary: string;
  type: "audit" | "intent" | "ledger" | "policy" | "reconciliation";
};

export type RuntimeState = {
  users: User[];
  sessions: Session[];
  mfaChallenges: MfaChallenge[];
  complianceProfiles: ComplianceProfile[];
  approvals: ApprovalRequest[];
  accounts: Account[];
  balances: BalanceSnapshot[];
  journal: JournalEntry[];
  reconciliations: ReconciliationRun[];
  discrepancies: Discrepancy[];
  policies: PolicyRule[];
  limits: ExposureLimit[];
  killSwitches: KillSwitch[];
  intents: Intent[];
  providerOrders: ProviderOrder[];
  auditEvents: AuditEvent[];
  outboxEvents: OutboxEvent[];
  queueJobs: QueueJob[];
};

export type LoginRequest = {
  email: string;
  password: string;
};

export type VerifyMfaRequest = {
  challengeId: string;
  code: string;
};

export type CreateIntentRequest = {
  accountId: string;
  market: string;
  outcome: string;
  side: "buy" | "sell";
  orderType: "market" | "limit";
  quantity: number;
  limitPrice?: number;
  requestedBy?: "user" | "agent";
};
