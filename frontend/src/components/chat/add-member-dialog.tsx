"use client";

import { useState, useRef, useEffect, useCallback, startTransition } from "react";
import { useChatStore } from "@/stores/chat-store";
import { useProfiles } from "@/stores/use-profiles";
import { X, Search, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import AvatarWithBadge from "@/components/avatar-with-badge";
import type { User } from "@/types/user";

interface AddMemberDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  chatId: string;
  existingMemberIds: string[];
  isAdmin: boolean;
  onMembersAdded?: () => void;
}

export default function AddMemberDialog({
  open,
  onOpenChange,
  chatId,
  existingMemberIds,
  isAdmin,
  onMembersAdded,
}: AddMemberDialogProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const existingMemberIdsRef = useRef(existingMemberIds);
  existingMemberIdsRef.current = existingMemberIds;
  const { searchUsers, getAllUsers, addGroupMembers } = useChatStore();

  useEffect(() => {
    if (!open) return;
    const memberIds = existingMemberIdsRef.current;
    startTransition(() => setIsLoading(true));
    getAllUsers().then((all) => {
      const filtered = all.filter((u) => !memberIds.includes(u.id));
      startTransition(() => {
        setUsers(filtered);
        setIsLoading(false);
      });
      if (all.length > 0) {
        useProfiles.getState().ensureProfiles(all.map((u) => u.id));
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, getAllUsers]);

  const displayUsers = useCallback(() => {
    if (!searchQuery.trim()) return users;
    const q = searchQuery.toLowerCase();
    return users.filter(
      (u) =>
        u.username.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q)
    );
  }, [users, searchQuery]);

  const handleSearch = useCallback(
    (query: string) => {
      setSearchQuery(query);
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
      if (!query.trim()) return;
      searchTimeoutRef.current = setTimeout(async () => {
        const results = await searchUsers(query);
        const filtered = results.filter((u) => !existingMemberIds.includes(u.id));
        if (filtered.length > 0) {
          useProfiles.getState().ensureProfiles(filtered.map((u) => u.id));
          setUsers((prev) => {
            const existingIds = new Set(prev.map((u) => u.id));
            const newUsers = filtered.filter((u) => !existingIds.has(u.id));
            return newUsers.length > 0 ? [...prev, ...newUsers] : prev;
          });
        }
      }, 300);
    },
    [searchUsers, existingMemberIds]
  );

  const toggleMember = (uid: string) => {
    setSelectedIds((prev) =>
      prev.includes(uid) ? prev.filter((id) => id !== uid) : [...prev, uid]
    );
  };

  const handleConfirm = async () => {
    if (selectedIds.length === 0 || !isAdmin) return;
    setIsSubmitting(true);
    try {
      await addGroupMembers(chatId, selectedIds);
      setSelectedIds([]);
      setSearchQuery("");
      onOpenChange(false);
      onMembersAdded?.();
    } catch (err) {
      console.error("Failed to add members:", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setSelectedIds([]);
    setSearchQuery("");
    onOpenChange(false);
  };

  const filteredContacts = displayUsers();

  return (
    <Dialog open={open} onOpenChange={isSubmitting ? undefined : handleClose}>
      <DialogContent className="dialog-no-slide p-0 gap-0 max-w-md h-[80vh] flex flex-col overflow-hidden md:rounded-xl rounded-none">
        <DialogTitle className="sr-only">Add member</DialogTitle>
      
        <div className="h-14 px-4 flex items-center gap-2 border-b border-border shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
            onClick={handleClose}
            disabled={isSubmitting}
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </Button>
          <h3 className="font-semibold text-base">Add member</h3>
        </div>

        <div className="flex-1 min-h-0 flex flex-col relative">
          {isSubmitting && (
            <div className="absolute inset-0 z-10 bg-background/60 backdrop-blur-[1px] flex items-center justify-center">
              <Spinner className="h-8 w-8" />
            </div>
          )}

          <div className="px-4 py-3 shrink-0">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search name"
                className="pl-9"
                value={searchQuery}
                onChange={(e) => handleSearch(e.target.value)}
                disabled={isSubmitting}
              />
            </div>
          </div>

          <div
            className="overflow-hidden transition-all duration-200 ease-in-out shrink-0"
            style={{
              maxHeight: selectedIds.length > 0 ? "6rem" : "0rem",
              opacity: selectedIds.length > 0 ? 1 : 0,
            }}
          >
            {selectedIds.length > 0 && (
              <div className="px-4 py-2 flex flex-wrap gap-2 border-b border-border">
                {selectedIds.map((uid) => {
                  const profile = useProfiles.getState().getProfile(uid) || users.find((u) => u.id === uid);
                  return (
                    <button
                      key={uid}
                      type="button"
                      className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-primary/10 text-primary text-sm cursor-pointer"
                      onClick={() => toggleMember(uid)}
                      disabled={isSubmitting}
                    >
                      <span className="truncate max-w-[120px]">
                        {profile?.username || "Unknown"}
                      </span>
                      <X className="h-3.5 w-3.5 shrink-0" />
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <ScrollArea className="flex-1 min-h-0">
            {isLoading ? (
              <div className="flex justify-center py-8">
                <Spinner className="h-6 w-6" />
              </div>
            ) : (
              <div className="px-4 py-2">
                <p className="text-xs font-semibold text-muted-foreground tracking-wider uppercase mb-2">
                  Contacts
                </p>
                {filteredContacts.map((user) => {
                  const isSelected = selectedIds.includes(user.id);
                  const profile = useProfiles.getState().getProfile(user.id);
                  const displayName = profile?.username || user.username;
                  const displayAvatar = profile?.avatar || user.avatar;
                  return (
                    <button
                      key={user.id}
                      type="button"
                      className="w-full flex items-center gap-3 px-2 py-2.5 rounded-lg hover:bg-accent/50 transition-colors cursor-pointer disabled:cursor-default disabled:opacity-50"
                      onClick={() => toggleMember(user.id)}
                      disabled={isSubmitting}
                    >
                      <div
                        className={cn(
                          "w-5 h-5 rounded border-2 shrink-0 flex items-center justify-center transition-colors",
                          isSelected
                            ? "bg-primary border-primary"
                            : "border-border"
                        )}
                      >
                        {isSelected && (
                          <svg className="w-3 h-3 text-primary-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </div>
                      <AvatarWithBadge
                        name={displayName}
                        src={displayAvatar}
                        size="w-10 h-10"
                      />
                      <span className="text-sm font-medium truncate">
                        {displayName}
                      </span>
                    </button>
                  );
                })}
                {filteredContacts.length === 0 && !isLoading && (
                  <div className="text-center py-12">
                    <UserPlus className="h-8 w-8 text-muted-foreground/40 mx-auto mb-3" />
                    <p className="text-sm text-muted-foreground">
                      {searchQuery ? "No contacts found" : "No contacts available"}
                    </p>
                  </div>
                )}
              </div>
            )}
          </ScrollArea>
        </div>

        {!isAdmin && (
          <p className="text-xs text-muted-foreground text-center px-4 py-2 border-t border-border shrink-0">
            Only admins are able to add others to this group
          </p>
        )}

        <div
          className="shrink-0 overflow-hidden transition-all duration-300 ease-in-out"
          style={{
            maxHeight: selectedIds.length > 0 && isAdmin ? "4.5rem" : "0rem",
            opacity: selectedIds.length > 0 && isAdmin ? 1 : 0,
          }}
        >
          <div className="px-4 py-3 border-t border-border bg-card flex items-center justify-between">
            <span className="text-sm text-muted-foreground">
              {selectedIds.length} member{selectedIds.length !== 1 ? "s" : ""} selected
            </span>
            <Button
              size="sm"
              onClick={handleConfirm}
              disabled={isSubmitting}
              className="rounded-full px-5"
            >
              {isSubmitting ? "Adding..." : "Add"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
