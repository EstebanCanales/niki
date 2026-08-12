import assert from "node:assert/strict";
import test from "node:test";

import { projectDiscoverCapabilities } from "./runtime-discover";

test("discover module can project available and unavailable capabilities by profile", () => {
  const projected = projectDiscoverCapabilities({
    xSearch: true,
    videoGenerate: false,
    profileLabel: "remote-codex",
  });

  assert.deepEqual(projected[0], {
    id: "x_search",
    title: "X Search",
    available: true,
    reason: undefined,
  });
  assert.deepEqual(projected[1], {
    id: "video_generate",
    title: "Video Generate",
    available: false,
    reason: "Unavailable for profile remote-codex.",
  });
});
