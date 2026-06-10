import test from "node:test";
import assert from "node:assert/strict";

import {
  parseHermesRuntimeConfig,
  serializeHermesRuntimeConfig,
  type HermesRuntimeConfigInput,
} from "./hermes-config";

const SAMPLE_CONFIG = `model:
  default: kimi-k2.5
  provider: kimi-coding
  base_url: https://api.kimi.com/coding
  context_length: 256000
toolsets:
- hermes-cli
approvals:
  mode: manual
`;

test("parseHermesRuntimeConfig reads model settings and env fallbacks", () => {
  const config = parseHermesRuntimeConfig(SAMPLE_CONFIG, {
    defaultApiServerUrl: "http://127.0.0.1:8642",
    defaultApiKey: "env-key",
    defaultModel: "Hermes-4-70B",
  });

  assert.equal(config.apiServerUrl, "http://127.0.0.1:8642");
  assert.equal(config.apiKey, "env-key");
  assert.equal(config.model, "kimi-k2.5");
  assert.equal(config.contextLengthOverride, 256000);
  assert.equal(config.compatibilityMode, "standard");
  assert.equal(config.diagnosticsEnabled, false);
});

test("parseHermesRuntimeConfig prefers niki runtime overrides from config", () => {
  const raw = `${SAMPLE_CONFIG}
niki:
  runtime:
    api_server_url: http://127.0.0.1:9999
    api_key: local-key
    compatibility_mode: hermes_agent
    diagnostics_enabled: true
`;

  const config = parseHermesRuntimeConfig(raw, {
    defaultApiServerUrl: "http://127.0.0.1:8642",
    defaultApiKey: "env-key",
    defaultModel: "Hermes-4-70B",
  });

  assert.equal(config.apiServerUrl, "http://127.0.0.1:9999");
  assert.equal(config.apiKey, "local-key");
  assert.equal(config.compatibilityMode, "hermes_agent");
  assert.equal(config.diagnosticsEnabled, true);
});

test("serializeHermesRuntimeConfig updates model and writes niki runtime namespace", () => {
  const next = serializeHermesRuntimeConfig(
    SAMPLE_CONFIG,
    {
      apiServerUrl: "http://127.0.0.1:9000",
      apiKey: "new-key",
      model: "kimi-k2.6",
      contextLengthOverride: 128000,
      compatibilityMode: "hermes_agent",
      diagnosticsEnabled: true,
    } satisfies HermesRuntimeConfigInput,
  );

  assert.match(next, /default:\s*kimi-k2\.6/);
  assert.match(next, /context_length:\s*128000/);
  assert.match(next, /niki:\n  runtime:\n    api_server_url: http:\/\/127\.0\.0\.1:9000/);
  assert.match(next, /api_key: new-key/);
  assert.match(next, /compatibility_mode: hermes_agent/);
  assert.match(next, /diagnostics_enabled: true/);
});
