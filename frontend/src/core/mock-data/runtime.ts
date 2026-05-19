import type {
  MemoryCollection,
  RuntimeSnapshot,
  RuntimeEvent,
  SessionMessage,
  ToolDescriptor,
} from "@/types/niki";

const now = new Date();

function isoMinutesAgo(minutes: number) {
  return new Date(now.getTime() - minutes * 60_000).toISOString();
}

const mockTools: ToolDescriptor[] = [
  {
    id: "browser",
    name: "Browser Tool",
    description:
      "Navigate pages, gather context, and run browser-side actions.",
    origin: "core",
    icon: "Globe2",
    category: "Research",
    status: "busy",
    health: "healthy",
    permissions: ["browser.read", "browser.write"],
    capabilities: ["page navigation", "capture", "open links"],
    inputSchema: ["query", "targetUrl", "action"],
    outputSchema: ["summary", "artifacts", "links"],
    lastActivity: isoMinutesAgo(1),
    configSummary: "Desktop browser bridge on localhost:7331",
    recentEvents: [
      {
        id: "evt-browser-1",
        title: "Opened docs reference",
        status: "success",
        at: isoMinutesAgo(1),
      },
      {
        id: "evt-browser-2",
        title: "Captured DOM context",
        status: "info",
        at: isoMinutesAgo(4),
      },
    ],
    recentResult:
      "Hermes resolved the OBS WebSocket auth troubleshooting steps.",
    quickActions: [
      {
        id: "browser-qa1",
        label: "Research topic",
        prompt: "Research the current topic and summarize the essentials.",
      },
      {
        id: "browser-qa2",
        label: "Open dashboard",
        prompt: "Open the creator analytics dashboard.",
      },
    ],
    enabled: true,
  },
  {
    id: "memory",
    name: "Memory Tool",
    description: "Write, recall, and pin durable context for future runs.",
    origin: "core",
    icon: "BrainCircuit",
    category: "Context",
    status: "ready",
    health: "healthy",
    permissions: ["memory.read", "memory.write"],
    capabilities: ["semantic recall", "pinning", "entity extraction"],
    inputSchema: ["query", "entity", "workspace"],
    outputSchema: ["entries", "scores", "linked context"],
    lastActivity: isoMinutesAgo(5),
    configSummary: "Persistent memory-core enabled",
    recentEvents: [
      {
        id: "evt-memory-1",
        title: "Pinned streamer overlay preference",
        status: "success",
        at: isoMinutesAgo(14),
      },
    ],
    recentResult: "Recovered preferred intro scene and low-latency audio mix.",
    quickActions: [
      {
        id: "memory-qa1",
        label: "Recall setup",
        prompt: "Recall my preferred studio setup before going live.",
      },
    ],
    enabled: true,
  },
  {
    id: "obs",
    name: "OBS Tool",
    description:
      "Inspect scenes, transitions, audio channels, and stream controls.",
    origin: "plugin",
    icon: "Video",
    category: "Streamer",
    status: "ready",
    health: "healthy",
    permissions: ["obs.read", "obs.write"],
    capabilities: ["scene switch", "recording", "stream health"],
    inputSchema: ["sceneId", "transition", "muteState"],
    outputSchema: ["ack", "sceneList", "levels"],
    lastActivity: isoMinutesAgo(7),
    configSummary: "Connected to OBS WebSocket 5.4",
    recentEvents: [
      {
        id: "evt-obs-1",
        title: "Validated scene collection",
        status: "success",
        at: isoMinutesAgo(7),
      },
    ],
    recentResult: "Seven scenes ready, recording standby armed.",
    quickActions: [
      {
        id: "obs-qa1",
        label: "Studio check",
        prompt: "Run the full OBS pre-stream check.",
      },
      {
        id: "obs-qa2",
        label: "Switch scene",
        prompt: "Switch to the interview scene.",
      },
    ],
    enabled: true,
  },
  {
    id: "voice",
    name: "Voice Tool",
    description:
      "Handle microphone capture, transcript streaming, and TTS playback.",
    origin: "core",
    icon: "Mic2",
    category: "Voice",
    status: "busy",
    health: "healthy",
    permissions: ["voice.input", "voice.output"],
    capabilities: ["push to talk", "tts", "transcript stream"],
    inputSchema: ["utterance", "voiceId", "deviceId"],
    outputSchema: ["transcript", "audio", "latency"],
    lastActivity: isoMinutesAgo(0),
    configSummary: "ElevenLabs free tier output + LM Studio local executor",
    recentEvents: [
      {
        id: "evt-voice-1",
        title: "Mic gate calibrated",
        status: "success",
        at: isoMinutesAgo(3),
      },
      {
        id: "evt-voice-2",
        title: "Playback route active",
        status: "info",
        at: isoMinutesAgo(1),
      },
    ],
    recentResult: "Listening for a push-to-talk request on Alt+Space.",
    quickActions: [
      { id: "voice-qa1", label: "Voice reply", prompt: "Answer using voice." },
    ],
    enabled: true,
  },
  {
    id: "filesystem",
    name: "Files Tool",
    description: "Read workspace assets, transcripts, configs, and exports.",
    origin: "core",
    icon: "Files",
    category: "Workspace",
    status: "ready",
    health: "healthy",
    permissions: ["files.read", "files.write"],
    capabilities: ["file browse", "transcript exports", "config snapshots"],
    inputSchema: ["path", "pattern", "action"],
    outputSchema: ["fileMeta", "preview", "diff"],
    lastActivity: isoMinutesAgo(13),
    configSummary: "Workspace-scoped file adapter",
    recentEvents: [
      {
        id: "evt-files-1",
        title: "Transcript export indexed",
        status: "info",
        at: isoMinutesAgo(13),
      },
    ],
    recentResult: "Found the latest stream transcript and config.",
    quickActions: [
      {
        id: "files-qa1",
        label: "Open transcript",
        prompt: "Find the latest stream transcript.",
      },
    ],
    enabled: true,
  },
];

