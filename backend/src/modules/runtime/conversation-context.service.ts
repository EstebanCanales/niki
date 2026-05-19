import { Inject, Injectable, Logger } from "@nestjs/common";

import type { NikiPersonaProfile, WorkItem } from "../../domain/contracts";
import { AuditService } from "../audit/audit.service";

import type { StoredMemoryEntry } from "../common/user-memory.service";
import { UserMemoryService } from "../common/user-memory.service";
import { IdentityService } from "../identity/identity.service";
import { WorkItemsService } from "../work-items/work-items.service";

type SessionWorkItemRef = Pick<
  WorkItem,
  "id" | "title" | "kind" | "category" | "status"
>;

type ShortConversationContext = {
  sessionId: string;
  channel: string;
  lastDomain?: "chat" | "work_items";
  lastEntityName?: string;
  lastAction?: string;
  lastUserRequest?: string;
  lastAssistantSummary?: string;
  lastWorkItems?: SessionWorkItemRef[];
  updatedAt: string;
};

function nowIso() {
  return new Date().toISOString();
}

function summarizeText(text: string, max = 220) {
  const clean = String(text ?? "").trim().replace(/\s+/g, " ");
  if (!clean) return "";
  return clean.length > max ? `${clean.slice(0, max)}...` : clean;
}

const DEFAULT_PERSONA_PROFILE: NikiPersonaProfile = {
  assistantName: "Niki",
  tone: "grounded",
  brevity: "concise",
  operationalRules: "Be concise, practical, and action-oriented. Confirm only what actually changed.",
  forbiddenBehaviors: "Do not pretend completed work if it was only planned. Do not present yourself as Hermes.",
  responseStyle: "operational",
  updatedAt: "",
};

@Injectable()
export class ConversationContextService {
  private readonly logger = new Logger(ConversationContextService.name);
  private readonly shortContext = new Map<string, ShortConversationContext>();

  constructor(
    @Inject(IdentityService)
    private readonly identityService: IdentityService,
    @Inject(AuditService)
    private readonly auditService: AuditService,
    @Inject(WorkItemsService)
    private readonly workItemsService: WorkItemsService,
    @Inject(UserMemoryService)
    private readonly userMemoryService: UserMemoryService,
  ) {}

  async captureUserTurn(userId: string, sessionId: string, channel: string, input: string) {
    this.updateShortContext(userId, sessionId, channel, {
      lastDomain: "chat",
      lastUserRequest: summarizeText(input),
      updatedAt: nowIso(),
    });
    await this.rememberExplicitFacts(userId, input);
  }

  async recordAssistantReply(
    userId: string,
    sessionId: string,
    channel: string,
    text: string,
  ) {
    this.updateShortContext(userId, sessionId, channel, {
      lastAssistantSummary: summarizeText(text),
      updatedAt: nowIso(),
    });
  }

  async recordWorkItemListing(
    userId: string,
    sessionId: string,
    channel: string,
    items: WorkItem[],
  ) {
    this.updateShortContext(userId, sessionId, channel, {
      lastDomain: "work_items",
      lastAction: "list",
      lastWorkItems: items.slice(0, 12).map((item) => ({
        id: item.id,
        title: item.title,
        kind: item.kind,
        category: item.category,
        status: item.status,
      })),
      updatedAt: nowIso(),
    });
  }

  async recordWorkItemMutation(
    userId: string,
    sessionId: string,
    channel: string,
    action: "create" | "update" | "delete",
    item: WorkItem,
  ) {
    this.updateShortContext(userId, sessionId, channel, {
      lastDomain: "work_items",
      lastAction: action,
      lastEntityName: item.title,
      lastWorkItems: [
        {
          id: item.id,
          title: item.title,
          kind: item.kind,
          category: item.category,
          status: item.status,
        },
      ],
      updatedAt: nowIso(),
    });
    await this.userMemoryService
      .setStructuredEntry(userId, "work_items.last_change", {
        action,
        itemId: item.id,
        title: item.title,
        kind: item.kind,
        category: item.category,
        status: item.status,
        updatedAt: item.updatedAt,
      })
      .catch((error) => {
        this.logger.warn(`[memory] work_items.last_change skipped: ${String(error)}`);
      });
  }

