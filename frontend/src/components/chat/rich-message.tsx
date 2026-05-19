"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";

type RichSegment =
  | { kind: "markdown"; content: string }
  | { kind: "callout"; title?: string; tone?: string; content: string }
  | { kind: "quote"; author?: string; content: string }
  | { kind: "noteCard"; folder?: string; title?: string; content: string }
  | { kind: "taskList"; title?: string; items: string[] }
  | {
      kind: "checklist";
      title?: string;
      items: Array<{ label: string; checked: boolean }>;
    }
  | {
      kind: "noteCollection";
      title?: string;
      notes: Array<{ folder: string; title: string; summary?: string }>;
    }
  | { kind: "taskCollection"; title?: string; items: string[] };

const markdownComponents: Components = {
  p: ({ children }) => (
    <p className="text-sm leading-7 text-white/80">{children}</p>
  ),
  a: ({ children, href }) => (
    <a
      href={href}
      className="text-cyan-300 underline decoration-cyan-400/30 underline-offset-4 transition hover:text-cyan-200"
      target="_blank"
      rel="noreferrer"
    >
      {children}
    </a>
  ),
  ul: ({ children }) => (
    <ul className="my-2 space-y-1 pl-5 text-sm text-white/78">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="my-2 space-y-1 pl-5 text-sm text-white/78">{children}</ol>
  ),
  li: ({ children }) => (
    <li className="leading-7 marker:text-cyan-300">{children}</li>
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-3 rounded-2xl border-l-2 border-cyan-300/35 bg-cyan-400/[0.05] px-4 py-3 text-sm text-white/74">
      {children}
    </blockquote>
  ),
  table: ({ children }) => (
    <div className="my-4 overflow-x-auto rounded-2xl border border-white/[0.07] bg-white/[0.03]">
      <table className="min-w-full text-left text-sm text-white/76">
        {children}
      </table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="bg-white/[0.04] text-white/86">{children}</thead>
  ),
  tbody: ({ children }) => <tbody>{children}</tbody>,
  tr: ({ children }) => (
    <tr className="border-t border-white/[0.06]">{children}</tr>
  ),
  th: ({ children }) => <th className="px-4 py-3 font-medium">{children}</th>,
  td: ({ children }) => <td className="px-4 py-3 text-white/72">{children}</td>,
  code: ({ children, className }) => {
    const isBlock = String(className ?? "").includes("language-");
    if (!isBlock) {
      return (
        <code className="rounded-md border border-white/[0.08] bg-white/[0.04] px-1.5 py-0.5 font-mono text-[13px] text-cyan-200">
          {children}
        </code>
      );
    }
    return (
      <code className="block overflow-x-auto rounded-2xl border border-white/[0.07] bg-[#0a0e14] px-4 py-3 font-mono text-[13px] text-cyan-100">
        {children}
      </code>
    );
  },
  pre: ({ children }) => <pre className="my-4">{children}</pre>,
  hr: () => <hr className="my-4 border-white/[0.08]" />,
};

function parseAttrs(raw: string) {
  const attrs: Record<string, string> = {};
  const attrRe = /(\w+)="([^"]*)"/g;
  let match: RegExpExecArray | null;
  while ((match = attrRe.exec(raw)) !== null) {
    attrs[match[1]] = match[2];
  }
  return attrs;
}

function parseTaskItems(content: string) {
  const items: string[] = [];

  for (const rawLine of content.split("\n")) {
    const line = rawLine
      .trim()
      .replace(/^(?:[-*]|\d+\.)\s+/, "")
      .trim();
    if (line) {
      items.push(line);
    }
  }

  return items;
}

function parseChecklistItems(content: string) {
  const items: Array<{ label: string; checked: boolean }> = [];

  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    const match = line.match(/^[-*]\s+\[(x|X| )\]\s+(.+)$/);
    if (!match) {
      continue;
    }

    items.push({
      checked: match[1].toLowerCase() === "x",
      label: match[2].trim(),
    });
  }

  return items;
}

