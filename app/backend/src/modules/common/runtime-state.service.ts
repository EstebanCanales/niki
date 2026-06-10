import { Injectable } from "@nestjs/common";

import type {
  ActivityItem,
  ApprovalRequest,
  AuditEvent,
  ComplianceProfile,
  CreateIntentRequest,
  Discrepancy,
  ExposureLimit,
  Intent,
  JournalEntry,
  KillSwitch,
  MfaChallenge,
  OutboxEvent,
  PolicyDecision,
  PolicyRule,
  ProviderOrder,
  QueueJob,
  ReconciliationRun,
  RuntimeState,
  Session,
  User,
} from "../../domain/contracts";

function nowIso() {
  return new Date().toISOString();
}

function addMinutes(base: Date, minutes: number) {
  return new Date(base.getTime() + minutes * 60_000).toISOString();
}

@Injectable()
export class RuntimeStateService {
  private readonly state: RuntimeState = this.buildSeedState();

  private buildSeedState(): RuntimeState {
    const now = new Date();
    const users: User[] = [
      {
        id: "user-demo",
        email: "operator@niki.com",
        displayName: "Niki Operator",
        roles: ["customer", "operator"],
        jurisdiction: "CR",
        accountStatus: "active",
        walletAddress: "0xD3m0User000000000000000000000000000001",
        createdAt: nowIso(),
      },
    ];

    const complianceProfiles: ComplianceProfile[] = [
      {
        userId: "user-demo",
        kycStatus: "approved",
        screeningStatus: "clear",
        jurisdictionAllowed: true,
        riskTier: "low",
        updatedAt: nowIso(),
      },
    ];

    const policies: PolicyRule[] = [
      {
        id: "policy-kyc",
        name: "approved-kyc-required",
        description: "Only KYC-approved users can create executable intents.",
        enabled: true,
      },
      {
        id: "policy-jurisdiction",
        name: "jurisdiction-gating",
        description: "Reject intents from blocked jurisdictions.",
        enabled: true,
      },
      {
        id: "policy-exposure",
        name: "user-exposure-cap",
        description: "Send oversized intents to manual review.",
        enabled: true,
      },
    ];

    const limits: ExposureLimit[] = [
      {
        id: "limit-user-demo",
        scope: "user",
        targetId: "user-demo",
        currency: "pUSD",
        maxNotional: 500,
      },
    ];

    const killSwitches: KillSwitch[] = [
      {
        id: "kill-execution",
        name: "execution-global",
        enabled: false,
        reason: "",
      },
    ];

    const auditEvents: AuditEvent[] = [
      {
        id: "audit-bootstrap",
        ts: nowIso(),
        actor: "system",
        action: "bootstrap.seed",
        subject: "runtime",
        status: "success",
        correlationId: "bootstrap",
        detail: "Seeded in-memory regulated backend state.",
      },
    ];

    return {
      users,
      sessions: [],
      mfaChallenges: [],
      complianceProfiles,
      approvals: [],
      accounts: [],
      balances: [],
      journal: [],
      reconciliations: [],
      discrepancies: [],
      policies,
      limits,
      killSwitches,
      intents: [],
      providerOrders: [],
      auditEvents,
      outboxEvents: [],
      queueJobs: [],
    };
  }

  snapshot() {
    return structuredClone(this.state);
  }

  findUser(userId: string) {
    return this.state.users.find((user) => user.id === userId) ?? null;
  }

  findUserByEmail(email: string) {
    return (
      this.state.users.find(
        (user) => user.email.toLowerCase() === email.trim().toLowerCase(),
      ) ?? null
    );
  }

  createSession(userId: string) {
    const issuedAt = nowIso();
    const session: Session = {
      id: `sess-${crypto.randomUUID()}`,
      userId,
      issuedAt,
      expiresAt: addMinutes(new Date(issuedAt), 60),
      mfaVerified: false,
      scopes: ["profile:read", "chat:write"],
    };
    this.state.sessions.unshift(session);
    return session;
  }

  createMfaChallenge(userId: string, method: "totp" | "email" = "email") {
    const challenge: MfaChallenge = {
      id: `mfa-${crypto.randomUUID()}`,
      userId,
      method,
      code: "123456",
      expiresAt: addMinutes(new Date(), 10),
      status: "issued",
    };
    this.state.mfaChallenges.unshift(challenge);
    return challenge;
  }

