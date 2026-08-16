"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useChatStore } from "@/features/chat/stores/chat-store";
import { ContactSearchUnavailableError, useUserDirectory } from "@/features/chat/stores/user-directory-store";
import { useProfiles } from "@/stores/use-profiles";
import { useUIStore } from "@/features/chat/stores/ui-store";
import { useAuth } from "@/features/auth";
import { X, ArrowLeft, Users, MessageSquarePlus, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import AvatarWithBadge from "@/components/avatar-with-badge";
import { toast } from "sonner";
import type { User } from "@/types/user";

type PanelView = "default" | "groupMembers" | "groupInfo";

export default function NewChatPanel() {
  const { user } = useAuth();
  const currentUserId = user?.id || null;
  const { createChat, updateGroupAvatar } = useChatStore();
	const { users: allUsers, hasMore, isLoading: isLoadingUsers, error: directoryError, reset: resetDirectory, loadNextPage, search: searchDirectory } = useUserDirectory();
  const { setActiveChatListPanel } = useUIStore();

  const [view, setView] = useState<PanelView>("default");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<User[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedMembers, setSelectedMembers] = useState<User[]>([]);
  const [groupName, setGroupName] = useState("");
  const [groupAvatarFile, setGroupAvatarFile] = useState<File | null>(null);
  const [groupAvatarPreview, setGroupAvatarPreview] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!currentUserId) return;
		resetDirectory();
		void loadNextPage(currentUserId);
	}, [currentUserId, loadNextPage, resetDirectory]);

  // Debounced API search for default view (finding new users)
  const handleSearch = useCallback(
    (query: string) => {
      setSearchQuery(query);
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
      if (!query.trim()) {
        setSearchResults([]);
        return;
      }
      searchTimeoutRef.current = setTimeout(async () => {
        setIsSearching(true);
		try {
			setSearchResults(await searchDirectory(query, currentUserId || ""));
		} catch (error) {
			if (error instanceof ContactSearchUnavailableError) toast.error(error.message);
			setSearchResults([]);
		}
        setIsSearching(false);
      }, 300);
    },
		[currentUserId, searchDirectory]
  );

  // Local filter for groupMembers view (filter existing contacts only)
  const handleGroupMemberSearch = useCallback((query: string) => {
    setSearchQuery(query);
    setSearchResults([]);
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
  }, []);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    };
  }, []);

  const handleClose = () => {
    setView("default");
    setSearchQuery("");
    setSearchResults([]);
    setSelectedMembers([]);
    setGroupName("");
    setGroupAvatarFile(null);
    setGroupAvatarPreview(null);
    setActiveChatListPanel("chatList");
  };

  const handleNewGroup = () => {
    setView("groupMembers");
    setSearchQuery("");
    setSearchResults([]);
    setSelectedMembers([]);
    setIsSearching(false);
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
  };

  const toggleMember = (u: User) => {
    setSelectedMembers((prev) =>
      prev.find((m) => m.id === u.id)
        ? prev.filter((m) => m.id !== u.id)
        : [...prev, u]
    );
  };

  const handleGroupMembersNext = () => {
    if (selectedMembers.length === 0) return;
    setView("groupInfo");
  };

  const handleAvatarSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setGroupAvatarFile(file);
    const reader = new FileReader();
    reader.onload = () => setGroupAvatarPreview(reader.result as string);
    reader.readAsDataURL(file);
  };

  const handleCreateGroup = async () => {
    if (selectedMembers.length === 0) return;
    setIsCreating(true);
    try {
      const participantIds = selectedMembers.map((m) => m.id);
      const chat = await createChat({
        isGroup: true,
        participants: participantIds,
        groupName: groupName || undefined,
      });
      if (!chat) {
        toast.error("Failed to create group");
        return;
      }

      if (groupAvatarFile) {
        try {
          await updateGroupAvatar(chat.id, groupAvatarFile);
        } catch (error) {
          // The chat is already authoritative, so an avatar failure must not make
          // the user retry creation and accidentally create a duplicate group.
          console.error("Group created without its avatar:", error);
          toast.warning("Group created, but the avatar could not be uploaded");
          handleClose();
          return;
        }
      }

      toast.success("Group created successfully");
      handleClose();
    } catch (err) {
      console.error("Failed to create group:", err);
      toast.error("Failed to create group");
    } finally {
      setIsCreating(false);
    }
  };

  const handleCreateDirectChat = async (otherUser: User) => {
    if (!currentUserId) return;
    setIsCreating(true);
    try {
      const chat = await createChat({
        participantId: otherUser.id,
      });
      if (chat) {
        handleClose();
      } else {
        toast.error("Failed to create chat");
      }
    } catch (err) {
      console.error("Failed to create chat:", err);
      toast.error("Failed to create chat");
    } finally {
      setIsCreating(false);
    }
  };

  // ── Default View ──
  if (view === "default") {
    return (
      <div className="flex flex-col h-full bg-card">
        {/* Header */}
        <div className="h-14 px-1 flex items-center justify-start border-b border-border shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
            onClick={handleClose}
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </Button>
          <h3 className="font-semibold text-base">New chat</h3>
          <div className="w-8" />
        </div>

        {/* Search */}
        <div className="px-4 py-3 shrink-0">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search name or number"
              className="pl-9"
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
            />
          </div>
        </div>

        {/* Action buttons */}
        <div className="px-1 pb-2 shrink-0">
          <Button
            variant="ghost"
            className="w-full justify-start gap-3 px-3 h-12 text-foreground hover:bg-accent/50"
            onClick={handleNewGroup}
          >
            <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary text-primary-foreground">
              <Users className="h-4 w-4" />
            </div>
            <span className="font-medium">New group</span>
          </Button>
        </div>

        {/* Search results or existing contacts */}
        <ScrollArea className="flex-1 min-h-0">
          {isSearching && (
            <div className="flex justify-center py-4">
              <Spinner className="w-6 h-6" />
            </div>
          )}
          {searchQuery ? (
            <>
              {searchResults.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-accent/50 transition-colors disabled:opacity-50 disabled:pointer-events-none"
                  onClick={() => handleCreateDirectChat(u)}
                  disabled={isCreating}
                >
                  <AvatarWithBadge name={u.username} src={u.avatar} />
                  <div className="text-left min-w-0">
                    <p className="font-medium text-sm truncate">{u.username}</p>
                  </div>
                </button>
              ))}
              {!isSearching && searchResults.length === 0 && (
                <p className="text-center text-sm text-muted-foreground py-8">No users found</p>
              )}
            </>
          ) : (
            <>
              {isLoadingUsers ? (
                <div className="flex justify-center py-8">
                  <Spinner className="h-6 w-6" />
                </div>
              ) : (
                Array.from(allUsers.entries()).map(([uid, user]) => {
                  const profile = useProfiles.getState().getProfile(uid);
                  const displayName = profile?.username || user.username;
                  const displayAvatar = profile?.avatar || user.avatar;
                  return (
                    <button
                      key={uid}
                      type="button"
                      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-accent/50 transition-colors disabled:opacity-50 disabled:pointer-events-none"
					  onClick={() => handleCreateDirectChat({ id: uid, username: displayName, avatar: displayAvatar })}
                      disabled={isCreating}
                    >
                      <AvatarWithBadge name={displayName} src={displayAvatar} />
                      <div className="text-left min-w-0">
                        <p className="font-medium text-sm truncate">{displayName}</p>
                      </div>
                    </button>
                  );
                })
              )}
			  {!isLoadingUsers && allUsers.size === 0 && (
				<p className="text-center text-sm text-muted-foreground py-8">No contacts yet</p>
			  )}
			  {directoryError && <p className="text-center text-sm text-destructive py-4">{directoryError}</p>}
			  {hasMore && !isLoadingUsers && currentUserId && (
				<Button variant="ghost" className="w-full" onClick={() => void loadNextPage(currentUserId)}>Load more contacts</Button>
			  )}
            </>
          )}
        </ScrollArea>
      </div>
    );
  }

  // ── Group Members View ──
  if (view === "groupMembers") {
    return (
      <div className="flex flex-col h-full bg-card">
        {/* Header */}
        <div className="h-14 px-1 flex items-center justify-start border-b border-border shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
            onClick={() => { setView("default"); setSelectedMembers([]); }}
            aria-label="Back"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h3 className="font-semibold text-base">Add group members</h3>
        </div>

        {/* Selected members chips */}
        <div
          className={`overflow-hidden transition-all duration-200 ease-in-out shrink-0 ${
            selectedMembers.length > 0 ? "max-h-24 opacity-100" : "max-h-0 opacity-0"
          }`}
        >
          <div className="px-4 py-2 flex flex-wrap gap-2 border-b border-border">
            {selectedMembers.map((m) => (
              <button
                key={m.id}
                type="button"
                className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-primary/10 text-primary text-sm"
                onClick={() => toggleMember(m)}
              >
                <span className="truncate max-w-[120px]">{m.username}</span>
                <X className="h-3.5 w-3.5 shrink-0" />
              </button>
            ))}
          </div>
        </div>

        {/* Search (local filter only) */}
        <div className="px-4 py-3 shrink-0">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search contacts"
              className="pl-9"
              value={searchQuery}
              onChange={(e) => handleGroupMemberSearch(e.target.value)}
            />
          </div>
        </div>

        {/* Filtered contacts list */}
        <ScrollArea className="flex-1 min-h-0">
          {(() => {
            const q = searchQuery.toLowerCase().trim();
            const filtered = Array.from(allUsers.entries()).filter(
              ([, user]) =>
                !q ||
				user.username.toLowerCase().includes(q)
            );
            return (
              <>
                {isLoadingUsers ? (
                  <div className="flex justify-center py-8">
                    <Spinner className="h-6 w-6" />
                  </div>
                ) : (
                  filtered.map(([uid, user]) => {
                    const isSelected = selectedMembers.find((m) => m.id === uid);
                    const profile = useProfiles.getState().getProfile(uid);
                    const displayName = profile?.username || user.username;
                    const displayAvatar = profile?.avatar || user.avatar;
                    return (
                      <button
                        key={uid}
                        type="button"
                        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-accent/50 transition-colors"
					  onClick={() => toggleMember({ id: uid, username: displayName, avatar: displayAvatar })}
                      >
                        <div className="relative">
                          <AvatarWithBadge name={displayName} src={displayAvatar} />
                          {isSelected && (
                            <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-primary flex items-center justify-center">
                              <svg className="w-2.5 h-2.5 text-primary-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                              </svg>
                            </div>
                          )}
                        </div>
                        <div className="text-left min-w-0">
                          <p className="font-medium text-sm truncate">{displayName}</p>
                        </div>
                      </button>
                    );
                  })
                )}
				{!isLoadingUsers && filtered.length === 0 && (
				  <p className="text-center text-sm text-muted-foreground py-8">
					{searchQuery ? "No contacts found" : "No contacts yet"}
				  </p>
				)}
				{hasMore && !isLoadingUsers && currentUserId && (
				  <Button variant="ghost" className="w-full" onClick={() => void loadNextPage(currentUserId)}>Load more contacts</Button>
				)}
              </>
            );
          })()}
        </ScrollArea>

        {/* Next button */}
        {selectedMembers.length > 0 && (
          <div className="p-4 border-t border-border shrink-0">
            <Button
              className="w-full rounded-full"
              onClick={handleGroupMembersNext}
            >
              Next ({selectedMembers.length} selected)
            </Button>
          </div>
        )}
      </div>
    );
  }

  // ── Group Info View (Step 2) ──
  return (
    <div className="flex flex-col h-full bg-card">
      {/* Header */}
      <div className="h-14 px-4 flex items-center gap-2 border-b border-border shrink-0">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-foreground"
          onClick={() => setView("groupMembers")}
          aria-label="Back"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h3 className="font-semibold text-base">Group info</h3>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="px-4 py-6 flex flex-col items-center gap-6">
          {/* Avatar */}
          <button
            type="button"
            className="relative group"
            onClick={() => fileInputRef.current?.click()}
          >
            <div className="w-24 h-24 rounded-full bg-muted flex items-center justify-center overflow-hidden">
              {groupAvatarPreview ? (
                <img src={groupAvatarPreview} alt="Group avatar" className="w-full h-full object-cover" />
              ) : (
                <Users className="w-10 h-10 text-muted-foreground" />
              )}
            </div>
            <div className="absolute inset-0 rounded-full bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
              { isCreating ? (
                null
              ) : (
                <span className="text-white text-xs font-medium">Change</span>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleAvatarSelect}
            />
          </button>

          {/* Group name */}
          <div className="w-full">
            <Input
              placeholder="Group name"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              disabled={isCreating}
            />
          </div>

          {/* Member count */}
          <p className="text-sm text-muted-foreground">
            {selectedMembers.length} member{selectedMembers.length !== 1 ? "s" : ""}
          </p>
        </div>
      </ScrollArea>

      {/* Create button */}
      <div className="p-4 border-t border-border shrink-0">
        <Button
          className="w-full rounded-full"
          onClick={handleCreateGroup}
          disabled={isCreating}
        >
          {isCreating ? "Creating..." : "Create group"}
        </Button>
      </div>
    </div>
  );
}