function parseApprovedTags(text: string): RichSegment[] {
  const out: RichSegment[] = [];
  const tagRe =
    /<(Callout|NoteCard|TaskList|Checklist|Quote)([^>]*)>([\s\S]*?)<\/\1>/gi;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tagRe.exec(text)) !== null) {
    const before = text.slice(lastIndex, match.index).trim();
    if (before) out.push({ kind: "markdown", content: before });

    const [, tagName, rawAttrs, rawContent] = match;
    const attrs = parseAttrs(rawAttrs);
    const content = rawContent.trim();

    switch (tagName) {
      case "Callout":
        out.push({
          kind: "callout",
          title: attrs.title,
          tone: attrs.tone,
          content,
        });
        break;
      case "Quote":
        out.push({
          kind: "quote",
          author: attrs.author,
          content,
        });
        break;
      case "NoteCard":
        out.push({
          kind: "noteCard",
          folder: attrs.folder,
          title: attrs.title,
          content,
        });
        break;
      case "TaskList":
        out.push({
          kind: "taskList",
          title: attrs.title,
          items: parseTaskItems(content),
        });
        break;
      case "Checklist":
        out.push({
          kind: "checklist",
          title: attrs.title,
          items: parseChecklistItems(content),
        });
        break;
      default:
        out.push({ kind: "markdown", content: match[0] });
        break;
    }

    lastIndex = match.index + match[0].length;
  }

  const tail = text.slice(lastIndex).trim();
  if (tail) out.push({ kind: "markdown", content: tail });
  return out;
}

function detectNotesCollection(text: string): RichSegment | null {
  const lines = text.split("\n").flatMap((line) => {
    const trimmed = line.trim();
    return trimmed ? [trimmed] : [];
  });
  if (!lines.length) return null;
  const noteLines = lines.filter((line) =>
    /^\*\*([^*]+)\*\*\s*-\s*(.+)$/.test(line),
  );
  if (noteLines.length < 2) return null;
  if (!/notes?:/i.test(lines[0]) && !/notes?:/i.test(text)) return null;

  const notes = noteLines
    .map((line) => {
      const match = line.match(/^\*\*([^*]+)\*\*\s*-\s*(.+)$/);
      if (!match) return null;
      return {
        folder: match[1].trim(),
        title: match[2].trim(),
      };
    })
    .filter((item): item is { folder: string; title: string } => item !== null);

  if (notes.length < 2) return null;
  return {
    kind: "noteCollection",
    title: lines[0].replace(/:$/, ""),
    notes,
  };
}

function detectTaskCollection(text: string): RichSegment | null {
  const lines = text.split("\n").flatMap((line) => {
    const trimmed = line.trim();
    return trimmed ? [trimmed] : [];
  });
  if (lines.length < 3) return null;
  if (!/(reminders?|tasks?|pending|to-?do)/i.test(lines[0])) return null;

  const items = lines.slice(1).flatMap((line) => {
    const normalized = line.replace(/^(?:[-*]|\d+\.)\s+/, "").trim();
    return normalized ? [normalized] : [];
  });

  if (items.length < 2) return null;
  return {
    kind: "taskCollection",
    title: lines[0].replace(/:$/, ""),
    items,
  };
}

function buildSegments(text: string): RichSegment[] {
  const parsed = parseApprovedTags(text);
  if (parsed.length > 1 || (parsed[0] && parsed[0].kind !== "markdown")) {
    return parsed;
  }

  const noteCollection = detectNotesCollection(text);
  if (noteCollection) {
    return [noteCollection];
  }

  const taskCollection = detectTaskCollection(text);
  if (taskCollection) {
    return [taskCollection];
  }

  return [{ kind: "markdown", content: text }];
}

function MarkdownBlock({ content }: { content: string }) {
  return (
    <div className="space-y-3">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={markdownComponents}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function CalloutBlock({
  title,
  tone,
  content,
}: {
  title?: string;
  tone?: string;
  content: string;
}) {
  const palette =
    tone === "warning"
      ? "border-amber-300/18 bg-amber-300/[0.06]"
      : tone === "success"
        ? "border-emerald-300/18 bg-emerald-300/[0.06]"
        : "border-cyan-300/18 bg-cyan-300/[0.06]";

  return (
    <div className={`rounded-[24px] border px-4 py-4 ${palette}`}>
      {title ? (
        <p className="mb-2 text-sm font-medium text-white/90">{title}</p>
      ) : null}
      <MarkdownBlock content={content} />
    </div>
  );
}

function QuoteBlock({ author, content }: { author?: string; content: string }) {
  return (
    <div className="rounded-[24px] border border-white/[0.07] bg-white/[0.035] px-4 py-4">
      <MarkdownBlock content={content} />
      {author ? (
        <p className="mt-3 text-xs uppercase tracking-[0.14em] text-white/35">
          {author}
        </p>
      ) : null}
    </div>
  );
}

function NoteCardBlock({
  folder,
  title,
  content,
}: {
  folder?: string;
  title?: string;
  content: string;
}) {
  return (
    <div className="rounded-[24px] border border-white/[0.07] bg-white/[0.035] px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          {folder ? (
            <p className="text-[10px] uppercase tracking-[0.16em] text-cyan-300/70">
              {folder}
            </p>
          ) : null}
          {title ? (
            <p className="mt-1 text-sm font-medium text-white/90">{title}</p>
          ) : null}
        </div>
      </div>
      {content ? (
        <div className="mt-3">
          <MarkdownBlock content={content} />
        </div>
      ) : null}
    </div>
  );
}

