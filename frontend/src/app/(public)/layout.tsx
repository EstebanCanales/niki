import type { ReactNode } from "react";

export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[#060810] font-sans text-white">
      {children}
    </div>
  );
}
