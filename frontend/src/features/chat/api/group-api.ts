import { api } from "@/lib/api";

export const groupApi = {
  addMembers(chatId: string, userIds: string[]) {
    return api.post(`/chat/${chatId}/members`, { userIds });
  },

  removeMember(chatId: string, userId: string) {
    return api.post(`/chat/${chatId}/members/${userId}/remove`);
  },

  promoteMember(chatId: string, userId: string) {
    return api.post(`/chat/${chatId}/members/${userId}/promote`);
  },

  demoteMember(chatId: string, userId: string) {
    return api.post(`/chat/${chatId}/members/${userId}/demote`);
  },

  leaveGroup(chatId: string) {
    return api.post(`/chat/${chatId}/leave`);
  },

  renameGroup(chatId: string, groupName: string) {
    return api.post(`/chat/${chatId}/rename`, { groupName });
  },

  updateGroupAvatar(chatId: string, avatar: File) {
    const body = new FormData();
    body.set("avatar", avatar);
    return api.postForm(`/chat/${chatId}/avatar`, body);
  },
};
