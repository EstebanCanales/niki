export type RuntimeModuleState = "hidden" | "disabled" | "flagged" | "beta" | "ready";

export type RuntimeModuleAvailability = {
  state: RuntimeModuleState;
  reason?: string;
};

export type RuntimeCapabilities = {
  modules: Record<string, RuntimeModuleAvailability>;
  capabilities: Record<string, { available: boolean; enabled: boolean; requiresSetup: boolean }>;
};

export type RuntimeCapabilityInputs = {
  hermes: {
    computerUse: boolean;
    approvals: boolean;
    mcpCatalog: boolean;
    xSearch: boolean;
    videoGenerate: boolean;
    remoteSessions: boolean;
    lspDiagnostics: boolean;
  };
  /** Si hay al menos una forma de reconocer a Esteban (cara o voz). */
  identidadDisponible?: boolean;
  flags: {
    computer: boolean;
    approvals: boolean;
    mcp: boolean;
    discover: boolean;
    sessions: boolean;
    diagnostics: boolean;
    consola?: boolean;
    terminal?: boolean;
    identidad?: boolean;
    verme?: boolean;
  };
};

function moduleState(
  featureEnabled: boolean,
  capabilityAvailable: boolean,
): RuntimeModuleAvailability {
  if (!capabilityAvailable) {
    return { state: "hidden", reason: "Hermes does not expose this capability." };
  }
  if (!featureEnabled) {
    return { state: "flagged", reason: "Feature is hidden behind a rollout flag." };
  }
  return { state: "ready" };
}

export function projectRuntimeCapabilities(input: RuntimeCapabilityInputs): RuntimeCapabilities {
  const discoverAvailable = input.hermes.xSearch || input.hermes.videoGenerate;

  return {
    modules: {
      chat: { state: "ready" },
      settings: { state: "ready" },
      computer: moduleState(input.flags.computer, input.hermes.computerUse),
      approvals: moduleState(input.flags.approvals, input.hermes.approvals),
      mcp: moduleState(input.flags.mcp, input.hermes.mcpCatalog),
      discover: moduleState(input.flags.discover, discoverAvailable),
      sessions: moduleState(input.flags.sessions, input.hermes.remoteSessions),
      diagnostics: moduleState(input.flags.diagnostics, input.hermes.lspDiagnostics),
      // La consola y la terminal no dependen de ninguna capacidad de Hermes: la consola
      // muestra el flujo de eventos, que existe siempre, y la terminal la sirve el propio
      // backend. Van listas salvo que se las apague con su bandera.
      consola: { state: input.flags.consola === false ? "hidden" : "ready" },
      terminal: { state: input.flags.terminal === false ? "hidden" : "ready" },
      // Identidad sí depende: sin el entorno de la huella de cara ni el de la voz, el
      // panel no tendría más que dos carteles diciendo que no está instalado.
      identidad: moduleState(input.flags.identidad !== false, input.identidadDisponible === true),
      // Hablar con la cámara prendida: hace falta la huella de cara instalada, igual que
      // Identidad. Sin eso el botón prometería algo que no puede cumplir.
      verme: moduleState(input.flags.verme !== false, input.identidadDisponible === true),
    },
    capabilities: {
      computer_use: {
        available: input.hermes.computerUse,
        enabled: input.flags.computer && input.hermes.computerUse,
        requiresSetup: false,
      },
      approvals: {
        available: input.hermes.approvals,
        enabled: input.flags.approvals && input.hermes.approvals,
        requiresSetup: false,
      },
      mcp_catalog: {
        available: input.hermes.mcpCatalog,
        enabled: input.flags.mcp && input.hermes.mcpCatalog,
        requiresSetup: false,
      },
      x_search: {
        available: input.hermes.xSearch,
        enabled: input.flags.discover && input.hermes.xSearch,
        requiresSetup: false,
      },
      video_generate: {
        available: input.hermes.videoGenerate,
        enabled: input.flags.discover && input.hermes.videoGenerate,
        requiresSetup: false,
      },
      remote_sessions: {
        available: input.hermes.remoteSessions,
        enabled: input.flags.sessions && input.hermes.remoteSessions,
        requiresSetup: false,
      },
      lsp_diagnostics: {
        available: input.hermes.lspDiagnostics,
        enabled: input.flags.diagnostics && input.hermes.lspDiagnostics,
        requiresSetup: false,
      },
    },
  };
}
