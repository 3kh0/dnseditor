"use client";

import { TooltipProvider } from "@cloudflare/kumo";
import { AuthProvider } from "@/lib/client/auth";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <TooltipProvider>
      <AuthProvider>{children}</AuthProvider>
    </TooltipProvider>
  );
}
