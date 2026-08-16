"use client";

import { useAuth } from "@/features/auth";
import { usePathname, useRouter } from "next/navigation";
import { useState, useCallback, useEffect } from "react";
import AppWrapper from "./app-wrapper";
import { ChatList } from "@/features/chat";
import { cn } from "@/lib/utils";
import { auth } from "@/lib/firebase";
import { sendEmailVerification } from "firebase/auth";
import { toast } from "sonner";
import { X, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function MainLayout({ children }: { children: React.ReactNode }) {
  const { user, firebaseUser, isLoading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [verifyDismissed, setVerifyDismissed] = useState(false);
  const [isResending, setIsResending] = useState(false);

  // Redirect to sign-in when user logs out or session expires
  useEffect(() => {
    if (!user && !isLoading) {
      router.replace("/sign-in");
    }
  }, [user, isLoading, router]);

  // Listen for session expiry from api.ts (outside React)
  useEffect(() => {
    const handler = () => router.replace("/sign-in");
    window.addEventListener("auth:expired", handler);
    return () => window.removeEventListener("auth:expired", handler);
  }, [router]);

  // Skip email verification for Google provider (Google already verifies emails)
  const hasGoogleProvider = firebaseUser?.providerData.some(p => p.providerId === "google.com") ?? false;
  const isUnverified = firebaseUser && !firebaseUser.emailVerified && !hasGoogleProvider;

  const handleDismiss = useCallback(() => {
    setVerifyDismissed(true);
  }, []);

  const handleResend = useCallback(async () => {
    if (!auth?.currentUser) return;
    setIsResending(true);
    try {
      await sendEmailVerification(auth.currentUser);
      toast.success("Verification email sent!");
    } catch {
      toast.error("Failed to send verification email. Try again later.");
    } finally {
      setIsResending(false);
    }
  }, []);

  if (!user) return null;

  // On mobile: show chat list when on /chat, show chat body when on /chat/[chatId]
  const isChatSelected = pathname !== "/chat";

  return (
    <AppWrapper>
      {isUnverified && !verifyDismissed && (
        <div className="flex items-center gap-2 bg-amber-500/15 px-4 py-2 text-sm text-amber-900 dark:text-amber-200">
          <Mail className="h-4 w-4 shrink-0" />
          <span className="flex-1">Verify your email.</span>
          <Button
            variant="link"
            size="sm"
            className="h-auto p-0 text-amber-900 dark:text-amber-200"
            onClick={handleResend}
            disabled={isResending}
          >
            {isResending ? "Sending..." : "Resend"}
          </Button>
          <button onClick={handleDismiss} className="ml-2 rounded p-0.5 hover:bg-amber-500/20">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      {/* flex row: on mobile both children are w-full (200vw total), wrapper translates left to reveal content */}
      <div
        className={cn(
          "flex flex-1 min-h-0 transition-transform duration-300 ease-in-out",
          isChatSelected ? "-translate-x-full lg:translate-x-0" : "translate-x-0"
        )}
      >
        {/* Chat List Panel */}
        <div className="h-full w-full shrink-0 lg:w-[440px]">
          <ChatList />
        </div>

        {/* Chat Content Panel */}
        <div className="h-full w-full shrink-0 lg:w-[calc(100%-440px)]">
          {children}
        </div>
      </div>
    </AppWrapper>
  );
}