  verifyMfaChallenge(challengeId: string, code: string) {
    const challenge = this.state.mfaChallenges.find((item) => item.id === challengeId);
    if (!challenge || challenge.code !== code || challenge.status !== "issued") {
      return null;
    }

    challenge.status = "verified";
    const session = this.state.sessions.find((item) => item.userId === challenge.userId);
    if (session) {
      session.mfaVerified = true;
    }
    return challenge;
  }

  complianceFor(userId: string) {
    return this.state.complianceProfiles.find((item) => item.userId === userId) ?? null;
  }

  accountsFor(userId: string) {
    return this.state.accounts.filter((item) => item.userId === userId);
  }

  balancesForAccountIds(accountIds: string[]) {
    const ids = new Set(accountIds);
    return this.state.balances.filter((item) => ids.has(item.accountId));
  }

  audit(actor: string, action: string, subject: string, correlationId: string, detail: string, status: "success" | "warning" | "error" = "success") {
    const event: AuditEvent = {
      id: `audit-${crypto.randomUUID()}`,
      ts: nowIso(),
      actor,
      action,
      subject,
      status,
      correlationId,
      detail,
    };
    this.state.auditEvents.unshift(event);
    this.state.auditEvents.splice(100);
    return event;
  }

  enqueueJob(
    kind: QueueJob["kind"],
    correlationId: string,
    payload: Record<string, unknown>,
  ) {
    const job: QueueJob = {
      id: `job-${crypto.randomUUID()}`,
      kind,
      status: "queued",
      createdAt: nowIso(),
      updatedAt: nowIso(),
      correlationId,
      payload,
    };
    this.state.queueJobs.unshift(job);
    return job;
  }

  completeJob(jobId: string) {
    const job = this.state.queueJobs.find((item) => item.id === jobId);
    if (!job) return null;
    job.status = "completed";
    job.updatedAt = nowIso();
    return job;
  }

  queueSnapshot() {
    return [...this.state.queueJobs];
  }

  appendOutbox(
    topic: string,
    correlationId: string,
    payload: Record<string, unknown>,
  ) {
    const event: OutboxEvent = {
      id: `outbox-${crypto.randomUUID()}`,
      topic,
      status: "pending",
      createdAt: nowIso(),
      correlationId,
      payload,
    };
    this.state.outboxEvents.unshift(event);
    return event;
  }

  markOutboxProcessed(outboxId: string) {
    const event = this.state.outboxEvents.find((item) => item.id === outboxId);
    if (!event) return null;
    event.status = "processed";
    event.processedAt = nowIso();
    return event;
  }

  outboxSnapshot() {
    return [...this.state.outboxEvents];
  }

  activitiesFor(userId: string): ActivityItem[] {
    const userIntents = this.state.intents.filter((intent) => intent.userId === userId);
    const intentActivities: ActivityItem[] = userIntents.map((intent) => ({
      id: `activity-intent-${intent.id}`,
      ts: intent.updatedAt,
      title: `Intent ${intent.status}`,
      summary: `${intent.side.toUpperCase()} ${intent.quantity} ${intent.outcome} on ${intent.market}`,
      type: "intent",
    }));

    const auditActivities: ActivityItem[] = this.state.auditEvents.slice(0, 20).map((event) => ({
      id: `activity-audit-${event.id}`,
      ts: event.ts,
      title: event.action,
      summary: event.detail,
      type: "audit",
    }));

    return [...intentActivities, ...auditActivities]
      .sort((a, b) => b.ts.localeCompare(a.ts))
      .slice(0, 30);
  }

  evaluateIntentPolicy(userId: string, request: CreateIntentRequest): {
    decision: PolicyDecision;
    reason: string;
    approvalRequest?: ApprovalRequest;
  } {
    const compliance = this.complianceFor(userId);
    const killSwitch = this.state.killSwitches.find((item) => item.name === "execution-global");
    if (killSwitch?.enabled) {
      return {
        decision: "deny",
        reason: `Execution blocked by kill switch: ${killSwitch.reason || "manual stop"}`,
      };
    }

    if (!compliance || compliance.kycStatus !== "approved") {
      return {
        decision: "deny",
        reason: "KYC approval is required before creating executable intents.",
      };
    }

    if (!compliance.jurisdictionAllowed || compliance.screeningStatus === "blocked") {
      return {
        decision: "deny",
        reason: "Jurisdiction or screening policy blocks this user.",
      };
    }

    const notional = request.quantity * (request.limitPrice ?? 0.5);
    const limit = this.state.limits.find(
      (item) => item.scope === "user" && item.targetId === userId,
    );
    if (limit && notional > limit.maxNotional) {
      const approval: ApprovalRequest = {
        id: `approval-${crypto.randomUUID()}`,
        kind: "intent",
        status: "pending",
        userId,
        reason: `Intent notional ${notional.toFixed(2)} exceeds limit ${limit.maxNotional}.`,
        scope: "manual-review",
        createdAt: nowIso(),
      };
      this.state.approvals.unshift(approval);
      return {
        decision: "review",
        reason: approval.reason,
        approvalRequest: approval,
      };
    }

    return {
      decision: "allow",
      reason: "Policy checks passed.",
    };
  }

