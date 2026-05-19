export type ChatRequestDto = {
  input?: string;
  sessionId?: string;
  channel?: string;
  messages?: Array<{ role?: string; content?: string }>;
};
