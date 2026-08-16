"use client";

import { useState, useMemo, useEffect } from "react";
import { useChatStore } from "@/features/chat/stores/chat-store";
import { useUIStore } from "@/features/chat/stores/ui-store";
import { useProfiles } from "@/stores/use-profiles";
import { X, Info, Trash2, AlertCircle, ShieldAlert, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { ScrollArea } from "@/components/ui/scroll-area";
import AvatarWithBadge from "@/components/avatar-with-badge";
import { ChatAttachmentsPanel, ChatAttachmentsPreview } from "./chat-attachments";
import GroupInfoPanel from "./group-info-panel";
import type { Chat } from "@/features/chat/types/chat";

interface Props {
  chat: Chat;
  currentUserId: string | null;
}

export default function InfoPanel({ chat, currentUserId }: Props) {
  if (chat.isGroup) {
    return <GroupInfoPanel chat={chat} currentUserId={currentUserId} />;
  }

  return <DirectChatInfoPanel chat={chat} currentUserId={currentUserId} />;
}

function DirectChatInfoPanel({ chat, currentUserId }: Props) {
  const { setActiveChatContentPanel } = useUIStore();
  const { presenceMap, messages } = useChatStore();
  const profiles = useProfiles((s) => s.profiles);
  const missingProfiles = useProfiles((s) => s.missing);
  const [isClearing, setIsClearing] = useState(false);
  const [isGalleryOpen, setIsGalleryOpen] = useState(false);

  const otherUid = useMemo(() => {
    return chat.participants?.find((p) => p.id !== currentUserId)?.id || null;
  }, [chat.participants, currentUserId]);

  const profile = otherUid ? profiles.get(otherUid) : undefined;

  useEffect(() => {
    if (otherUid) {
      useProfiles.getState().ensureProfiles([otherUid]);
    }
  }, [otherUid]);

  const isOnline = !!(otherUid && presenceMap?.[otherUid]);
  const isProfilePending = !!otherUid && !profile && !missingProfiles.has(otherUid);
  const name = profile?.username || "Unknown";
  const avatar = profile?.avatar || "";


  const handleClearChat = async () => {
    setIsClearing(true);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    toast.success("Chat history cleared successfully!");
    setIsClearing(false);
    setActiveChatContentPanel("none");
  };

  if (isGalleryOpen) {
    return (
      <ChatAttachmentsPanel
        key={chat.id}
        chatId={chat.id}
        currentUserId={currentUserId}
        onBack={() => setIsGalleryOpen(false)}
        onClose={() => setActiveChatContentPanel("none")}
      />
    );
  }

  return (
    <div
      className="flex flex-col h-full bg-card select-none"
      role="complementary"
      aria-label="User info"
    >
      {/* Header */}
      <div className="h-14 px-4 flex items-center gap-1 border-b border-border bg-card shrink-0">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-foreground"
          onClick={() => setActiveChatContentPanel("none")}
          aria-label="Close info panel"
        >
          <X className="h-5 w-5" />
        </Button>
        <h3 className="font-semibold text-base">User info</h3>
      </div>

      {/* Scrollable content */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="flex flex-col items-center px-4 py-6 text-center bg-card">
          {isProfilePending ? (
            <div className="h-28 w-28 rounded-full bg-muted animate-pulse md:h-32 md:w-32" />
          ) : (
            <AvatarWithBadge
              name={name}
              src={avatar}
              isGroup={false}
              isOnline={isOnline}
              size="w-28 h-28 md:w-32 md:h-32 text-3xl md:text-4xl"
            />
          )}
          {isProfilePending ? (
            <div className="mt-4 h-6 w-36 rounded bg-muted animate-pulse" />
          ) : (
            <h2 className="mt-4 text-xl font-semibold text-foreground tracking-tight">{name}</h2>
          )}

          <div className="flex items-center gap-4 mt-4">
            <button
              type="button"
              className="flex flex-col items-center gap-1 text-muted-foreground hover:text-foreground cursor-pointer"
              onClick={() => setActiveChatContentPanel("search", "info")}
            >
              <div className="w-10 h-10 rounded-full bg-accent/50 flex items-center justify-center">
                <Search className="h-5 w-5" />
              </div>
              <span className="text-xs">Search</span>
            </button>
          </div>
        </div>

        <Separator className="bg-border/60" />

        {/* Details Section */}
        <div className="px-4 py-5 flex flex-col gap-6">
          {/* About / Status */}
          <div className="space-y-1.5">
            <span className="text-xs font-semibold text-muted-foreground tracking-wider uppercase">
              About
            </span>
            <div className="flex items-start gap-3 text-sm text-foreground">
              <Info className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
              <span>Can&apos;t talk, WhatsApp only</span>
            </div>
          </div>

          <Separator className="bg-border/40" />

          <ChatAttachmentsPreview
            messages={messages}
            onOpenGallery={() => setIsGalleryOpen(true)}
            className="px-0 py-0"
          />

          <Separator className="bg-border/40" />

          {/* Action List */}
          <div className="flex flex-col gap-1.5">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="ghost"
                  className="w-full justify-start text-destructive hover:text-destructive hover:bg-destructive/10 rounded-lg gap-3 px-3 h-10"
                >
                  <Trash2 className="h-4 w-4" />
                  <span className="font-medium">Clear chat</span>
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will clear all messages in this chat. This action is irreversible.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
                    onClick={handleClearChat}
                    disabled={isClearing}
                  >
                    {isClearing ? "Clearing..." : "Clear Chat"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            <Button
              variant="ghost"
              className="w-full justify-start text-muted-foreground hover:text-foreground hover:bg-accent/50 rounded-lg gap-3 px-3 h-10"
            >
              <AlertCircle className="h-4 w-4" />
              <span className="font-medium">Block {name}</span>
            </Button>
            <Button
              variant="ghost"
              className="w-full justify-start text-muted-foreground hover:text-foreground hover:bg-accent/50 rounded-lg gap-3 px-3 h-10"
            >
              <ShieldAlert className="h-4 w-4" />
              <span className="font-medium">Report {name}</span>
            </Button>
          </div>
        </div>
      </ScrollArea>

    </div>
  );
}
