import type { Metadata } from "next";

import { AgentView } from "@/features/agent/agent-view";

export const metadata: Metadata = {
  title: "Home · Niki",
  description: "Main Niki workspace and agent cockpit.",
};

export default function HomePage() {
  return <AgentView />;
}
