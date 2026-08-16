import type { StateCreator } from "zustand";
import type { ChatState } from "./types";
import type { FirestoreMessage, SendMessageInput } from "@/features/chat/types/chat";
import { auth } from "@/lib/firebase";
import { api } from "@/lib/api";
import { compressImage, extractVideoFrame } from "@/features/chat/lib/compress";
import { getImageDimensions, getVideoDimensions } from "@/features/chat/lib/media-dimensions";

type MediaType = "image" | "video" | "audio" | "document";

export interface SendSlice {
  isSending: boolean;
  sendMessage: (req: SendMessageInput) => Promise<void>;
  sendMediaBatch: (chatId: string, files: Array<{ file: File; mediaType: MediaType; caption?: string }>, replyToId?: string) => Promise<void>;
  retryMessage: (pendingId: string) => Promise<void>;
  removePendingMessage: (pendingId: string) => void;
  deleteMessage: (chatId: string, messageId: string) => Promise<void>;
}

function detectMediaType(file: File): MediaType {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  return "document";
}

async function createThumbnail(file: File, mediaType: MediaType): Promise<Blob | undefined> {
  if (mediaType === "video") return extractVideoFrame(file);
  if (mediaType === "image") return compressImage(file);
  return undefined;
}

function appendText(form: FormData, name: string, value: string | number | undefined) {
  if (value !== undefined && value !== "") form.set(name, String(value));
}

function createMediaForm(input: {
  chatId: string;
  file: File;
  mediaType: MediaType;
  content?: string;
  thumbnail?: Blob;
  mediaWidth?: number;
  mediaHeight?: number;
  documentName?: string;
  groupId?: string;
  groupIndex?: number;
  replyToId?: string;
}): FormData {
  const form = new FormData();
  form.set("media", input.file);
  appendText(form, "chatId", input.chatId);
  appendText(form, "mediaType", input.mediaType);
  appendText(form, "content", input.content);
  appendText(form, "mediaWidth", input.mediaWidth);
  appendText(form, "mediaHeight", input.mediaHeight);
  appendText(form, "documentName", input.documentName);
  appendText(form, "groupId", input.groupId);
  appendText(form, "groupIndex", input.groupIndex);
  appendText(form, "replyToId", input.replyToId);
  if (input.thumbnail) {
    form.set("thumbnail", new File([input.thumbnail], "thumbnail.jpg", { type: "image/jpeg" }));
  }
  return form;
}

async function mediaDimensions(file: File, mediaType: MediaType) {
  if (mediaType === "image") return getImageDimensions(file);
  if (mediaType === "video") return getVideoDimensions(file);
  return undefined;
}

