export type RuntimeDiscoverCapability = {
  id: "x_search" | "video_generate";
  title: string;
  available: boolean;
  reason?: string;
};

export function projectDiscoverCapabilities(input: {
  xSearch: boolean;
  videoGenerate: boolean;
  profileLabel?: string;
}): RuntimeDiscoverCapability[] {
  const profileLabel = input.profileLabel?.trim() || "default";

  return [
    {
      id: "x_search",
      title: "X Search",
      available: input.xSearch,
      reason: input.xSearch ? undefined : `Unavailable for profile ${profileLabel}.`,
    },
    {
      id: "video_generate",
      title: "Video Generate",
      available: input.videoGenerate,
      reason: input.videoGenerate ? undefined : `Unavailable for profile ${profileLabel}.`,
    },
  ];
}
