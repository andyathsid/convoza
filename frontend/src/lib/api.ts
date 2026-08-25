import type { User as FirebaseUser } from "firebase/auth";
import { auth } from "./firebase";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api/v1";

export interface SessionProfile {
  username?: string;
  avatar?: string;
  avatarPath?: string;
}

function getHeaders(): HeadersInit {
  return {
    "Content-Type": "application/json",
  };
}

async function createSession(
  firebaseUser: FirebaseUser,
  profile?: SessionProfile
) {
  const token = await firebaseUser.getIdToken();
  const response = await fetch(`${API_URL}/auth/session`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: profile ? JSON.stringify(profile) : undefined,
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

export async function createApiSession(
  firebaseUser: FirebaseUser,
  profile?: SessionProfile
) {
  return createSession(firebaseUser, profile);
}

export async function clearApiSession(): Promise<void> {
  const response = await fetch(`${API_URL}/auth/session`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!response.ok) throw new Error(`Failed to clear API session: ${response.status}`);
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
    // The backend session may have expired while Firebase client auth persisted.
    // Exchange a fresh ID token for a new API-only HTTP-only session, then retry.
    const user = auth?.currentUser;
    if (!user) {
      redirectToSignIn();
      throw new Error("Session expired");
    }
    try {
      await createSession(user);
      return fetchWithRetry(url, options, true);
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
    const res = await fetchWithRetry(`${API_URL}${path}`, { credentials: "include", headers: getHeaders() });
    return res.json();
  },

  async post(path: string, body?: unknown) {
    const res = await fetchWithRetry(`${API_URL}${path}`, {
      method: "POST",
      credentials: "include",
      headers: getHeaders(),
      body: body ? JSON.stringify(body) : undefined,
    });
    return res.json();
  },

  async postForm(path: string, body: FormData) {
    const res = await fetchWithRetry(`${API_URL}${path}`, {
      method: "POST",
      credentials: "include",
      body,
    });
    return res.json();
  },

  async put(path: string, body?: unknown) {
    const res = await fetchWithRetry(`${API_URL}${path}`, {
      method: "PUT",
      credentials: "include",
      headers: getHeaders(),
      body: body ? JSON.stringify(body) : undefined,
    });
    return res.json();
  },

  async delete(path: string) {
    const res = await fetchWithRetry(`${API_URL}${path}`, {
      method: "DELETE",
      credentials: "include",
      headers: getHeaders(),
    });
    return res.json();
  },
};