export const createSendSlice: StateCreator<ChatState, [], [], SendSlice> = (set, get) => ({
  isSending: false,

  sendMessage: async (req) => {
    if (req.files?.length) {
      return get().sendMediaBatch(req.chatId, req.files, req.replyToId);
    }
    if (!req.file && req.mediaUrl) {
      throw new Error("Media messages must be uploaded from a file");
    }

    if (!req.file) {
      const duplicate = get().pendingMessages.some((message) =>
        message._chatId === req.chatId &&
        message.content === (req.content || "") &&
        !message.mediaUrl &&
        (message.status === "uploading" || message.status === "sending"),
      );
      if (duplicate) return;
    }

    const pendingId = `pending_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const currentUser = auth?.currentUser;
    const mediaType = req.file ? detectMediaType(req.file) : undefined;
    const localPreview = req.file ? URL.createObjectURL(req.file) : req.localPreview;
    let thumbnail: Blob | undefined;
    let localThumbnail: string | undefined;

    if (req.file && mediaType) {
      try {
        thumbnail = await createThumbnail(req.file, mediaType);
        if (thumbnail) localThumbnail = URL.createObjectURL(thumbnail);
      } catch {
        // The media itself remains useful when a generated preview is unavailable.
      }
    }

    const pending: FirestoreMessage = {
      id: pendingId,
      pendingId,
      content: req.content || "",
      senderId: currentUser?.uid || "",
      senderName: currentUser?.displayName || "",
      senderAvatar: currentUser?.photoURL || undefined,
      createdAt: new Date(),
      status: req.file ? "uploading" : "sending",
      uploadProgress: 0,
      localPreview,
      mediaType,
      mediaUrl: localPreview,
      mediaWidth: req.mediaWidth,
      mediaHeight: req.mediaHeight,
      thumbnailUrl: localThumbnail,
      replyToId: req.replyToId,
      replyTo: req.replyTo || undefined,
      _chatId: req.chatId,
      documentName: mediaType === "document" && req.file ? req.file.name : undefined,
      _mediaFile: req.file,
    };
    set((state) => ({ pendingMessages: [...state.pendingMessages, pending], isSending: true }));

    try {
      if (req.file && mediaType) {
        let dimensions: { width: number; height: number } | undefined;
        try {
          dimensions = await mediaDimensions(req.file, mediaType);
        } catch {
          // Rendering can determine an aspect ratio when browser metadata is unavailable.
        }
        set((state) => ({
          pendingMessages: state.pendingMessages.map((message) =>
            message.pendingId === pendingId
              ? { ...message, mediaWidth: dimensions?.width, mediaHeight: dimensions?.height, uploadProgress: 50, status: "sending" }
              : message,
          ),
        }));
        const response = await api.postForm("/message/send", createMediaForm({
          chatId: req.chatId,
          file: req.file,
          mediaType,
          content: req.content,
          thumbnail,
          mediaWidth: dimensions?.width,
          mediaHeight: dimensions?.height,
          documentName: mediaType === "document" ? req.file.name : undefined,
          replyToId: req.replyToId,
        }));
        set((state) => ({
          pendingMessages: state.pendingMessages.map((message) =>
            message.pendingId === pendingId
              ? { ...message, id: response.message_id || pendingId, mediaUrl: response.mediaURL || message.mediaUrl, thumbnailUrl: response.thumbnailURL || message.thumbnailUrl, uploadProgress: 100, status: "sent" }
              : message,
          ),
        }));
      } else {
        const response = await api.post("/message/send", { chatId: req.chatId, content: req.content || undefined, replyToId: req.replyToId });
        set((state) => ({
          pendingMessages: state.pendingMessages.map((message) =>
            message.pendingId === pendingId ? { ...message, id: response.message_id || pendingId, status: "sent" } : message,
          ),
        }));
      }
      if (currentUser?.uid) void get().refreshChat(req.chatId, currentUser.uid);
    } catch (error) {
      console.error("Failed to send message:", error);
      set((state) => ({
        pendingMessages: state.pendingMessages.map((message) =>
          message.pendingId === pendingId ? { ...message, status: "failed", error: error instanceof Error ? error.message : "Failed to send" } : message,
        ),
      }));
    } finally {
      set({ isSending: false });
      if (localPreview && req.file) URL.revokeObjectURL(localPreview);
      if (localThumbnail) URL.revokeObjectURL(localThumbnail);
    }
  },

  sendMediaBatch: async (chatId, files, replyToId) => {
    const currentUser = auth?.currentUser;
    const groupId = crypto.randomUUID();
    const previews = files.map((file) => URL.createObjectURL(file.file));
    const thumbnails = await Promise.all(files.map(async ({ file, mediaType }) => {
      try {
        return await createThumbnail(file, mediaType);
      } catch {
        return undefined;
      }
    }));
    const thumbnailPreviews = thumbnails.map((thumbnail) => thumbnail ? URL.createObjectURL(thumbnail) : undefined);
    const pendingMessages: FirestoreMessage[] = files.map((item, index) => ({
      id: `pending_${Date.now()}_${index}_${Math.random().toString(36).slice(2)}`,
      pendingId: `pending_${Date.now()}_${index}_${Math.random().toString(36).slice(2)}`,
      content: item.caption || "",
      senderId: currentUser?.uid || "",
      senderName: currentUser?.displayName || "",
      senderAvatar: currentUser?.photoURL || undefined,
      createdAt: new Date(),
      status: "uploading",
      uploadProgress: 0,
      localPreview: previews[index],
      mediaType: item.mediaType,
      mediaUrl: previews[index],
      thumbnailUrl: thumbnailPreviews[index],
      groupId,
      groupIndex: index,
      replyToId: index === 0 ? replyToId : undefined,
      _chatId: chatId,
      documentName: item.mediaType === "document" ? item.file.name : undefined,
      _mediaFile: item.file,
    }));
    set((state) => ({ pendingMessages: [...state.pendingMessages, ...pendingMessages], isSending: true }));

    const sendOne = async (item: typeof files[number], index: number) => {
      const pendingId = pendingMessages[index].pendingId!;
      try {
        let dimensions: { width: number; height: number } | undefined;
        try {
          dimensions = await mediaDimensions(item.file, item.mediaType);
        } catch {
          // Rendering can determine an aspect ratio when browser metadata is unavailable.
        }
        set((state) => ({
          pendingMessages: state.pendingMessages.map((message) =>
            message.pendingId === pendingId ? { ...message, mediaWidth: dimensions?.width, mediaHeight: dimensions?.height, uploadProgress: 50, status: "sending" } : message,
          ),
        }));
        const response = await api.postForm("/message/send", createMediaForm({
          chatId,
          file: item.file,
          mediaType: item.mediaType,
          content: item.caption,
          thumbnail: thumbnails[index],
          mediaWidth: dimensions?.width,
          mediaHeight: dimensions?.height,
          documentName: item.mediaType === "document" ? item.file.name : undefined,
          groupId,
          groupIndex: index,
          replyToId: index === 0 ? replyToId : undefined,
        }));
        set((state) => ({
          pendingMessages: state.pendingMessages.map((message) =>
            message.pendingId === pendingId
              ? { ...message, id: response.message_id || pendingId, mediaUrl: response.mediaURL || message.mediaUrl, thumbnailUrl: response.thumbnailURL || message.thumbnailUrl, uploadProgress: 100, status: "sent" }
              : message,
          ),
        }));
      } catch (error) {
        console.error(`[sendMediaBatch] item ${index} failed:`, error);
        set((state) => ({
          pendingMessages: state.pendingMessages.map((message) =>
            message.pendingId === pendingId ? { ...message, status: "failed", error: error instanceof Error ? error.message : "Failed to send" } : message,
          ),
        }));
      }
    };

    try {
      await Promise.all(files.map(sendOne));
      if (currentUser?.uid) void get().refreshChat(chatId, currentUser.uid);
    } finally {
      set({ isSending: false });
      previews.forEach(URL.revokeObjectURL);
      thumbnailPreviews.forEach((url) => { if (url) URL.revokeObjectURL(url); });
    }
  },

  retryMessage: async (pendingId) => {
    const pending = get().pendingMessages.find((message) => message.pendingId === pendingId);
    if (!pending || pending.status !== "failed" || !pending._chatId) return;
    set((state) => ({
      pendingMessages: state.pendingMessages.map((message) => message.pendingId === pendingId ? { ...message, status: "sending", error: undefined } : message),
      isSending: true,
    }));
    try {
      let response;
      if (pending._mediaFile && pending.mediaType) {
        let thumbnail: Blob | undefined;
        try {
          thumbnail = await createThumbnail(pending._mediaFile, pending.mediaType);
        } catch {
          // The original media can still be retried without a thumbnail.
        }
        response = await api.postForm("/message/send", createMediaForm({
          chatId: pending._chatId,
          file: pending._mediaFile,
          mediaType: pending.mediaType,
          content: pending.content,
          thumbnail,
          mediaWidth: pending.mediaWidth,
          mediaHeight: pending.mediaHeight,
          documentName: pending.documentName,
          groupId: pending.groupId,
          groupIndex: pending.groupIndex,
          replyToId: pending.replyToId,
        }));
      } else if (!pending.mediaUrl) {
        response = await api.post("/message/send", { chatId: pending._chatId, content: pending.content, replyToId: pending.replyToId });
      } else {
        throw new Error("The original media file is no longer available. Select it again to retry.");
      }
      set((state) => ({
        pendingMessages: state.pendingMessages.map((message) =>
          message.pendingId === pendingId
            ? { ...message, id: response.message_id || pendingId, mediaUrl: response.mediaURL || message.mediaUrl, thumbnailUrl: response.thumbnailURL || message.thumbnailUrl, status: "sent" }
            : message,
        ),
      }));
    } catch (error) {
      console.error("Retry failed:", error);
      set((state) => ({
        pendingMessages: state.pendingMessages.map((message) =>
          message.pendingId === pendingId ? { ...message, status: "failed", error: error instanceof Error ? error.message : "Failed to send" } : message,
        ),
      }));
    } finally {
      set({ isSending: false });
    }
  },

  removePendingMessage: (pendingId) => {
    const pending = get().pendingMessages.find((message) => message.pendingId === pendingId);
    if (pending?.localPreview) URL.revokeObjectURL(pending.localPreview);
    set((state) => ({ pendingMessages: state.pendingMessages.filter((message) => message.pendingId !== pendingId) }));
  },

  deleteMessage: async (chatId, messageId) => {
    try {
      await api.delete(`/chat/${chatId}/message/${messageId}`);
    } catch (error) {
      console.error("Failed to delete message:", error);
    }
  },
});