const mockSessionMessages: Record<string, SessionMessage[]> = {
  "session-live-01": [],
};

const memory: MemoryCollection = {
  recent: [
    {
      id: "mem-r1",
      title: "Preferred intro energy",
      content:
        "Keep the first two minutes calm, then switch to interview scene once chat velocity stabilizes.",
      kind: "preference",
      score: 0.93,
      updatedAt: isoMinutesAgo(18),
    },
    {
      id: "mem-r2",
      title: "Research tone",
      content:
        "When browsing live topics, summarize in three bullets and one risk note.",
      kind: "workflow",
      score: 0.88,
      updatedAt: isoMinutesAgo(34),
    },
  ],
  persistent: [
    {
      id: "mem-p1",
      title: "Desktop voice routing",
      content:
        "Use ElevenLabs free tier voice output through the virtual cable on channel B.",
      kind: "context",
      pinned: true,
      score: 0.97,
      updatedAt: isoMinutesAgo(44),
    },
    {
      id: "mem-p2",
      title: "Hermes operator defaults",
      content:
        "Prefer local models for tool planning and execution. Use cloud voice only for TTS.",
      kind: "workflow",
      score: 0.95,
      updatedAt: isoMinutesAgo(52),
    },
  ],
  pinned: [
    {
      id: "mem-pin-1",
      title: "Studio baseline",
      content:
        "Mic gain -4 dB, camera crop preset B, OBS profile ClawDesk Studio.",
      kind: "note",
      pinned: true,
      score: 0.99,
      updatedAt: isoMinutesAgo(60),
    },
  ],
  entities: [
    {
      id: "mem-e1",
      title: "Workspace persona",
      content: "Niki should sound calm, concise, and operational.",
      kind: "entity",
      score: 0.84,
      updatedAt: isoMinutesAgo(72),
    },
    {
      id: "mem-e2",
      title: "Streamer preset",
      content:
        "OBS, chat moderation, overlays, analytics, and quick research are bundled for live operations.",
      kind: "entity",
      score: 0.82,
      updatedAt: isoMinutesAgo(85),
    },
  ],
  status: {
    indexed: 248,
    dirty: 3,
    lastSync: isoMinutesAgo(6),
  },
};

const mockLogs: RuntimeEvent[] = [
  {
    id: "log-1",
    ts: isoMinutesAgo(1),
    level: "info",
    source: "voice",
    type: "voice.ready",
    title: "Push-to-talk armed",
    summary: "Voice tool is listening on Alt+Space.",
    detail:
      "Device route Virtual Cable B; transcript streaming low-latency mode enabled.",
  },
  {
    id: "log-2",
    ts: isoMinutesAgo(3),
    level: "success",
    source: "runtime",
    type: "runtime.sync",
    title: "Catalog sync complete",
    summary: "19 tools and 6 integrations refreshed from Hermes.",
  },
];

