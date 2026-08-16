"use client";

import { useState, useEffect, useMemo } from "react";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/stores/chat-store";
import { useUIStore } from "@/stores/ui-store";
import { db } from "@/lib/firebase";
import {
  collection,
  onSnapshot,
} from "firebase/firestore";
import {
  X, Search, Pencil, UserPlus,
  Trash2, LogOut, ChevronDown, ShieldCheck, UserMinus, Camera, Check,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import AvatarWithBadge from "@/components/avatar-with-badge";
import { ChatAttachmentsPanel, ChatAttachmentsPreview } from "./chat-attachments";
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
import AddMemberDialog from "./add-member-dialog";
import { useProfiles } from "@/stores/use-profiles";
import type { ChatType } from "@/types";

interface MemberDoc {
  uid: string;
  role: string;
  joinedAt: unknown;
  leftAt: unknown;
  removedBy: string | null;
}

interface Props {
  chat: ChatType;
  currentUserId: string | null;
}

export default function GroupInfoPanel({ chat, currentUserId }: Props) {
  const { setActiveChatContentPanel } = useUIStore();
  const { messages } = useChatStore();
  const [members, setMembers] = useState<MemberDoc[]>([]);
  const [isClearing, setIsClearing] = useState(false);
  const [isGalleryOpen, setIsGalleryOpen] = useState(false);
  const [showAddMemberDialog, setShowAddMemberDialog] = useState(false);
  const [pendingActions, setPendingActions] = useState<Set<string>>(new Set());
  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState(chat.groupName || "");
  const [isRenaming, setIsRenaming] = useState(false);
  const [isUpdatingAvatar, setIsUpdatingAvatar] = useState(false);

  // Only show active members (not removed/left)
  const activeMembers = members.filter((m) => !m.leftAt);

  const isAdmin = activeMembers.some(
    (m) => m.uid === currentUserId && (m.role === "admin" || m.role === "creator")
  );

  // Listen to members subcollection
  useEffect(() => {
    if (!chat.id) return;
    const membersRef = collection(db!, "chats", chat.id, "members");
    const unsub = onSnapshot(membersRef, (snap) => {
      const docs: MemberDoc[] = [];
      snap.forEach((d) => {
        docs.push({ uid: d.id, ...d.data() } as MemberDoc);
      });
      setMembers(docs);
      // Fetch profiles for all members
      const uids = docs.filter((m) => !m.leftAt).map((m) => m.uid);
      if (uids.length > 0) {
        useProfiles.getState().ensureProfiles(uids);
      }
    });
    return unsub;
  }, [chat.id]);

  // Subscribe to profile store reactively
  const profilesMap = useProfiles((s) => s.profiles);

  const getProfile = (uid: string) => profilesMap.get(uid);

  const handleClearChat = async () => {
    setIsClearing(true);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    setIsClearing(false);
  };

  const existingMemberIds = useMemo(
    () => members.filter((m) => !m.leftAt).map((m) => m.uid),
    [members]
  );

  const handleRemoveMember = async (uid: string) => {
    setPendingActions((prev) => new Set(prev).add(`remove-${uid}`));
    try {
      const { removeGroupMember } = useChatStore.getState();
      await removeGroupMember(chat.id, uid);
    } catch (err) {
      console.error("Failed to remove member:", err);
    } finally {
      setPendingActions((prev) => {
        const next = new Set(prev);
        next.delete(`remove-${uid}`);
        return next;
      });
    }
  };

  const handlePromoteMember = async (uid: string) => {
    setPendingActions((prev) => new Set(prev).add(`promote-${uid}`));
    try {
      const { promoteGroupMember } = useChatStore.getState();
      await promoteGroupMember(chat.id, uid);
    } catch (err) {
      console.error("Failed to promote member:", err);
    } finally {
      setPendingActions((prev) => {
        const next = new Set(prev);
        next.delete(`promote-${uid}`);
        return next;
      });
    }
  };

  const handleDemoteMember = async (uid: string) => {
    setPendingActions((prev) => new Set(prev).add(`demote-${uid}`));
    try {
      const { demoteGroupMember } = useChatStore.getState();
      await demoteGroupMember(chat.id, uid);
    } catch (err) {
      console.error("Failed to demote member:", err);
    } finally {
      setPendingActions((prev) => {
        const next = new Set(prev);
        next.delete(`demote-${uid}`);
        return next;
      });
    }
  };

  const handleExitGroup = async () => {
    if (!currentUserId) return;
    try {
      const { leaveGroup } = useChatStore.getState();
      await leaveGroup(chat.id);
      setActiveChatContentPanel("none");
    } catch (err) {
      console.error("Failed to exit group:", err);
    }
  };

  const handleRenameGroup = async () => {
    const trimmed = editedName.trim();
    if (!trimmed || trimmed === chat.groupName) {
      setIsEditingName(false);
      return;
    }
    setIsRenaming(true);
    try {
      const { renameGroup } = useChatStore.getState();
      await renameGroup(chat.id, trimmed);
      setIsEditingName(false);
    } catch (err) {
      console.error("Failed to rename group:", err);
    } finally {
      setIsRenaming(false);
    }
  };

  const handleAvatarChange = async () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      setIsUpdatingAvatar(true);
      try {
        const { updateGroupAvatar } = useChatStore.getState();
        await updateGroupAvatar(chat.id, file);
      } catch (err) {
        console.error("Failed to update avatar:", err);
      } finally {
        setIsUpdatingAvatar(false);
      }
    };
    input.click();
  };

  // Format creation date
  const createdDate = chat.createdAt
    ? new Date(chat.createdAt).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    })
    : "Unknown";

  const creatorProfile = getProfile(chat.createdBy);
  const creatorName =
    chat.createdBy === currentUserId
      ? "You"
      : creatorProfile?.username || "Unknown";

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
    <div className="flex flex-col h-full bg-card select-none">
      {/* Header */}
      <div className="h-14 px-4 flex items-center gap-1 border-b border-border bg-card shrink-0">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-foreground"
          onClick={() => setActiveChatContentPanel("none")}
          aria-label="Close group info"
        >
          <X className="h-5 w-5" />
        </Button>
        <h3 className="font-semibold text-base">Group info</h3>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        {/* Group Profile Section */}
        <div className="flex flex-col items-center px-4 py-6 text-center">
          {/* Avatar with camera overlay */}
          <div className="relative group/avatar">
            <AvatarWithBadge
              name={chat.groupName}
              src={chat.groupAvatar}
              isGroup={true}
              size="w-28 h-28 md:w-32 md:h-32 text-3xl md:text-4xl"
            />
            {isAdmin && (
              <button
                type="button"
                onClick={() => !isUpdatingAvatar && handleAvatarChange()}
                disabled={isUpdatingAvatar}
                className={cn(
                  "absolute inset-0 flex items-center justify-center rounded-full bg-black/40 transition-opacity cursor-pointer disabled:cursor-not-allowed",
                  isUpdatingAvatar ? "opacity-100" : "opacity-0 group-hover/avatar:opacity-100"
                )}
                aria-label="Change group avatar"
              >
                {isUpdatingAvatar ? (
                  <div className="h-6 w-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Camera className="h-6 w-6 text-white" />
                )}
              </button>
            )}
          </div>

          {/* Group name: inline editable */}
          {isEditingName ? (
            <div className="mt-4 flex items-center gap-2 w-full max-w-[240px]">
              <Input
                value={editedName}
                onChange={(e) => setEditedName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleRenameGroup();
                  if (e.key === "Escape") {
                    setEditedName(chat.groupName || "");
                    setIsEditingName(false);
                  }
                }}
                disabled={isRenaming}
                autoFocus
                className="h-8 text-sm text-center"
                placeholder="Group name"
              />
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 shrink-0"
                onClick={handleRenameGroup}
                disabled={isRenaming}
                aria-label="Save group name"
              >
                {isRenaming ? (
                  <div className="h-4 w-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Check className="h-4 w-4" />
                )}
              </Button>
            </div>
          ) : (
            <div className="mt-4 w-full flex items-center justify-between px-1">
              <div className="w-7" />
              <h2 className="text-xl font-semibold text-foreground tracking-tight">
                {chat.groupName}
              </h2>
              {isAdmin ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    setEditedName(chat.groupName || "");
                    setIsEditingName(true);
                  }}
                  aria-label="Edit group name"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
              ) : (
                <div className="w-7" />
              )}
            </div>
          )}
          <p className="text-sm text-muted-foreground mt-1">
            Group · {activeMembers.length} members
          </p>

          {/* Quick actions */}
          <div className="flex items-center gap-4 mt-4">
            {isAdmin && (
              <button
                type="button"
                className="flex flex-col items-center gap-1 text-muted-foreground hover:text-foreground cursor-pointer"
                onClick={() => setShowAddMemberDialog(true)}
              >
                <div className="w-10 h-10 rounded-full bg-accent/50 flex items-center justify-center">
                  <UserPlus className="h-5 w-5" />
                </div>
                <span className="text-xs">Add</span>
              </button>
            )}
            <button
              type="button"
              className="flex flex-col items-center gap-1 text-muted-foreground hover:text-foreground cursor-pointer"
              onClick={() => setActiveChatContentPanel("search", "groupInfo")}
            >
              <div className="w-10 h-10 rounded-full bg-accent/50 flex items-center justify-center">
                <Search className="h-5 w-5" />
              </div>
              <span className="text-xs">Search</span>
            </button>
          </div>
        </div>

        <Separator className="bg-border/60" />

        {/* Description */}
        <div className="px-4 py-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground tracking-wider uppercase">
              Description
            </span>
            {isAdmin && (
              <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground">
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-2">
            No description yet.
          </p>
        </div>

        <Separator className="bg-border/40" />

        <ChatAttachmentsPreview messages={messages} onOpenGallery={() => setIsGalleryOpen(true)} />

        <Separator className="bg-border/40" />

        {/* Members Section */}
        <div className="px-4 py-5 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground tracking-wider uppercase">
              {activeMembers.length} members
            </span>
          </div>

          <div className="space-y-1">
            {activeMembers.map((member) => {
              const profile = getProfile(member.uid);
              const isSelf = member.uid === currentUserId;
              const isMemberAdmin =
                member.role === "admin" || member.role === "creator";
              const canAdminister =
                isAdmin && !isSelf && member.role !== "creator";

              return (
                <div
                  key={member.uid}
                  className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-accent/30 transition-colors"
                >
                  <AvatarWithBadge
                    name={profile?.username || "Unknown"}
                    src={profile?.avatar}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium truncate">
                        {isSelf ? "You" : profile?.username || "Unknown"}
                      </p>
                      {isMemberAdmin && (
                        <span className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-primary/10 text-primary">
                          <ShieldCheck className="h-3 w-3" />
                          {member.role === "creator" ? "Creator" : "Admin"}
                        </span>
                      )}
                    </div>
                    {profile?.email && (
                      <p className="text-xs text-muted-foreground truncate">
                        {profile.email}
                      </p>
                    )}
                  </div>
                  {canAdminister && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground shrink-0"
                          disabled={pendingActions.has(`remove-${member.uid}`) || pendingActions.has(`promote-${member.uid}`) || pendingActions.has(`demote-${member.uid}`)}
                        >
                          <ChevronDown className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent className="w-[250px]" align="end">
                        {member.role === "admin" ? (
                          <DropdownMenuItem
                            onClick={() => handleDemoteMember(member.uid)}
                            disabled={pendingActions.has(`demote-${member.uid}`)}
                          >
                            <ShieldCheck className="h-4 w-4 mr-2" />
                            {pendingActions.has(`demote-${member.uid}`) ? "Demoting..." : "Remove as admin"}
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem
                            onClick={() => handlePromoteMember(member.uid)}
                            disabled={pendingActions.has(`promote-${member.uid}`)}
                          >
                            <ShieldCheck className="h-4 w-4 mr-2" />
                            {pendingActions.has(`promote-${member.uid}`) ? "Promoting..." : "Make group admin"}
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem
                          onClick={() => handleRemoveMember(member.uid)}
                          disabled={pendingActions.has(`remove-${member.uid}`)}
                          className="text-destructive focus:text-destructive"
                        >
                          <UserMinus className="h-4 w-4 mr-2" />
                          {pendingActions.has(`remove-${member.uid}`) ? "Removing..." : "Remove"}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <Separator className="bg-border/40" />

        {/* Danger Actions */}
        <div className="px-4 py-5 flex flex-col gap-1.5">
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

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost"
                className="w-full justify-start text-destructive hover:text-destructive hover:bg-destructive/10 rounded-lg gap-3 px-3 h-10"
              >
                <LogOut className="h-4 w-4" />
                <span className="font-medium">Exit group</span>
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Exit group?</AlertDialogTitle>
                <AlertDialogDescription>
                  You will stop receiving messages from this group. You can only rejoin if an admin adds you back.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
                  onClick={handleExitGroup}
                >
                  Exit Group
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>

        {/* Footer: creation info */}
        <div className="px-4 py-4 text-center">
          <p className="text-xs text-muted-foreground">
            Created by {creatorName}, {createdDate}
          </p>
        </div>
      </ScrollArea>

      {/* Add Member Dialog - extracted component, renders as center modal */}
      <AddMemberDialog
        open={showAddMemberDialog}
        onOpenChange={setShowAddMemberDialog}
        chatId={chat.id}
        existingMemberIds={existingMemberIds}
        isAdmin={isAdmin}
      />
    </div>
  );
}