  policyPreview(userId: string, request: CreateIntentRequest) {
    const decision = this.evaluateIntentPolicy(userId, request);
    const limit = this.state.limits.find(
      (item) => item.scope === "user" && item.targetId === userId,
    );
    return {
      ok: true,
      decision: decision.decision,
      reason: decision.reason,
      appliedRules: this.state.policies
        .filter((item) => item.enabled)
        .map((item) => item.name),
      exposureLimit: limit ?? null,
    };
  }

  createIntent(
    userId: string,
    request: CreateIntentRequest,
    idempotencyKey: string,
    requestedBy: "user" | "agent",
  ) {
    const existing = this.state.intents.find(
      (intent) => intent.userId === userId && intent.idempotencyKey === idempotencyKey,
    );
    if (existing) {
      return existing;
    }

    const decision = this.evaluateIntentPolicy(userId, request);
    const createdAt = nowIso();
    const notional = request.quantity * (request.limitPrice ?? 0.5);
    const intent: Intent = {
      id: `intent-${crypto.randomUUID()}`,
      userId,
      accountId: request.accountId,
      market: request.market,
      outcome: request.outcome,
      side: request.side,
      orderType: request.orderType,
      quantity: request.quantity,
      limitPrice: request.limitPrice,
      notional,
      status:
        decision.decision === "allow"
          ? "approved"
          : decision.decision === "review"
            ? "policy_pending"
            : "rejected",
      createdAt,
      updatedAt: createdAt,
      idempotencyKey,
      policyDecision: decision.decision,
      rejectionReason: decision.decision === "deny" ? decision.reason : undefined,
      approvalRequestId: decision.approvalRequest?.id,
      requestedBy,
      providerStatus: "not_sent",
    };
    this.state.intents.unshift(intent);
    this.appendOutbox("intent.created", idempotencyKey, {
      intentId: intent.id,
      userId,
      requestedBy,
      status: intent.status,
    });
    const dispatchJob = this.enqueueJob("intent.dispatch", idempotencyKey, {
      intentId: intent.id,
      provider: "sandbox-clob",
    });

    if (decision.approvalRequest) {
      decision.approvalRequest.intentId = intent.id;
    }

    if (decision.decision === "allow") {
      this.reserveFunds(intent);
      this.simulateProviderExecution(intent);
      this.completeJob(dispatchJob.id);
    }

    return intent;
  }

  private reserveFunds(intent: Intent) {
    const balance = this.state.balances.find(
      (item) => item.accountId === intent.accountId && item.currency === "pUSD",
    );
    if (!balance) return;

    balance.available = Number((balance.available - intent.notional).toFixed(2));
    balance.reserved = Number((balance.reserved + intent.notional).toFixed(2));
    balance.total = Number((balance.available + balance.reserved).toFixed(2));
    balance.asOf = nowIso();

    const entry: JournalEntry = {
      id: `journal-${crypto.randomUUID()}`,
      intentId: intent.id,
      kind: "reserve",
      createdAt: nowIso(),
      postings: [
        {
          id: `posting-${crypto.randomUUID()}`,
          accountId: intent.accountId,
          currency: "pUSD",
          direction: "debit",
          amount: intent.notional,
          narrative: "Reserve available balance for approved intent",
        },
        {
          id: `posting-${crypto.randomUUID()}`,
          accountId: intent.accountId,
          currency: "pUSD",
          direction: "credit",
          amount: intent.notional,
          narrative: "Move to reserved balance bucket",
        },
      ],
    };
    this.state.journal.unshift(entry);
  }

