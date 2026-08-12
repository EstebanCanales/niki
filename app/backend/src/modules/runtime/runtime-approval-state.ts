import type { RuntimeApprovalRequest, RuntimeApprovalResolution } from "./runtime-events";

type ApprovalResolutionInput = {
  runId: string;
  choice: string;
  all: boolean;
};

export function applyApprovalResolution(
  pendingApprovals: RuntimeApprovalRequest[],
  input: ApprovalResolutionInput,
): {
  pending: RuntimeApprovalRequest[];
  resolved: RuntimeApprovalResolution[];
} {
  const matches = pendingApprovals.filter((approval) => approval.runId === input.runId);
  if (matches.length === 0) {
    return { pending: pendingApprovals, resolved: [] };
  }

  const resolvedTargets = input.all ? matches : matches.slice(0, 1);
  const resolvedIds = new Set(resolvedTargets.map((approval) => approval.id));

  return {
    pending: pendingApprovals.filter((approval) => !resolvedIds.has(approval.id)),
    resolved: resolvedTargets.map((approval, index) => ({
      id: approval.id,
      runId: approval.runId,
      decision: input.choice,
      resolved: index + 1,
    })),
  };
}
