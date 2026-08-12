type ComputerCapabilitySummary = {
  name: string;
  description: string;
  risk: string;
};

type ComputerInputHelperStatus = {
  available?: boolean;
  path?: string;
  reason?: string;
};

type ComputerPermissionsSummary = {
  ok?: boolean;
  inputHelper?: ComputerInputHelperStatus;
};

export type ComputerOperatorAction = {
  id: string;
  capability: string;
  title: string;
  subtitle: string;
  risk: string;
  state: "ready" | "disabled";
  reason?: string;
  params?: Record<string, unknown>;
  inputs?: Array<{
    key: string;
    label: string;
    placeholder: string;
    kind: "text" | "url";
  }>;
};

export type ComputerOperatorSurface = {
  summary: string;
  recommendedActions: ComputerOperatorAction[];
};

const ACTION_CATALOG: Array<{
  capability: string;
  title: string;
  subtitle: string;
  requiresInputHelper?: boolean;
  requiresParameters?: boolean;
  params?: Record<string, unknown>;
  inputs?: Array<{
    key: string;
    label: string;
    placeholder: string;
    kind: "text" | "url";
  }>;
}> = [
  {
    capability: "screen_capture",
    title: "Capture Screen",
    subtitle: "Snapshot the current desktop and refresh the viewport.",
  },
  {
    capability: "screen_info",
    title: "Screen Info",
    subtitle: "Inspect display geometry and active screen layout.",
  },
  {
    capability: "clipboard_read",
    title: "Read Clipboard",
    subtitle: "Inspect current clipboard text from macOS.",
  },
  {
    capability: "app_list",
    title: "List Apps",
    subtitle: "Inspect running applications and focus context.",
  },
  {
    capability: "system_info",
    title: "System Info",
    subtitle: "Inspect host, OS, memory, and uptime state.",
  },
  {
    capability: "app_activate",
    title: "Activate App",
    subtitle: "Bring a named app to the foreground when takeover is needed.",
    requiresInputHelper: true,
    requiresParameters: true,
    inputs: [{ key: "name", label: "App name", placeholder: "Safari", kind: "text" }],
  },
  {
    capability: "open_url",
    title: "Open URL",
    subtitle: "Open a remote page in the default browser from the operator console.",
    requiresParameters: true,
    inputs: [{ key: "url", label: "URL", placeholder: "https://hermes.nousresearch.com", kind: "url" }],
  },
  {
    capability: "clipboard_write",
    title: "Write Clipboard",
    subtitle: "Push operator text into the macOS clipboard for later paste or takeover.",
    requiresParameters: true,
    inputs: [{ key: "text", label: "Clipboard text", placeholder: "Paste-ready text", kind: "text" }],
  },
  {
    capability: "notify",
    title: "Send Notification",
    subtitle: "Emit a local macOS notification from the operator console.",
    requiresParameters: true,
    params: { title: "Niki" },
    inputs: [{ key: "message", label: "Message", placeholder: "Operator notification", kind: "text" }],
  },
];

export function projectComputerOperatorSurface(input: {
  capabilities: ComputerCapabilitySummary[];
  permissions?: ComputerPermissionsSummary | null;
}): ComputerOperatorSurface {
  const capabilityMap = new Map(input.capabilities.map((capability) => [capability.name, capability]));
  const helperAvailable = input.permissions?.inputHelper?.available === true;

  const recommendedActions = ACTION_CATALOG.reduce<ComputerOperatorAction[]>((actions, entry) => {
    const capability = capabilityMap.get(entry.capability);
    if (!capability) {
      return actions;
    }
    if (capability.risk === "high") {
      return actions;
    }
    if (entry.requiresParameters) {
      const helperBlocked = entry.requiresInputHelper && !helperAvailable;
      actions.push({
        id: entry.capability,
        capability: entry.capability,
        title: entry.title,
        subtitle: entry.subtitle,
        risk: capability.risk,
        state: helperBlocked ? "disabled" : "ready",
        reason: helperBlocked
          ? "Input helper is not ready on this machine."
          : undefined,
        params: entry.params,
        inputs: entry.inputs,
      });
      return actions;
    }
    if (entry.requiresInputHelper && !helperAvailable) {
      actions.push({
        id: entry.capability,
        capability: entry.capability,
        title: entry.title,
        subtitle: entry.subtitle,
        risk: capability.risk,
        state: "disabled",
        reason: "Input helper is not ready on this machine.",
        params: entry.params,
        inputs: entry.inputs,
      });
      return actions;
    }
    actions.push({
      id: entry.capability,
      capability: entry.capability,
      title: entry.title,
      subtitle: entry.subtitle,
      risk: capability.risk,
      state: "ready",
      params: entry.params,
      inputs: entry.inputs,
    });
    return actions;
  }, []);

  const summary = buildSurfaceSummary(recommendedActions, helperAvailable);
  return { summary, recommendedActions };
}

function buildSurfaceSummary(
  actions: ComputerOperatorAction[],
  helperAvailable: boolean,
): string {
  if (actions.length === 0) {
    return "No recommended computer actions are available for the current Hermes capability set.";
  }
  if (!helperAvailable) {
    return "Read-only inspection actions are available. Input-driven controls stay disabled until the local helper is ready.";
  }
  return "Hermes can expose safe operator actions here. Read-only inspection is ready now and guided takeover controls can expand from the same contract.";
}
