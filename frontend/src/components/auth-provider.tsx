"use client";

import { useEffect } from "react";
import { useAuth } from "@/stores/use-auth";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { isLoading, initAuth } = useAuth();

  useEffect(() => {
    const unsubscribe = initAuth();
    return unsubscribe;
  }, [initAuth]);

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return <>{children}</>;
}
