import type { Metadata } from "next";

import { SessionsView } from "@/features/sessions/sessions-view";

export const metadata: Metadata = {
  title: "Sessions · Niki",
  description: "Browse and inspect Niki chat sessions.",
};

export default function SessionsPage() {
  return <SessionsView />;
}
