import { auth } from "./firebase";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api/v1";

async function getHeaders(): Promise<HeadersInit> {
  const user = auth?.currentUser;
  const token = user ? await user.getIdToken() : "";
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function getFormHeaders(): Promise<HeadersInit> {
  const user = auth?.currentUser;
  const token = user ? await user.getIdToken() : "";
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function redirectToSignIn() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("auth:expired"));
  }
}

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retried = false
): Promise<Response> {
  const res = await fetch(url, options);

  if (res.status === 401 && !retried) {
    // Token might be expired. Force-refresh the Firebase ID token and retry once.
    const user = auth?.currentUser;
    if (!user) {
      redirectToSignIn();
      throw new Error("Session expired");
    }
    try {
      const newToken = await user.getIdToken(true);
      const newHeaders = {
        ...(options.headers as Record<string, string>),
        Authorization: `Bearer ${newToken}`,
      };
      return fetchWithRetry(url, { ...options, headers: newHeaders }, true);
    } catch {
      redirectToSignIn();
      throw new Error("Session expired");
    }
  }

  if (!res.ok) throw new Error(await res.text());
  return res;
}

export const api = {
  async get(path: string) {
    const res = await fetchWithRetry(`${API_URL}${path}`, { headers: await getHeaders() });
    return res.json();
  },

  async post(path: string, body?: unknown) {
    const res = await fetchWithRetry(`${API_URL}${path}`, {
      method: "POST",
      headers: await getHeaders(),
      body: body ? JSON.stringify(body) : undefined,
    });
    return res.json();
  },

  async postForm(path: string, body: FormData) {
    const res = await fetchWithRetry(`${API_URL}${path}`, {
      method: "POST",
      headers: await getFormHeaders(),
      body,
    });
    return res.json();
  },

  async put(path: string, body?: unknown) {
    const res = await fetchWithRetry(`${API_URL}${path}`, {
      method: "PUT",
      headers: await getHeaders(),
      body: body ? JSON.stringify(body) : undefined,
    });
    return res.json();
  },

  async delete(path: string) {
    const res = await fetchWithRetry(`${API_URL}${path}`, {
      method: "DELETE",
      headers: await getHeaders(),
    });
    return res.json();
  },
};

// Group member management API
export const groupApi = {
  async addMembers(chatId: string, userIds: string[]) {
    return api.post(`/chat/${chatId}/members`, { userIds });
  },

  async removeMember(chatId: string, userId: string) {
    return api.post(`/chat/${chatId}/members/${userId}/remove`);
  },

  async promoteMember(chatId: string, userId: string) {
    return api.post(`/chat/${chatId}/members/${userId}/promote`);
  },

  async demoteMember(chatId: string, userId: string) {
    return api.post(`/chat/${chatId}/members/${userId}/demote`);
  },

  async leaveGroup(chatId: string) {
    return api.post(`/chat/${chatId}/leave`);
  },

  async renameGroup(chatId: string, groupName: string) {
    return api.post(`/chat/${chatId}/rename`, { groupName });
  },

  async updateGroupAvatar(chatId: string, avatar: File) {
    const body = new FormData();
    body.set("avatar", avatar);
    return api.postForm(`/chat/${chatId}/avatar`, body);
  },
};
