"use client";

import { Toaster as Sonner } from "sonner";

export function Toaster() {
  return (
    <Sonner
      position="bottom-right"
      richColors
      toastOptions={{
        classNames: {
          toast: "bg-background text-foreground border-border shadow-lg",
        },
      }}
    />
  );
}
