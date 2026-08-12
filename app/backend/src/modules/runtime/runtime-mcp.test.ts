import assert from "node:assert/strict";
import test from "node:test";

import { parseHermesMcpServers, projectRuntimeMcpServers, toggleHermesMcpServerEnabled } from "./runtime-mcp";

test("parseHermesMcpServers reads MCP server inventory from Hermes config", () => {
  const raw = `
model:
  default: kimi-k2.5
mcp_servers:
  github:
    enabled: true
    command: npx
    transport: stdio
    auth: oauth
    supports_parallel_tool_calls: true
    tools:
      resources: false
      prompts: true
      include:
        - create_issue
        - list_prs
  remote-browser:
    enabled: false
    url: https://browser.example.com/mcp
    transport: sse
    tools:
      exclude: [dangerous_action]
`;

  const parsed = parseHermesMcpServers(raw);
  assert.equal(parsed.length, 2);
  assert.deepEqual(parsed[0], {
    id: "github",
    name: "github",
    enabled: true,
    command: "npx",
    transport: "stdio",
    authType: "oauth",
    supportsParallelToolCalls: true,
    resourcesEnabled: false,
    promptsEnabled: true,
    includeCount: 2,
    excludeCount: 0,
  });
  assert.equal(parsed[1].id, "remote-browser");
  assert.equal(parsed[1].enabled, false);
  assert.equal(parsed[1].url, "https://browser.example.com/mcp");
  assert.equal(parsed[1].excludeCount, 1);
});

test("projectRuntimeMcpServers marks ready, disabled, and degraded servers", () => {
  const projected = projectRuntimeMcpServers([
    {
      id: "github",
      name: "github",
      enabled: true,
      command: "npx",
      transport: "stdio",
      authType: "oauth",
      supportsParallelToolCalls: true,
      resourcesEnabled: true,
      promptsEnabled: true,
      includeCount: 0,
      excludeCount: 0,
    },
    {
      id: "disabled",
      name: "disabled",
      enabled: false,
      transport: "sse",
      supportsParallelToolCalls: false,
      resourcesEnabled: true,
      promptsEnabled: true,
      includeCount: 0,
      excludeCount: 0,
    },
    {
      id: "broken",
      name: "broken",
      enabled: true,
      supportsParallelToolCalls: false,
      resourcesEnabled: true,
      promptsEnabled: true,
      includeCount: 0,
      excludeCount: 0,
    },
  ]);

  assert.equal(projected[2].status, "ready");
  assert.equal(projected[1].status, "disabled");
  assert.equal(projected[0].status, "degraded");
  assert.match(projected[0].reason ?? "", /Missing command or url/);
});

test("toggleHermesMcpServerEnabled updates the enabled flag for a named server", () => {
  const raw = `
mcp_servers:
  github:
    enabled: true
    command: npx
  remote-browser:
    enabled: false
    url: https://browser.example.com/mcp
`;

  const toggled = toggleHermesMcpServerEnabled(raw, "github", false);
  assert.match(toggled, /github:\n    enabled: false\n    command: npx/);
});
