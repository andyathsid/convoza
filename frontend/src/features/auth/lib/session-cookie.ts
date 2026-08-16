import type { User as FirebaseUser } from "firebase/auth";

export async function setSessionCookie(firebaseUser: FirebaseUser): Promise<void> {
  try {
    const token = await firebaseUser.getIdToken();
    await fetch("/api/login", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (error) {
    // Client auth remains usable, and initialization retries the cookie on reload.
    console.warn("Failed to set session cookie", error);
  }
}

export async function clearSessionCookie(): Promise<void> {
  const response = await fetch("/api/logout", { method: "POST" });
  if (!response.ok) {
    throw new Error(`Failed to clear session cookie: ${response.status}`);
  }
}
