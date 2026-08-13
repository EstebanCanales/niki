import { resolve } from "path";
import { existsSync, readFileSync } from "node:fs";

/**
 * Estado del agente de Niki: `app/backend/agent-home`, no el `~/.hermes` personal.
 */
function nikiAgentHome(): string {
  return (
    process.env.NIKI_AGENT_HOME?.trim() ||
    resolve(__dirname, "..", "..", "..", "agent-home")
  );
}

export type HermesMcpServerConfig = {
  id: string;
  name: string;
  enabled: boolean;
  command?: string;
  url?: string;
  transport?: string;
  authType?: string;
  supportsParallelToolCalls: boolean;
  resourcesEnabled: boolean;
  promptsEnabled: boolean;
  includeCount: number;
  excludeCount: number;
};

export type RuntimeMcpServer = {
  id: string;
  name: string;
  status: "ready" | "disabled" | "degraded";
  enabled: boolean;
  transport?: string;
  authType?: string;
  supportsParallelToolCalls: boolean;
  resourcesEnabled: boolean;
  promptsEnabled: boolean;
  includeCount: number;
  excludeCount: number;
  reason?: string;
};

export function readHermesMcpConfigRaw() {
  const filePath = process.env.HERMES_CONFIG_PATH?.trim() || `${nikiAgentHome()}/config.yaml`;
  if (!existsSync(filePath)) return "";
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

export function parseHermesMcpServers(raw: string): HermesMcpServerConfig[] {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const rootIndex = lines.findIndex((line) => line.trim() === "mcp_servers:");
  if (rootIndex < 0) return [];

  const servers: HermesMcpServerConfig[] = [];
  let index = rootIndex + 1;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }
    if (indentOf(line) <= 0) break;
    if (indentOf(line) !== 2 || !trimmed.endsWith(":")) {
      index += 1;
      continue;
    }

    const serverName = trimmed.slice(0, -1).trim();
    const blockStart = index + 1;
    let blockEnd = blockStart;
    while (blockEnd < lines.length) {
      const next = lines[blockEnd];
      const nextTrimmed = next.trim();
      if (!nextTrimmed) {
        blockEnd += 1;
        continue;
      }
      if (indentOf(next) <= 2) break;
      blockEnd += 1;
    }

    servers.push(parseServerBlock(serverName, lines.slice(blockStart, blockEnd)));
    index = blockEnd;
  }

  return servers;
}

export function projectRuntimeMcpServers(servers: HermesMcpServerConfig[]): RuntimeMcpServer[] {
  return servers
    .map((server) => {
      const missingConnection = !server.command && !server.url;
      const status: RuntimeMcpServer["status"] = !server.enabled
        ? "disabled"
        : missingConnection
          ? "degraded"
          : "ready";

      return {
        id: server.id,
        name: server.name,
        status,
        enabled: server.enabled,
        transport: server.transport,
        authType: server.authType,
        supportsParallelToolCalls: server.supportsParallelToolCalls,
        resourcesEnabled: server.resourcesEnabled,
        promptsEnabled: server.promptsEnabled,
        includeCount: server.includeCount,
        excludeCount: server.excludeCount,
        reason: !server.enabled
          ? "Disabled in Hermes config."
          : missingConnection
            ? "Missing command or url in Hermes config."
            : undefined,
      } satisfies RuntimeMcpServer;
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function toggleHermesMcpServerEnabled(raw: string, serverId: string, enabled: boolean) {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const rootIndex = lines.findIndex((line) => line.trim() === "mcp_servers:");
  if (rootIndex < 0) {
    throw new Error("Hermes config does not define mcp_servers.");
  }

  const targetHeader = `${serverId}:`;
  let index = rootIndex + 1;
  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed) {
      index += 1;
      continue;
    }
    if (indentOf(line) <= 0) break;
    if (indentOf(line) === 2 && trimmed === targetHeader) {
      const blockStart = index + 1;
      let blockEnd = blockStart;
      while (blockEnd < lines.length) {
        const next = lines[blockEnd];
        const nextTrimmed = next.trim();
        if (!nextTrimmed) {
          blockEnd += 1;
          continue;
        }
        if (indentOf(next) <= 2) break;
        blockEnd += 1;
      }

      const enabledIndex = lines.slice(blockStart, blockEnd).findIndex((entry) => entry.trim().startsWith("enabled:"));
      if (enabledIndex >= 0) {
        lines[blockStart + enabledIndex] = "    enabled: " + String(enabled);
      } else {
        lines.splice(blockStart, 0, "    enabled: " + String(enabled));
      }
      return lines.join("\n");
    }
    index += 1;
  }

  throw new Error(`Hermes MCP server ${serverId} was not found in config.`);
}

function parseServerBlock(name: string, lines: string[]): HermesMcpServerConfig {
  const server: HermesMcpServerConfig = {
    id: name,
    name,
    enabled: true,
    supportsParallelToolCalls: false,
    resourcesEnabled: true,
    promptsEnabled: true,
    includeCount: 0,
    excludeCount: 0,
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed || indentOf(line) < 4) continue;

    if (indentOf(line) === 4) {
      const parsed = keyValueFrom(trimmed);
      if (!parsed) continue;
      const { key, value } = parsed;

      switch (key) {
        case "enabled":
          server.enabled = parseBoolish(value, true);
          break;
        case "command":
          server.command = stripQuotes(value);
          break;
        case "url":
          server.url = stripQuotes(value);
          break;
        case "transport":
          server.transport = stripQuotes(value);
          break;
        case "auth":
          server.authType = stripQuotes(value);
          break;
        case "supports_parallel_tool_calls":
          server.supportsParallelToolCalls = parseBoolish(value, false);
          break;
        case "tools": {
          const toolBlock = collectNestedBlock(lines, index + 1, 6);
          applyToolsBlock(server, toolBlock.lines);
          index = toolBlock.nextIndex - 1;
          break;
        }
        default:
          break;
      }
    }
  }

  if (!server.transport) {
    server.transport = server.url ? "http" : server.command ? "stdio" : undefined;
  }

  return server;
}

