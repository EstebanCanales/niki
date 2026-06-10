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
};