  private simulateProviderExecution(intent: Intent) {
    intent.status = "executing";
    intent.providerStatus = "accepted";
    intent.updatedAt = nowIso();

    const providerOrder: ProviderOrder = {
      id: `provider-${crypto.randomUUID()}`,
      intentId: intent.id,
      provider: "sandbox-clob",
      status: "accepted",
      externalId: `sandbox-${Math.random().toString(36).slice(2, 10)}`,
      updatedAt: nowIso(),
    };
    this.state.providerOrders.unshift(providerOrder);

    const balance = this.state.balances.find(
      (item) => item.accountId === intent.accountId && item.currency === "pUSD",
    );
    if (!balance) return;

    balance.reserved = Number((balance.reserved - intent.notional).toFixed(2));
    balance.total = Number((balance.available + balance.reserved).toFixed(2));
    balance.asOf = nowIso();

    const fillEntry: JournalEntry = {
      id: `journal-${crypto.randomUUID()}`,
      intentId: intent.id,
      kind: "fill",
      createdAt: nowIso(),
      postings: [
        {
          id: `posting-${crypto.randomUUID()}`,
          accountId: intent.accountId,
          currency: "pUSD",
          direction: "debit",
          amount: intent.notional,
          narrative: "Settle reserved balance on sandbox fill",
        },
        {
          id: `posting-${crypto.randomUUID()}`,
          accountId: "external-sandbox-venue",
          currency: "pUSD",
          direction: "credit",
          amount: intent.notional,
          narrative: "Transfer notional to sandbox venue",
        },
      ],
    };
    this.state.journal.unshift(fillEntry);

    providerOrder.status = "filled";
    providerOrder.updatedAt = nowIso();
    intent.status = "executed";
    intent.providerStatus = "filled";
    intent.updatedAt = nowIso();
  }

  getIntent(intentId: string, userId?: string) {
    return (
      this.state.intents.find(
        (intent) => intent.id === intentId && (!userId || intent.userId === userId),
      ) ?? null
    );
  }

  listOpenApprovals() {
    return this.state.approvals.filter((item) => item.status === "pending");
  }

  resolveApproval(approvalId: string, approved: boolean) {
    const approval = this.state.approvals.find((item) => item.id === approvalId);
    if (!approval || approval.status !== "pending") {
      return null;
    }

    approval.status = approved ? "approved" : "rejected";
    approval.resolvedAt = nowIso();

    if (approval.intentId) {
      const intent = this.state.intents.find((item) => item.id === approval.intentId);
      if (intent) {
        intent.status = approved ? "approved" : "rejected";
        intent.updatedAt = nowIso();
        intent.rejectionReason = approved ? undefined : "Rejected during manual review.";
    if (approved) {
          this.reserveFunds(intent);
          this.simulateProviderExecution(intent);
        }
      }
    }

    this.appendOutbox("approval.resolved", approval.id, {
      approvalId: approval.id,
      approved,
      intentId: approval.intentId ?? null,
    });

    return approval;
  }

  runReconciliation() {
    const job = this.enqueueJob("reconciliation.run", `recon-${crypto.randomUUID()}`, {
      mode: "manual",
    });
    const run: ReconciliationRun = {
      id: `recon-${crypto.randomUUID()}`,
      startedAt: nowIso(),
      status: "running",
      matchedAccounts: 0,
      discrepancyIds: [],
    };
    this.state.reconciliations.unshift(run);

    const openDiscrepancies: Discrepancy[] = [];
    for (const balance of this.state.balances) {
      if (balance.available < 0 || balance.reserved < 0) {
        const discrepancy: Discrepancy = {
          id: `disc-${crypto.randomUUID()}`,
          accountId: balance.accountId,
          reason: "Negative balance detected during reconciliation.",
          severity: "critical",
          createdAt: nowIso(),
          status: "open",
        };
        this.state.discrepancies.unshift(discrepancy);
        openDiscrepancies.push(discrepancy);
      }
    }

    run.finishedAt = nowIso();
    run.matchedAccounts = this.state.balances.length - openDiscrepancies.length;
    run.discrepancyIds = openDiscrepancies.map((item) => item.id);
    run.status = openDiscrepancies.length > 0 ? "discrepant" : "matched";
    this.completeJob(job.id);
    this.appendOutbox("reconciliation.completed", run.id, {
      runId: run.id,
      status: run.status,
      discrepancyCount: run.discrepancyIds.length,
    });

    return run;
  }
}
