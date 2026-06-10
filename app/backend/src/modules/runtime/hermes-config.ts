export type HermesCompatibilityMode = "standard" | "hermes_agent";

export type HermesRuntimeConfigDefaults = {
  defaultApiServerUrl: string;
  defaultApiKey: string;
  defaultModel: string;
};

export type HermesRuntimeConfig = {
  apiServerUrl: string;
  apiKey: string;
  model: string;
  contextLengthOverride: number | null;
  compatibilityMode: HermesCompatibilityMode;
  diagnosticsEnabled: boolean;
};

export type HermesRuntimeConfigInput = HermesRuntimeConfig;

export function parseHermesRuntimeConfig(
  raw: string,
  defaults: HermesRuntimeConfigDefaults,
): HermesRuntimeConfig {
  const model = readBlockValue(raw, ["model"], "default") || defaults.defaultModel;
  const contextLengthOverride = parseOptionalNumber(readBlockValue(raw, ["model"], "context_length"));
  const apiServerUrl =
    readBlockValue(raw, ["niki", "runtime"], "api_server_url") || defaults.defaultApiServerUrl;
  const apiKey = readBlockValue(raw, ["niki", "runtime"], "api_key") || defaults.defaultApiKey;
  const compatibilityMode = normalizeCompatibilityMode(
    readBlockValue(raw, ["niki", "runtime"], "compatibility_mode"),
  );
  const diagnosticsEnabled = parseBoolean(
    readBlockValue(raw, ["niki", "runtime"], "diagnostics_enabled"),
  );

  return {
    apiServerUrl: apiServerUrl.trim().replace(/\/+$/, ""),
    apiKey: apiKey.trim(),
    model: model.trim(),
    contextLengthOverride,
    compatibilityMode,
    diagnosticsEnabled,
  };
}

export function serializeHermesRuntimeConfig(
  raw: string,
  config: HermesRuntimeConfigInput,
): string {
  const lines = normalizeLines(raw);

  upsertBlockValue(lines, ["model"], "default", config.model.trim());
  if (config.contextLengthOverride && config.contextLengthOverride > 0) {
    upsertBlockValue(lines, ["model"], "context_length", String(config.contextLengthOverride));
  } else {
    deleteBlockValue(lines, ["model"], "context_length");
  }

  upsertBlockValue(lines, ["niki", "runtime"], "api_server_url", config.apiServerUrl.trim().replace(/\/+$/, ""));
  upsertBlockValue(lines, ["niki", "runtime"], "api_key", config.apiKey.trim());
  upsertBlockValue(lines, ["niki", "runtime"], "compatibility_mode", config.compatibilityMode);
  upsertBlockValue(
    lines,
    ["niki", "runtime"],
    "diagnostics_enabled",
    config.diagnosticsEnabled ? "true" : "false",
  );

  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
}

function normalizeCompatibilityMode(value?: string | null): HermesCompatibilityMode {
  return value?.trim() === "hermes_agent" ? "hermes_agent" : "standard";
}

function parseOptionalNumber(value?: string | null): number | null {
  if (!value) return null;
  const numeric = Number(value.trim());
  return Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric) : null;
}

function parseBoolean(value?: string | null): boolean {
  return value?.trim().toLowerCase() === "true";
}

function normalizeLines(raw: string): string[] {
  const normalized = raw.replace(/\r\n/g, "\n").trimEnd();
  return normalized.length > 0 ? normalized.split("\n") : [];
}

function countIndent(line: string): number {
  const match = line.match(/^ */);
  return match ? match[0].length : 0;
}

function findBlock(
  lines: string[],
  start: number,
  end: number,
  indent: number,
  key: string,
): { headerIndex: number; endIndex: number } | null {
  const header = `${" ".repeat(indent)}${key}:`;
  for (let index = start; index < end; index += 1) {
    const line = lines[index];
    if (line.trim().length === 0) continue;
    if (line === header) {
      let blockEnd = end;
      for (let cursor = index + 1; cursor < end; cursor += 1) {
        const next = lines[cursor];
        if (next.trim().length === 0) continue;
        if (countIndent(next) <= indent) {
          blockEnd = cursor;
          break;
        }
      }
      return { headerIndex: index, endIndex: blockEnd };
    }
  }
  return null;
}

function ensureBlock(lines: string[], path: string[]): { start: number; end: number; indent: number } {
  let start = 0;
  let end = lines.length;
  let indent = 0;

  for (const key of path) {
    const existing = findBlock(lines, start, end, indent, key);
    if (existing) {
      start = existing.headerIndex + 1;
      end = existing.endIndex;
      indent += 2;
      continue;
    }

    const insertAt = end;
    const newLines = [`${" ".repeat(indent)}${key}:`];
    lines.splice(insertAt, 0, ...newLines);
    start = insertAt + 1;
    end = lines.length;
    indent += 2;
  }

  return { start, end, indent };
}

function upsertBlockValue(lines: string[], path: string[], key: string, value: string) {
  const block = ensureBlock(lines, path);
  const target = `${" ".repeat(block.indent)}${key}:`;

  for (let index = block.start; index < block.end; index += 1) {
    const line = lines[index];
    if (line.trim().length === 0) continue;
    if (countIndent(line) < block.indent) break;
    if (line.startsWith(target)) {
      lines[index] = `${target} ${value}`;
      return;
    }
  }

  lines.splice(block.end, 0, `${target} ${value}`);
}

function deleteBlockValue(lines: string[], path: string[], key: string) {
  const block = locateBlock(lines, path);
  if (!block) return;
  const target = `${" ".repeat(block.indent)}${key}:`;

  for (let index = block.start; index < block.end; index += 1) {
    const line = lines[index];
    if (line.startsWith(target)) {
      lines.splice(index, 1);
      return;
    }
  }
}

function locateBlock(lines: string[], path: string[]): { start: number; end: number; indent: number } | null {
  let start = 0;
  let end = lines.length;
  let indent = 0;

  for (const key of path) {
    const block = findBlock(lines, start, end, indent, key);
    if (!block) return null;
    start = block.headerIndex + 1;
    end = block.endIndex;
    indent += 2;
  }

  return { start, end, indent };
}

function readBlockValue(raw: string, path: string[], key: string): string | null {
  const lines = normalizeLines(raw);
  const block = locateBlock(lines, path);
  if (!block) return null;

  const target = `${" ".repeat(block.indent)}${key}:`;
  for (let index = block.start; index < block.end; index += 1) {
    const line = lines[index];
    if (line.startsWith(target)) {
      return line.slice(target.length).trim();
    }
  }
  return null;
}
