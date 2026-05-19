"use client";

import { LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect } from "react";

import { AppShell } from "@/components/layout/app-shell";
import { useWorkspaceStore } from "@/stores/use-workspace-store";

export default function PrivateLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const hasHydrated = useWorkspaceStore((s) => s._hasHydrated);
  const backendBaseUrl = useWorkspaceStore((s) => s.backendBaseUrl);
  const accessToken = useWorkspaceStore((s) => s.accessToken);

  useEffect(() => {
    if (!hasHydrated) return;
    if (!accessToken) {
      router.replace("/login");
    }
  }, [hasHydrated, backendBaseUrl, accessToken, router]);

  if (!hasHydrated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#060810]">
        <LoaderCircle className="h-6 w-6 animate-spin text-white/30" />
      </div>
    );
  }

  return <AppShell>{children}</AppShell>;
}
