import assert from "node:assert/strict";
import test from "node:test";

import { projectRuntimeProfiles } from "./runtime-profiles";

test("projectRuntimeProfiles deduplicates sessions into profile summaries", () => {
  const profiles = projectRuntimeProfiles([
    {
      id: "session-1",
      title: "Primary",
      profileId: "main",
      provider: "kimi-coding",
      model: "kimi-k2.5",
      resumable: true,
      canUndo: true,
      canHandoff: true,
      updatedAt: "2026-06-13T20:00:00.000Z",
    },
    {
      id: "session-2",
      title: "Secondary",
      profileId: "research",
      provider: "openrouter",
      model: "gpt-5",
      resumable: true,
      canUndo: true,
      canHandoff: false,
      updatedAt: "2026-06-13T21:00:00.000Z",
    },
    {
      id: "session-3",
      title: "Third",
      profileId: "main",
      provider: "kimi-coding",
      model: "kimi-k2.5",
      resumable: true,
      canUndo: false,
      canHandoff: false,
      updatedAt: "2026-06-13T22:00:00.000Z",
    },
  ]);

  assert.equal(profiles.length, 2);
  assert.equal(profiles[0]?.id, "main");
  assert.equal(profiles[0]?.sessionCount, 2);
  assert.equal(profiles[0]?.lastSeenAt, "2026-06-13T22:00:00.000Z");
  assert.deepEqual(profiles[0]?.providers, ["kimi-coding"]);
  assert.deepEqual(profiles[0]?.models, ["kimi-k2.5"]);
  assert.equal(profiles[1]?.id, "research");
});
