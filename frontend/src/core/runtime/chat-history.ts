import type { SessionMessage } from "@/types/niki";

const MAX_HISTORY_MESSAGES = 32;

export function stripChatControlMarkers(text: string) {
  return String(text ?? "")
    .replace(/\[@[^\]]+\]\(plugin:\/\/[^\)]+\)/gi, "")

    .replace(/\[\[work_item_(?:created|updated|deleted):[^\]]+\]\]/gi, "")
    .replace(/\[\[progress:[^\]]+\]\]/gi, "")
    .replace(/\[\[grid:[^\]]+\]\]/gi, "")
    .replace(/\[\[exec_status:[^\]]+\]\]/gi, "")
    .trim();
}

export function extractWorkItemMarkers(text: string) {
  const markers: Array<{
    action: "created" | "updated" | "deleted";
    id: string;
  }> = [];
  const pattern = /\[\[work_item_(created|updated|deleted):([^\]]+)\]\]/gi;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(String(text ?? ""))) !== null) {
    const action = match[1] as "created" | "updated" | "deleted";
    const id = String(match[2] ?? "").trim();
    if (id) markers.push({ action, id });
  }

  return markers;
}

export function buildHermesRequestMessages(messages: SessionMessage[]) {
  const requestMessages: Array<{
    role: SessionMessage["role"];
    content: string;
  }> = [];

  for (const message of messages) {
    if (
      message.role !== "user" &&
      message.role !== "assistant" &&
      message.role !== "system"
    ) {
      continue;
    }

    const content = stripChatControlMarkers(message.content);
    if (!content) {
      continue;
    }

    requestMessages.push({
      role: message.role,
      content,
    });
  }

  return requestMessages.slice(-MAX_HISTORY_MESSAGES);
}
