"use client";

import {
  CalendarDays,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  Loader2,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";

import { useWorkItems } from "@/hooks/use-work-items";
import type { WorkItem, WorkItemPriority, WorkItemSubtask } from "@/types/niki";

function formatWhen(item: WorkItem) {
  if (!item.dueAt) return null;
  const date = new Date(item.dueAt);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function dayKey(iso?: string) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function isToday(iso?: string) {
  return dayKey(iso) === new Date().toISOString().slice(0, 10);
}

function priorityTone(priority: WorkItemPriority) {
  if (priority === "high") return "text-rose-200/80";
  if (priority === "low") return "text-cyan-200/70";
  return "text-amber-200/75";
}

function buildSuggestedSubtasks(title: string): WorkItemSubtask[] {
  const base = title.trim() || "Task";
  return [
    {
      id: crypto.randomUUID(),
      title: `Definir alcance para ${base}`,
      done: false,
    },
    { id: crypto.randomUUID(), title: `Ejecutar ${base}`, done: false },
  ];
}

function sectionItems(items: WorkItem[], mode: "today" | "upcoming" | "done") {
  if (mode === "today")
    return items.filter(
      (item) => item.status === "open" && isToday(item.dueAt),
    );
  if (mode === "upcoming") {
    return items.filter(
      (item) => item.status === "open" && !isToday(item.dueAt),
    );
  }
  return items.filter((item) => item.status !== "open");
}

export function WorkItemsPanel() {
  const {
    items,
    loading,
    actionId,
    error,
    createItem,
    updateItem,
    deleteItem,
  } = useWorkItems();
  const [selectedDate, setSelectedDate] = useState(
    dayKey(new Date().toISOString()),
  );
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const sortedItems = useMemo(
    () =>
      items.toSorted((a, b) => {
        if (a.proposalStatus !== b.proposalStatus)
          return a.proposalStatus === "proposed" ? -1 : 1;
        if (a.status !== b.status) return a.status === "open" ? -1 : 1;
        if (a.priority !== b.priority) {
          const order = { high: 0, medium: 1, low: 2 };
          return order[a.priority] - order[b.priority];
        }
        return b.updatedAt.localeCompare(a.updatedAt);
      }),
    [items],
  );

  const calendarDays = useMemo(() => {
    const grouped = new Map<string, number>();
    for (const item of sortedItems) {
      const key = dayKey(item.dueAt);
      if (!key) continue;
      grouped.set(key, (grouped.get(key) ?? 0) + 1);
    }
    return [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [sortedItems]);

  const visibleByDate = useMemo(() => {
    if (!selectedDate) return sortedItems;
    const filtered = sortedItems.filter(
      (item) => !item.dueAt || dayKey(item.dueAt) === selectedDate,
    );
    return filtered.length ? filtered : sortedItems;
  }, [selectedDate, sortedItems]);

  const todayItems = sectionItems(visibleByDate, "today");
  const upcomingItems = sectionItems(visibleByDate, "upcoming");
  const doneItems = sectionItems(visibleByDate, "done");

  const suggestTask = async () => {
    const seed = `Task sugerido ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
    await createItem({
      kind: "task",
      title: seed,
      category: "Suggested",
      priority: "medium",
      proposalStatus: "proposed",
      subtasks: buildSuggestedSubtasks(seed),
      source: "manual",
    });
  };

  return (
    <div className="flex h-full flex-col bg-[linear-gradient(180deg,rgba(255,255,255,0.012)_0%,rgba(255,255,255,0.02)_100%)]">
      <div className="border-b border-white/[0.06] px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-[0.22em] text-white/28">
              Tasks
            </p>
            <p className="mt-1 text-xs text-white/46">
              {sortedItems.filter((item) => item.status === "open").length} open
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void suggestTask().catch(() => undefined)}
              disabled={actionId === "create"}
              className="flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.05] px-3 py-1.5 text-[11px] text-white/72 transition hover:bg-white/[0.09] disabled:opacity-40"
            >
              {actionId === "create" ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Sparkles className="size-3.5" />
              )}
              Suggest
            </button>
            {loading ? (
              <Loader2 className="size-3.5 animate-spin text-white/28" />
            ) : null}
          </div>
        </div>

        <div className="mt-3 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-3">
          <div className="mb-2 flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-white/30">
            <CalendarDays className="size-3.5" />
            Mini calendar
          </div>
          <div className="flex flex-wrap gap-2">
            {calendarDays.length === 0 ? (
              <span className="text-xs text-white/24">No dated tasks yet.</span>
            ) : (
              calendarDays.map(([date, count]) => (
                <button
                  key={date}
                  onClick={() => setSelectedDate(date)}
                  className="rounded-full border px-3 py-1.5 text-[11px] transition"
                  style={{
                    background:
                      selectedDate === date
                        ? "rgba(255,255,255,0.08)"
                        : "rgba(255,255,255,0.03)",
                    borderColor:
                      selectedDate === date
                        ? "rgba(255,255,255,0.14)"
                        : "rgba(255,255,255,0.08)",
                    color: "rgba(255,255,255,0.72)",
                  }}
                >
                  {date.slice(5)} · {count}
                </button>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="scrollbar-subtle flex-1 overflow-y-auto p-4">
        {error ? (
          <div className="rounded-2xl border border-red-400/15 bg-red-400/5 px-3 py-3 text-xs text-red-200/76">
            {error}
          </div>
        ) : null}

        <TaskSection
          title="Today"
          items={todayItems}
          expanded={expanded}
          setExpanded={setExpanded}
          actionId={actionId}
          onApprove={(item) =>
            void updateItem(item.id, {
              proposalStatus: "none",
              category: "Today",
            }).catch(() => undefined)
          }
          onReject={(item) => void deleteItem(item.id).catch(() => undefined)}
          onToggle={(item) =>
            void updateItem(item.id, {
              status: item.status === "open" ? "done" : "open",
            }).catch(() => undefined)
          }
          onDelete={(item) => void deleteItem(item.id).catch(() => undefined)}
          onToggleSubtask={(item, subtaskId) => {
            const subtasks = item.subtasks.map((subtask) =>
              subtask.id === subtaskId
                ? { ...subtask, done: !subtask.done }
                : subtask,
            );
            void updateItem(item.id, { subtasks }).catch(() => undefined);
          }}
        />
        <TaskSection
          title="Upcoming"
          items={upcomingItems}
          expanded={expanded}
          setExpanded={setExpanded}
          actionId={actionId}
          onApprove={(item) =>
            void updateItem(item.id, {
              proposalStatus: "none",
              category: "Upcoming",
            }).catch(() => undefined)
          }
          onReject={(item) => void deleteItem(item.id).catch(() => undefined)}
          onToggle={(item) =>
            void updateItem(item.id, {
              status: item.status === "open" ? "done" : "open",
            }).catch(() => undefined)
          }
          onDelete={(item) => void deleteItem(item.id).catch(() => undefined)}
          onToggleSubtask={(item, subtaskId) => {
            const subtasks = item.subtasks.map((subtask) =>
              subtask.id === subtaskId
                ? { ...subtask, done: !subtask.done }
                : subtask,
            );
            void updateItem(item.id, { subtasks }).catch(() => undefined);
          }}
        />
        <TaskSection
          title="Done"
          items={doneItems}
          expanded={expanded}
          setExpanded={setExpanded}
          actionId={actionId}
          onApprove={(item) =>
            void updateItem(item.id, { proposalStatus: "none" }).catch(
              () => undefined,
            )
          }
          onReject={(item) => void deleteItem(item.id).catch(() => undefined)}
          onToggle={(item) =>
            void updateItem(item.id, {
              status: item.status === "open" ? "done" : "open",
            }).catch(() => undefined)
          }
          onDelete={(item) => void deleteItem(item.id).catch(() => undefined)}
          onToggleSubtask={(item, subtaskId) => {
            const subtasks = item.subtasks.map((subtask) =>
              subtask.id === subtaskId
                ? { ...subtask, done: !subtask.done }
                : subtask,
            );
            void updateItem(item.id, { subtasks }).catch(() => undefined);
          }}
        />
      </div>
    </div>
  );
}

function TaskSection(props: {
  title: string;
  items: WorkItem[];
  expanded: Record<string, boolean>;
  setExpanded: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  actionId: string | null;
  onApprove(item: WorkItem): void;
  onReject(item: WorkItem): void;
  onToggle(item: WorkItem): void;
  onDelete(item: WorkItem): void;
  onToggleSubtask(item: WorkItem, subtaskId: string): void;
}) {
  const {
    title,
    items,
    expanded,
    setExpanded,
    actionId,
    onApprove,
    onReject,
    onToggle,
    onDelete,
    onToggleSubtask,
  } = props;
  if (!items.length) return null;

  return (
    <section className="mb-5">
      <p className="mb-2 px-1 text-[10px] uppercase tracking-[0.22em] text-white/24">
        {title}
      </p>
      <div className="space-y-3">
        {items.map((item) => {
          const when = formatWhen(item);
          const subtasks = item.subtasks ?? [];
          const isExpanded = expanded[item.id] ?? subtasks.length > 0;
          const busy = actionId === item.id;
          return (
            <div
              key={item.id}
              className="rounded-[20px] border border-white/[0.08] bg-white/[0.045] p-3 text-white/74 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
            >
              <div className="flex items-start gap-3">
                <button
                  onClick={() => onToggle(item)}
                  disabled={busy}
                  className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border transition ${
                    item.status === "done"
                      ? "border-emerald-300/25 bg-emerald-300/16 text-emerald-200"
                      : "border-white/[0.10] bg-transparent text-transparent hover:border-white/22"
                  }`}
                >
                  <Check className="size-3" />
                </button>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {subtasks.length > 0 ? (
                      <button
                        onClick={() =>
                          setExpanded((current) => ({
                            ...current,
                            [item.id]: !isExpanded,
                          }))
                        }
                        className="text-white/35"
                      >
                        {isExpanded ? (
                          <ChevronDown className="size-3.5" />
                        ) : (
                          <ChevronRight className="size-3.5" />
                        )}
                      </button>
                    ) : null}
                    <p
                      className={`text-sm ${item.status === "done" ? "line-through text-white/35" : ""}`}
                    >
                      {item.title}
                    </p>
                    {item.proposalStatus === "proposed" ? (
                      <span className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-cyan-100/75">
                        Proposed
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-2 text-[10px] uppercase tracking-[0.18em] text-white/28">
                    <span className={priorityTone(item.priority)}>
                      {item.priority}
                    </span>
                    <span>{item.category}</span>
                    {when ? <span>{when}</span> : null}
                  </div>
                  {item.notes ? (
                    <p className="mt-2 text-xs text-white/42">{item.notes}</p>
                  ) : null}

                  {item.proposalStatus === "proposed" ? (
                    <div className="mt-3 flex items-center gap-2">
                      <button
                        onClick={() => onApprove(item)}
                        className="rounded-full border border-emerald-300/20 bg-emerald-300/10 px-3 py-1 text-[11px] text-emerald-100/80"
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => onReject(item)}
                        className="rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1 text-[11px] text-white/60"
                      >
                        Reject
                      </button>
                    </div>
                  ) : null}

                  {isExpanded && subtasks.length > 0 ? (
                    <div className="mt-3 space-y-2 rounded-2xl border border-white/[0.06] bg-black/10 p-3">
                      {subtasks.map((subtask) => (
                        <button
                          key={subtask.id}
                          onClick={() => onToggleSubtask(item, subtask.id)}
                          className="flex w-full items-center gap-2 text-left text-xs text-white/64"
                        >
                          <span
                            className={`flex size-4 items-center justify-center rounded-full border ${subtask.done ? "border-emerald-300/20 bg-emerald-300/10 text-emerald-100" : "border-white/[0.10] text-transparent"}`}
                          >
                            <CheckCheck className="size-2.5" />
                          </span>
                          <span
                            className={
                              subtask.done ? "line-through text-white/30" : ""
                            }
                          >
                            {subtask.title}
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>

                <button
                  onClick={() => onDelete(item)}
                  disabled={busy}
                  className="text-white/25 hover:text-red-300 disabled:opacity-20"
                >
                  {busy ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="size-3.5" />
                  )}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
