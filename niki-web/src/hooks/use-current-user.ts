"use client";

import { useCallback, useEffect, useState } from "react";

import { CloudUser, getCurrentUser } from "@/lib/cloud-client";

interface CurrentUserState {
  user: CloudUser | null;
  isLoading: boolean;
  error: Error | null;
  reload: () => void;
}

export function useCurrentUser(): CurrentUserState {
  const [user, setUser] = useState<CloudUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [revision, setRevision] = useState(0);

  const reload = useCallback(() => setRevision((value) => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    setIsLoading(true);
    setError(null);

    void getCurrentUser(controller.signal)
      .then(setUser)
      .catch((requestError: unknown) => {
        if (!controller.signal.aborted) {
          setUser(null);
          setError(requestError instanceof Error ? requestError : new Error("Session request failed"));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      });

    return () => controller.abort();
  }, [revision]);

  return { user, isLoading, error, reload };
}
