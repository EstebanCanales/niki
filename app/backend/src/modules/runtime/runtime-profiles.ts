import type { RuntimeSessionSummary } from "./runtime-sessions";

export type RuntimeProfileSummary = {
  id: string;
  label: string;
  sessionCount: number;
  lastSeenAt?: string;
  providers: string[];
  models: string[];
};

export function projectRuntimeProfiles(sessions: RuntimeSessionSummary[]): RuntimeProfileSummary[] {
  const byProfile = new Map<string, RuntimeProfileSummary>();

  for (const session of sessions) {
    const profileId = String(session.profileId || "default").trim() || "default";
    const existing = byProfile.get(profileId) ?? {
      id: profileId,
      label: profileId,
      sessionCount: 0,
      lastSeenAt: undefined,
      providers: [],
      models: [],
    };

    existing.sessionCount += 1;
    if ((session.updatedAt ?? "") > (existing.lastSeenAt ?? "")) {
      existing.lastSeenAt = session.updatedAt;
    }
    if (session.provider && !existing.providers.includes(session.provider)) {
      existing.providers.push(session.provider);
      existing.providers.sort();
    }
    if (session.model && !existing.models.includes(session.model)) {
      existing.models.push(session.model);
      existing.models.sort();
    }

    byProfile.set(profileId, existing);
  }

  return [...byProfile.values()].sort((left, right) => {
    const timeCompare = (right.lastSeenAt ?? "").localeCompare(left.lastSeenAt ?? "");
    if (timeCompare !== 0) return timeCompare;
    return left.label.localeCompare(right.label);
  });
}
