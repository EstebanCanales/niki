import type { Metadata } from "next";

import { TasksView } from "@/features/tasks/tasks-view";

export const metadata: Metadata = {
  title: "Tasks · Niki",
  description: "Manage tasks and work items in Niki.",
};

export default function TasksPage() {
  return <TasksView />;
}