function TaskListBlock({ title, items }: { title?: string; items: string[] }) {
  return (
    <div className="rounded-[24px] border border-white/[0.07] bg-white/[0.035] px-4 py-4">
      {title ? (
        <p className="mb-3 text-sm font-medium text-white/90">{title}</p>
      ) : null}
      <div className="space-y-2">
        {items.map((item) => (
          <div
            key={item}
            className="flex items-start gap-3 rounded-2xl bg-white/[0.03] px-3 py-2.5"
          >
            <div className="mt-1 size-2 rounded-full bg-cyan-300/80" />
            <p className="text-sm leading-6 text-white/80">{item}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function ChecklistBlock({
  title,
  items,
}: {
  title?: string;
  items: Array<{ label: string; checked: boolean }>;
}) {
  return (
    <div className="rounded-[24px] border border-white/[0.07] bg-white/[0.035] px-4 py-4">
      {title ? (
        <p className="mb-3 text-sm font-medium text-white/90">{title}</p>
      ) : null}
      <div className="space-y-2">
        {items.map((item) => (
          <div
            key={`${item.checked}-${item.label}`}
            className="flex items-start gap-3 rounded-2xl bg-white/[0.03] px-3 py-2.5"
          >
            <div
              className={`mt-0.5 flex size-4 items-center justify-center rounded border ${
                item.checked
                  ? "border-emerald-300/40 bg-emerald-300/18 text-emerald-200"
                  : "border-white/[0.14] bg-transparent text-transparent"
              }`}
            >
              ✓
            </div>
            <p
              className={`text-sm leading-6 ${item.checked ? "text-white/45 line-through" : "text-white/80"}`}
            >
              {item.label}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function NoteCollectionBlock({
  title,
  notes,
}: {
  title?: string;
  notes: Array<{ folder: string; title: string; summary?: string }>;
}) {
  return (
    <div className="rounded-[26px] border border-white/[0.07] bg-white/[0.03] px-4 py-4">
      {title ? (
        <p className="mb-4 text-sm font-medium text-white/90">{title}</p>
      ) : null}
      <div className="grid gap-3 md:grid-cols-2">
        {notes.map((note) => (
          <div
            key={`${note.folder}-${note.title}`}
            className="rounded-[22px] border border-white/[0.06] bg-white/[0.035] px-4 py-4"
          >
            <p className="text-[10px] uppercase tracking-[0.16em] text-cyan-300/70">
              {note.folder}
            </p>
            <p className="mt-2 text-sm font-medium text-white/88">
              {note.title}
            </p>
            {note.summary ? (
              <p className="mt-2 text-sm leading-6 text-white/58">
                {note.summary}
              </p>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

export function RichMessage({
  content,
  className = "",
}: {
  content: string;
  className?: string;
}) {
  const segments = buildSegments(content);

  return (
    <div className={`space-y-3 ${className}`.trim()}>
      {segments.map((segment, index) => {
        const segmentKey = `${segment.kind}-${index}-${
          "content" in segment
            ? segment.content
            : "title" in segment && segment.title
              ? segment.title
              : "items" in segment
                ? segment.items.length
                : "notes" in segment
                  ? segment.notes.length
                  : "segment"
        }`;

        switch (segment.kind) {
          case "markdown":
            return <MarkdownBlock key={segmentKey} content={segment.content} />;
          case "callout":
            return (
              <CalloutBlock
                key={segmentKey}
                title={segment.title}
                tone={segment.tone}
                content={segment.content}
              />
            );
          case "quote":
            return (
              <QuoteBlock
                key={segmentKey}
                author={segment.author}
                content={segment.content}
              />
            );
          case "noteCard":
            return (
              <NoteCardBlock
                key={segmentKey}
                folder={segment.folder}
                title={segment.title}
                content={segment.content}
              />
            );
          case "taskList":
            return (
              <TaskListBlock
                key={segmentKey}
                title={segment.title}
                items={segment.items}
              />
            );
          case "checklist":
            return (
              <ChecklistBlock
                key={segmentKey}
                title={segment.title}
                items={segment.items}
              />
            );
          case "noteCollection":
            return (
              <NoteCollectionBlock
                key={segmentKey}
                title={segment.title}
                notes={segment.notes}
              />
            );
          case "taskCollection":
            return (
              <TaskListBlock
                key={segmentKey}
                title={segment.title}
                items={segment.items}
              />
            );
          default:
            return null;
        }
      })}
    </div>
  );
}
