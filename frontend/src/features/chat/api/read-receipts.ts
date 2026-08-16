import { api } from "@/lib/api";

export async function markMessagesDelivered(
  chatId: string,
  messageIds: string[],
) {
  if (messageIds.length === 0) return;

  try {
    await api.post("/message/deliver", { chatId, messageIds });
  } catch (error) {
    console.error("[ReadReceipts] Failed to mark delivered:", error);
  }
}

export async function markMessagesAsRead(
  chatId: string,
  messageIds: string[],
  readThroughMessageId?: string,
) {
  if (messageIds.length === 0 && !readThroughMessageId) return false;

  try {
    const response = await api.post("/message/read", {
      chatId,
      messageIds,
      readThroughMessageId,
    });
    return response.clearedUnread === true;
  } catch (error) {
    console.error("[ReadReceipts] Failed to mark read:", error);
    return false;
  }
}