  getPreferredWorkItemIds(userId: string, sessionId: string, channel: string) {
    return (
      this.getShortContext(userId, sessionId, channel)?.lastWorkItems?.map((item) => item.id) ??
      []
    );
  }

  async getPersonaProfile(userId: string) {
    const entries = await this.userMemoryService.safeListEntries(userId);
    return this.parsePersonaProfile(entries);
  }

  async buildRuntimeContext(userId: string, sessionId: string, channel: string) {
    const [me, activities, workItems, memory] = await Promise.all([
      Promise.resolve(this.identityService.me(userId)).catch(() => null),
      Promise.resolve(this.auditService.activities(userId)).catch(() => null),
      Promise.resolve(this.workItemsService.list(userId)).catch(() => null),
      this.userMemoryService.safeListEntries(userId),
    ]);

    const context = {
      assistant: {
        name: "Niki",
        runtime: "Hermes",
      },
      personaProfile: this.parsePersonaProfile(memory),
      user: me?.user
        ? {
            id: me.user.id,
            displayName: me.user.displayName,
            email: me.user.email,
            jurisdiction: me.user.jurisdiction,
          }
        : null,
      compliance: me?.compliance ?? null,
      session: this.getShortContext(userId, sessionId, channel) ?? null,
      activeWorkItems:
        (workItems?.items ?? []).slice(0, 12).map((item) => ({
          id: item.id,
          kind: item.kind,
          title: item.title,
          category: item.category,
          status: item.status,
          priority: item.priority,
          dueAt: item.dueAt,
          proposalStatus: item.proposalStatus,
          subtasks: item.subtasks,
        })) ?? [],
      recentActivities:
        (activities?.activities ?? []).slice(0, 8).map((item) => ({
          ts: item.ts,
          title: item.title,
          summary: item.summary,
          type: item.type,
        })) ?? [],
      durableMemory: memory.slice(0, 10).map((entry: StoredMemoryEntry) => ({
        key: entry.key,
        value: summarizeText(entry.value, 180),
        updatedAt: entry.updatedAt,
      })),
    };

    return JSON.stringify(context);
  }

  private getContextKey(userId: string, sessionId: string, channel: string) {
    return `${userId}:${sessionId}:${channel}`;
  }

  private getShortContext(userId: string, sessionId: string, channel: string) {
    return this.shortContext.get(this.getContextKey(userId, sessionId, channel)) ?? null;
  }

  private updateShortContext(
    userId: string,
    sessionId: string,
    channel: string,
    patch: Partial<ShortConversationContext>,
  ) {
    const key = this.getContextKey(userId, sessionId, channel);
    const current =
      this.shortContext.get(key) ??
      ({
        sessionId,
        channel,
        updatedAt: nowIso(),
      } satisfies ShortConversationContext);
    this.shortContext.set(key, {
      ...current,
      ...patch,
      sessionId,
      channel,
      updatedAt: patch.updatedAt ?? nowIso(),
    });
  }