function applyToolsBlock(server: HermesMcpServerConfig, lines: string[]) {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed || indentOf(line) < 6) continue;
    const parsed = keyValueFrom(trimmed);
    if (!parsed) continue;

    switch (parsed.key) {
      case "resources":
        server.resourcesEnabled = parseBoolish(parsed.value, true);
        break;
      case "prompts":
        server.promptsEnabled = parseBoolish(parsed.value, true);
        break;
      case "include": {
        const result = parseArrayCount(lines, index, 6);
        server.includeCount = result.count;
        index = result.nextIndex - 1;
        break;
      }
      case "exclude": {
        const result = parseArrayCount(lines, index, 6);
        server.excludeCount = result.count;
        index = result.nextIndex - 1;
        break;
      }
      default:
        break;
    }
  }
}

function parseArrayCount(lines: string[], index: number, indent: number) {
  const parsed = keyValueFrom(lines[index].trim());
  if (!parsed) return { count: 0, nextIndex: index + 1 };
  const inline = parsed.value.trim();
  if (inline.startsWith("[") && inline.endsWith("]")) {
    const count = inline
      .slice(1, -1)
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean).length;
    return { count, nextIndex: index + 1 };
  }

  let cursor = index + 1;
  let count = 0;
  while (cursor < lines.length) {
    const line = lines[cursor];
    const trimmed = line.trim();
    if (!trimmed) {
      cursor += 1;
      continue;
    }
    if (indentOf(line) <= indent) break;
    if (indentOf(line) === indent + 2 && trimmed.startsWith("- ")) {
      count += 1;
    }
    cursor += 1;
  }
  return { count, nextIndex: cursor };
}

function collectNestedBlock(lines: string[], start: number, indent: number) {
  let end = start;
  while (end < lines.length) {
    const line = lines[end];
    const trimmed = line.trim();
    if (!trimmed) {
      end += 1;
      continue;
    }
    if (indentOf(line) < indent) break;
    end += 1;
  }
  return { lines: lines.slice(start, end), nextIndex: end };
}

function keyValueFrom(line: string) {
  const separator = line.indexOf(":");
  if (separator < 0) return null;
  return {
    key: line.slice(0, separator).trim(),
    value: line.slice(separator + 1).trim(),
  };
}

function parseBoolish(value: string, fallback: boolean) {
  const normalized = stripQuotes(value).toLowerCase();
  if (!normalized) return fallback;
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function stripQuotes(value: string) {
  return value.replace(/^['"]|['"]$/g, "").trim();
}

function indentOf(line: string) {
  const match = line.match(/^ */);
  return match ? match[0].length : 0;
}
