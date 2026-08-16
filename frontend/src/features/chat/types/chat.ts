import type { User } from "@/types/user";
import type { Timestamp } from "firebase/firestore";

export type MessageTimestamp = Timestamp | Date;

export interface ParticipantProfile {
  username: string;
  avatar: string;
  email: string;
}

export interface Chat {
  id: string;
  isGroup: boolean;
  groupName: string;
  groupAvatar?: string;
  createdBy: string;
  initiator?: string;
  createdAt: string;
  updatedAt: string;
  participants: User[];
  lastMessage?: LastMessage | null;
  hasUnread?: boolean;
  unreadCount?: number;
  latestUnreadMessageId?: string | null;
}

export type ChatListFilter = "all" | "unread" | "groups";

export interface LastMessage {
  id?: string;
  content: string;
  senderId: string;
  senderName?: string;
  mediaUrl?: string;
  mediaType?: "image" | "video" | "audio" | "document";
  thumbnailUrl?: string;
  documentName?: string;
  createdAt: string;
  sender?: MessageSender;
  // Legacy fields for local-only last message updates
  timestamp?: string;
  type?: "text" | "image" | "audio" | "document";
}

export interface MessageSender {
  _id: string;
  name: string;
  username: string;
  avatar?: string;
}

export type SystemMessageSubtype =
  | "group_created"
  | "member_added"
  | "member_removed"
  | "member_left"
  | "group_renamed"
  | "avatar_changed"
  | "admin_promoted"
  | "admin_demoted";

export interface FirestoreMessage {
  id?: string;
  content: string;
  mediaUrl?: string;
  mediaType?: "image" | "video" | "audio" | "document";
  mediaWidth?: number;
  mediaHeight?: number;
  thumbnailUrl?: string;
  documentName?: string;
  groupId?: string;
  groupIndex?: number;
  senderId: string;
  senderName: string;
  senderAvatar?: string;
  sender?: MessageSender;
  replyToId?: string;
  replyTo?: FirestoreMessage | null;
  createdAt: MessageTimestamp;
  status?: MessageStatus;
  pendingId?: string;
  uploadProgress?: number;
  localPreview?: string;
  error?: string;
  _chatId?: string;
  _mediaPath?: string;
  _thumbnailPath?: string;
  _mediaFile?: File;
  // Read receipts: maps of userId → Firestore serverTimestamp
  deliveredTo?: Record<string, Timestamp>;
  readBy?: Record<string, Timestamp>;
  // System messages
  type?: "text" | "system" | "media";
  subtype?: SystemMessageSubtype;
  actorName?: string;
  actorId?: string;
  targetId?: string;
  targetIds?: string[];
  targetName?: string;
}

export type MessageStatus = "uploading" | "sending" | "sent" | "delivered" | "read" | "failed";

export interface CreateChatInput {
  participantId?: string;
  isGroup?: boolean;
  participants?: string[];
  groupName?: string;
}

export interface SendMessageInput {
  chatId: string;
  content?: string;
  mediaUrl?: string;
  mediaPath?: string;
  mediaType?: "image" | "video" | "audio" | "document";
  mediaWidth?: number;
  mediaHeight?: number;
  thumbnailUrl?: string;
  thumbnailPath?: string;
  documentName?: string;
  groupId?: string;
  groupIndex?: number;
  replyToId?: string;
  replyTo?: FirestoreMessage | null;
  // For optimistic sends: pass raw files, store handles upload
  file?: File;
  localPreview?: string;
  // For grouped media uploads
  files?: Array<{ file: File; mediaType: "image" | "video" | "audio" | "document"; caption?: string }>;
}