  private async rememberExplicitFacts(userId: string, input: string) {
    const text = String(input ?? "").trim();
    if (!text) return;

    const existingEntries = await this.userMemoryService.safeListEntries(userId);
    const currentPersonaProfile = this.parsePersonaProfile(existingEntries);
    const captures: Array<{ key: string; value: string }> = [];

    const nameMatch = text.match(/\b(?:mi nombre es|my name is)\s+([^\n\.,]+)/i);
    if (nameMatch?.[1]) {
      captures.push({ key: "profile.display_name", value: nameMatch[1].trim() });
    }

    const preferenceMatch = text.match(/\b(?:prefiero|i prefer)\s+([^\n\.,]+)/i);
    if (preferenceMatch?.[1]) {
      captures.push({
        key: "preferences.last_explicit_preference",
        value: preferenceMatch[1].trim(),
      });
    }

    const personaCapture = this.extractPersonaPreference(text);
    if (personaCapture) {
      captures.push({
        key: "preferences.persona_profile",
        value: JSON.stringify({
          ...currentPersonaProfile,
          ...personaCapture,
          updatedAt: nowIso(),
        } satisfies NikiPersonaProfile),
      });
    }

    const explicitRememberMatch = text.match(/\b(?:recuerda que|remember that)\s+([^\n]+)/i);
    if (explicitRememberMatch?.[1]) {
      captures.push({
        key: "context.explicit_note",
        value: explicitRememberMatch[1].trim(),
      });
    }

    await Promise.all(
      captures.map((capture) =>
        this.userMemoryService.setEntry(userId, capture.key, capture.value).catch((error) => {
          this.logger.warn(`[memory] rememberExplicitFacts skipped: ${String(error)}`);
        }),
      ),
    );
  }

  private parsePersonaProfile(entries: StoredMemoryEntry[]) {
    const raw = entries.find((entry) => entry.key === "preferences.persona_profile")?.value;
    if (!raw) return DEFAULT_PERSONA_PROFILE;

    try {
      const parsed = JSON.parse(raw) as Partial<NikiPersonaProfile>;
      return {
        assistantName:
          typeof parsed.assistantName === "string" && parsed.assistantName.trim()
            ? parsed.assistantName.trim()
            : "Niki",
        tone:
          parsed.tone === "warm" || parsed.tone === "direct" ? parsed.tone : "grounded",
        brevity:
          parsed.brevity === "balanced" || parsed.brevity === "detailed"
            ? parsed.brevity
            : "concise",
        operationalRules:
          typeof parsed.operationalRules === "string" && parsed.operationalRules.trim()
            ? parsed.operationalRules.trim()
            : DEFAULT_PERSONA_PROFILE.operationalRules,
        forbiddenBehaviors:
          typeof parsed.forbiddenBehaviors === "string" && parsed.forbiddenBehaviors.trim()
            ? parsed.forbiddenBehaviors.trim()
            : DEFAULT_PERSONA_PROFILE.forbiddenBehaviors,
        responseStyle:
          parsed.responseStyle === "friendly" || parsed.responseStyle === "brief_status"
            ? parsed.responseStyle
            : "operational",
        updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : "",
      } satisfies NikiPersonaProfile;
    } catch {
      return DEFAULT_PERSONA_PROFILE;
    }
  }

  private extractPersonaPreference(text: string): Partial<NikiPersonaProfile> | null {
    const normalized = text
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();

    const next: Partial<NikiPersonaProfile> = {};

    if (
      /\b(mas corto|mas breve|breve|concis|shorter|be brief|more concise)\b/.test(normalized)
    ) {
      next.brevity = "concise";
    } else if (/\b(mas detallad|detailed|more detail)\b/.test(normalized)) {
      next.brevity = "detailed";
    } else if (/\b(balancead|balanced)\b/.test(normalized)) {
      next.brevity = "balanced";
    }

    if (/\b(calid|warm|cercan)\b/.test(normalized)) {
      next.tone = "warm";
    } else if (/\b(direct|directa|directo|sin rodeos)\b/.test(normalized)) {
      next.tone = "direct";
    } else if (/\b(grounded|aterrizad|pragmat)\b/.test(normalized)) {
      next.tone = "grounded";
    }

    if (/\b(amigable|friendly|cercan)\b/.test(normalized)) {
      next.responseStyle = "friendly";
    } else if (/\b(status|estado breve|brief status)\b/.test(normalized)) {
      next.responseStyle = "brief_status";
    } else if (/\b(operativ|operational)\b/.test(normalized)) {
      next.responseStyle = "operational";
    }

    return Object.keys(next).length > 0 ? next : null;
  }
}
