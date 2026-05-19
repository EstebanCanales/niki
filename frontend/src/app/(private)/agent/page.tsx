import type { Metadata } from "next";

import { AgentView } from "@/features/agent/agent-view";

export const metadata: Metadata = {
  title: "Agent · Niki",
  description: "Dedicated agent view for Niki.",
};

export default function AgentPage() {
  return <AgentView />;
}