export const mockSnapshot: RuntimeSnapshot = {
  connection: {
    state: "ready",
    endpoint: "mock://hermes-runtime",
    latencyMs: 38,
    operatorMode: "operator",
    runtimeVersion: "0.8.2-local",
  },
  agent: {
    name: "Niki",
    state: "thinking",
    model: "LM Studio / qwen2.5-coder",
    voice: "ElevenLabs / Free tier",
    channel: "Desktop operator",
    uptime: "02:13:28",
    currentTask: "Preparing a desktop-first runtime summary",
    summary:
      "Connected to Hermes. Supervising tools, memory, and session context.",
  },
  tools: mockTools,
  sessions: [
    {
      id: "session-live-01",
      title: "Pre-stream readiness",
      summary:
        "OBS health, overlays, chat moderation, and voice routing check.",
      status: "live",
      mode: "autopilot",
      updatedAt: isoMinutesAgo(1),
      toolsUsed: ["obs", "voice", "memory"],
    },
    {
      id: "session-ops-02",
      title: "Runtime architecture review",
      summary: "Bridge contract and layout persistence planning.",
      status: "complete",
      mode: "command",
      updatedAt: isoMinutesAgo(26),
      toolsUsed: ["browser", "filesystem", "memory"],
    },
  ],
  sessionMessages: mockSessionMessages,
  activeSessionId: "session-live-01",
  memory,
  integrations: [
    {
      id: "int-hermes-runtime",
      name: "Hermes Runtime",
      icon: "RadioTower",
      description:
        "Primary runtime backend, tools catalog, sessions, and event stream.",
      state: "connected",
      dependsOn: ["browser", "memory", "voice"],
      health: "healthy",
      updatedAt: isoMinutesAgo(2),
    },
    {
      id: "int-elevenlabs",
      name: "ElevenLabs",
      icon: "AudioWaveform",
      description: "TTS output for voice responses.",
      state: "connected",
      dependsOn: ["voice"],
      health: "healthy",
      updatedAt: isoMinutesAgo(5),
    },
    {
      id: "int-lmstudio",
      name: "LM Studio",
      icon: "Cpu",
      description: "Primary local model executor for planning and tool work.",
      state: "connected",
      dependsOn: ["browser", "memory", "voice"],
      health: "healthy",
      updatedAt: isoMinutesAgo(4),
    },
    {
      id: "int-obs",
      name: "OBS WebSocket",
      icon: "MonitorUp",
      description:
        "Scene control, stream health, transitions, and audio channels.",
      state: "connected",
      dependsOn: ["obs"],
      health: "healthy",
      updatedAt: isoMinutesAgo(7),
    },
  ],
  plugins: [
    {
      id: "plugin-obs",
      name: "OBS runtime adapter",
      type: "plugin",
      version: "1.3.0",
      status: "ready",
      origin: "local plugin",
      description:
        "Bridges OBS scenes, transitions, audio meters, and stream actions into Hermes.",
    },
    {
      id: "skill-streamer",
      name: "Streamer operations skill",
      type: "skill",
      version: "0.5.4",
      status: "ready",
      origin: "workspace skill",
      description:
        "Packages live research, scene prep, moderation, and recap heuristics.",
    },
  ],
  logs: mockLogs,
  files: [
    {
      id: "file-1",
      name: "latest-stream-transcript.md",
      kind: "transcript",
      summary:
        "Transcript and highlights extracted from the last creator workflow stream.",
      updatedAt: isoMinutesAgo(16),
    },
    {
      id: "file-2",
      name: "niki-layout.json",
      kind: "config",
      summary:
        "Saved panel geometry, command palette defaults, and voice settings.",
      updatedAt: isoMinutesAgo(31),
    },
    {
      id: "file-3",
      name: "overlay-assets.zip",
      kind: "asset",
      summary: "Starter kit for intro scene overlays and lower thirds.",
      updatedAt: isoMinutesAgo(57),
    },
  ],
  approvals: [],
  streamerPreset: {
    title: "Streamer operations preset",
    description:
      "A curated workspace that layers OBS, chat, moderation, overlays, and post-stream insight on top of Hermes.",
    tools: ["obs", "voice", "browser", "memory"],
    scenes: [
      "Starting Soon",
      "Camera",
      "Interview",
      "Research",
      "Break",
      "Outro",
    ],
    streamHealth: "Stable audio, overlays synced.",
    liveRecommendations: [
      "Keep Voice Tool armed for push-to-talk research moments.",
      "Use the Research quick action bundle for live fact checks.",
    ],
  },
};

export const rotatingEvents: RuntimeEvent[] = [
  {
    id: "rot-1",
    ts: isoMinutesAgo(0),
    level: "info",
    source: "memory",
    type: "memory.recall",
    title: "Memory recall completed",
    summary: "Recovered studio baseline and preferred intro energy.",
  },
  {
    id: "rot-2",
    ts: isoMinutesAgo(0),
    level: "success",
    source: "obs",
    type: "obs.scene.ready",
    title: "Interview scene ready",
    summary: "Camera framing and media sources passed validation.",
  },
  {
    id: "rot-4",
    ts: isoMinutesAgo(0),
    level: "info",
    source: "voice",
    type: "voice.partial",
    title: "Voice transcript partial",
    summary:
      '"Prepare the research scene and keep chat moderation in passive mode."',
  },
];
